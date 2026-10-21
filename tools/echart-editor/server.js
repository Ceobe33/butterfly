#!/usr/bin/env node
/**
 * ECharts 浏览器编辑器 —— 改图的同时把数据同步回源码。
 *
 *   npm run ec                                          # 默认编辑仓库根目录的 echart.js
 *   npm run ec -- --file source/_posts/xxx.md           # 直接改文章里的 ```echarts 围栏
 *
 * 可选参数：--file <路径>  --port <端口>  --no-open（不自动开浏览器）
 *
 * 支持两种源文件格式，自动识别：
 *
 *   A. JS 脚本（`var option = {...}` + `const nodes = [[x,y,name,color,pos], ...]`）
 *      把源码放进 vm 跑一遍取 option；保存时只重写 nodes 那一段，
 *      未改动的条目按原文逐字回写，其余代码（配色常量、注释）原样保留。
 *
 *   B. 纯 JSON 的 option（直接把 option 存成 .json 那样的大括号文件）
 *      直接 JSON.parse；nodes 从 series 里 type=scatter 的那条序列取，
 *      保存时重建 series 的 data 再整体序列化写回。
 */

'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const vm = require('vm');
const { execFile } = require('child_process');

// themes/butterfly/tools/echart-editor -> 仓库根目录（往上 4 层）
const ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const PUBLIC_DIR = path.join(__dirname, 'public');
const VENDOR_DIR = path.join(__dirname, 'vendor');

function arg(name, fallback) {
  const i = process.argv.indexOf('--' + name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const FILE = path.resolve(ROOT, arg('file', 'echart.js'));
const BASE_PORT = Number(arg('port', 7788));
const NO_OPEN = process.argv.includes('--no-open');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png'
};

const EMPTY_NODE_COLOR = '#4bacc6';

// ---------------------------------------------------------------------------
// 通用
// ---------------------------------------------------------------------------

function readSource() {
  return fs.readFileSync(FILE, 'utf8');
}

function writeAtomic(text) {
  fs.writeFileSync(FILE + '.tmp', text, 'utf8');
  fs.renameSync(FILE + '.tmp', FILE);
  return text.length;
}

function detectKind(code, file = FILE) {
  if (String(file).toLowerCase().endsWith('.md')) return 'md';
  if (/const\s+nodes\s*=/.test(code)) return 'js';
  const head = code.trimStart()[0];
  if (head === '{' || head === '[') return 'json';
  return 'js';
}

/**
 * 扫出 markdown 里所有的 ```echarts 围栏。
 * 记录开/闭行号、缩进，以及它所属的最近一个标题，方便在 UI 里区分。
 */
function findFences(text) {
  const lines = text.split('\n');
  const fences = [];
  let heading = '';

  for (let i = 0; i < lines.length; i++) {
    const headingMatch = /^#{1,6}\s+(.+?)\s*$/.exec(lines[i]);
    if (headingMatch) heading = headingMatch[1];

    const open = /^(\s*)(`{3,})\s*echarts\s*$/i.exec(lines[i]);
    if (!open) continue;

    const indent = open[1];
    const ticks = open[2].length;

    let close = -1;
    for (let j = i + 1; j < lines.length; j++) {
      const m = /^\s*(`{3,})\s*$/.exec(lines[j]);
      if (m && m[1].length >= ticks) {
        close = j;
        break;
      }
    }

    if (close < 0) break; // 没闭合，后面的不算

    fences.push({
      index: fences.length,
      openLine: i,
      closeLine: close,
      indent,
      heading,
      body: lines.slice(i + 1, close).join('\n')
    });

    i = close;
  }

  return fences;
}

function seriesIndexOf(option, type) {
  const series = (option && option.series) || [];
  return series.findIndex((s) => s && s.type === type);
}

/** 从 option 的 scatter 序列里取出 [x, y, name, color, labelPosition] */
function nodesFromOption(option) {
  const index = seriesIndexOf(option, 'scatter');
  if (index < 0) throw new Error('option.series 里没有 type=scatter 的序列，无法定位节点');

  return (option.series[index].data || []).map((datum) => {
    if (Array.isArray(datum)) {
      return [Number(datum[0]), Number(datum[1]), '', EMPTY_NODE_COLOR, 'right'];
    }
    const value = Array.isArray(datum.value) ? datum.value : [0, 0];
    return [
      Number(value[0]),
      Number(value[1]),
      String(datum.name ?? ''),
      String((datum.itemStyle && datum.itemStyle.color) || EMPTY_NODE_COLOR),
      String((datum.label && datum.label.position) || 'right')
    ];
  });
}

/** 把编辑后的节点写回 option（保留每个 datum 原有的其它样式字段） */
function applyNodesToOption(option, nodes) {
  const scatterIndex = seriesIndexOf(option, 'scatter');
  if (scatterIndex < 0) throw new Error('option.series 里没有 type=scatter 的序列');

  const scatter = option.series[scatterIndex];
  const originals = Array.isArray(scatter.data) ? scatter.data.slice() : [];
  const template = originals.find((d) => d && !Array.isArray(d)) || {};

  scatter.data = nodes.map((node) => {
    const id = Number.isInteger(node.id) ? node.id : -1;
    const source = id >= 0 && originals[id] && !Array.isArray(originals[id]) ? originals[id] : template;
    const datum = JSON.parse(JSON.stringify(source));

    datum.name = String(node.name);
    datum.value = [Number(node.x), Number(node.y)];
    datum.itemStyle = { ...(datum.itemStyle || {}), color: String(node.color) };
    datum.label = { ...(datum.label || {}), position: String(node.label) };

    return datum;
  });

  const lineIndex = seriesIndexOf(option, 'line');
  if (lineIndex >= 0) {
    const line = nodes.map((n) => [Number(n.x), Number(n.y)]);
    if (line.length > 1) line.push([Number(nodes[0].x), Number(nodes[0].y)]);
    option.series[lineIndex].data = line;
  }

  return option;
}

// ---------------------------------------------------------------------------
// 格式 A：JS 源码
// ---------------------------------------------------------------------------

/** 定位 `const nodes = [ ... ]` 的中括号位置 */
function findNodesBlock(code) {
  const m = /const\s+nodes\s*=\s*\[/.exec(code);
  if (!m) throw new Error('源文件里找不到 “const nodes = [ ... ]”');

  const open = m.index + m[0].length - 1;
  let depth = 0;
  let quote = null;

  for (let i = open; i < code.length; i++) {
    const ch = code[i];

    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '/' && code[i + 1] === '/') {
      while (i < code.length && code[i] !== '\n') i++;
      continue;
    }
    if (ch === '/' && code[i + 1] === '*') {
      i += 2;
      while (i < code.length && !(code[i] === '*' && code[i + 1] === '/')) i++;
      i++;
      continue;
    }
    if (ch === '[') depth++;
    else if (ch === ']') {
      depth--;
      if (depth === 0) return { bodyStart: open + 1, bodyEnd: i };
    }
  }

  throw new Error('nodes 数组没有正确闭合');
}

/** 按顶层逗号切分数组元素（忽略字符串 / 注释里的逗号） */
function splitTopLevel(body) {
  const parts = [];
  let start = 0;
  let depth = 0;
  let quote = null;

  for (let i = 0; i < body.length; i++) {
    const ch = body[i];

    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '/' && body[i + 1] === '/') {
      while (i < body.length && body[i] !== '\n') i++;
      continue;
    }
    if (ch === '[' || ch === '(' || ch === '{') depth++;
    else if (ch === ']' || ch === ')' || ch === '}') depth--;
    else if (ch === ',' && depth === 0) {
      parts.push(body.slice(start, i));
      start = i + 1;
    }
  }

  const tail = body.slice(start);
  if (tail.trim()) parts.push(tail);

  return parts.filter((p) => p.trim());
}

/**
 * 拆出“行首注释”和“条目代码”。
 * rawFull 保留原有的空行与缩进，未改动的条目靠它逐字回写；
 * gap 是条目之前的换行数（用于还原分段之间的空行）。
 */
function dissect(raw) {
  const leadingWS = (raw.match(/^\s*/) || [''])[0];
  const text = raw.slice(leadingWS.length).replace(/\s+$/, '');
  const gap = (leadingWS.match(/\n+/) || ['\n'])[0];

  const lines = text.split('\n');
  const comments = [];

  let i = 0;
  while (i < lines.length && /^\s*\/\//.test(lines[i])) {
    comments.push(lines[i].trim());
    i++;
  }

  let rawFull = raw.replace(/\s+$/, '');
  if (!rawFull.startsWith('\n')) rawFull = '\n  ' + rawFull.trim();

  return {
    gap,
    rawFull,
    comments,
    entry: lines.slice(i).join('\n').trim()
  };
}

/** 在 vm 里执行源文件，拿到真实的 option / nodes */
function evaluate(code) {
  const sandbox = {
    require: () => ({ init: () => ({ setOption() {} }) }),
    document: { getElementById: () => ({}) },
    console
  };

  vm.createContext(sandbox);

  const probe =
    code +
    '\n;globalThis.__echart_editor__ = {' +
    " option: typeof option !== 'undefined' ? option : null," +
    " nodes: typeof nodes !== 'undefined' ? nodes : null" +
    ' };';

  vm.runInContext(probe, sandbox, { timeout: 5000, filename: FILE });

  const out = sandbox.__echart_editor__;
  if (!out || !out.option) {
    throw new Error('没能从源文件里取到 option');
  }
  if (!Array.isArray(out.nodes)) {
    throw new Error('没能从源文件里取到 nodes 数组');
  }
  return out;
}

/** 收集源码里的配色常量：const cBlue = '#4BACC6' */
function parsePalette(code) {
  const re = /^[ \t]*const[ \t]+([A-Za-z_$][\w$]*)[ \t]*=[ \t]*['"](#[0-9a-fA-F]{3,8})['"]/gm;
  const hexToName = {};
  const nameToHex = {};

  let m;
  while ((m = re.exec(code))) {
    hexToName[m[2].toLowerCase()] = m[1];
    nameToHex[m[1]] = m[2];
  }

  return { hexToName, nameToHex };
}

function quote(s) {
  return (
    "'" +
    String(s)
      .replace(/\\/g, '\\\\')
      .replace(/'/g, "\\'")
      .replace(/\r?\n/g, '\\n') +
    "'"
  );
}

function num(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '0';
  return String(Number(n.toFixed(2)));
}

function renderEntry(node, palette) {
  const color = palette.hexToName[String(node.color).toLowerCase()] || quote(node.color);
  const one = `[${num(node.x)}, ${num(node.y)}, ${quote(node.name)}, ${color}, ${quote(node.label)}]`;

  if (one.length <= 96) return one;

  return [
    '[',
    `    ${num(node.x)},`,
    `    ${num(node.y)},`,
    `    ${quote(node.name)},`,
    `    ${color},`,
    `    ${quote(node.label)}`,
    '  ]'
  ].join('\n');
}

function indent(text) {
  const [first, ...rest] = text.split('\n');
  return ['  ' + first, ...rest];
}

function sameValue(value, node) {
  if (!value) return false;
  return (
    Number(value[0]) === Number(node.x) &&
    Number(value[1]) === Number(node.y) &&
    String(value[2]) === String(node.name) &&
    String(value[3]).toLowerCase() === String(node.color).toLowerCase() &&
    String(value[4]) === String(node.label)
  );
}

/** 把节点数组写回 JS 源码，只替换 nodes 那一段 */
function writeNodesJs(code, incoming) {
  const block = findNodesBlock(code);
  const parsed = evaluate(code).nodes;
  const parts = splitTopLevel(code.slice(block.bodyStart, block.bodyEnd));
  const originals = parts.map((p, i) => ({ ...dissect(p), value: parsed[i] }));
  const palette = parsePalette(code);

  const pieces = incoming.map((node) => {
    const id = Number.isInteger(node.id) ? node.id : -1;
    const orig = id >= 0 && originals[id] ? originals[id] : null;

    // 没动过的条目：原文照抄，连注释、空行和换行格式都不变
    if (orig && sameValue(orig.value, node)) return orig.rawFull;

    const head = orig ? orig.comments.map((c) => '  ' + c) : [];
    return (orig ? orig.gap : '\n') + head.concat(indent(renderEntry(node, palette))).join('\n');
  });

  const body = pieces.join(',') + '\n';
  return code.slice(0, block.bodyStart) + body + code.slice(block.bodyEnd);
}

// ---------------------------------------------------------------------------
// 格式 B：纯 JSON 的 option
// ---------------------------------------------------------------------------

/** 自定义序列化：短对象/数组保持单行，让 diff 不至于炸开 */
function serializeJson(value, pad = '') {
  const inner = pad + '  ';
  const flat = JSON.stringify(value);

  if (value === null || typeof value !== 'object') return flat;
  if (flat === undefined) return 'null';

  const isArray = Array.isArray(value);
  const empty = isArray ? value.length === 0 : Object.keys(value).length === 0;
  if (empty) return isArray ? '[]' : '{}';
  if (flat.length <= 220) return flat;

  const entries = isArray
    ? value.map((item) => inner + serializeJson(item, inner))
    : Object.keys(value).map((key) => inner + JSON.stringify(key) + ': ' + serializeJson(value[key], inner));

  return (isArray ? '[' : '{') + '\n' + entries.join(',\n') + '\n' + pad + (isArray ? ']' : '}');
}

// ---------------------------------------------------------------------------
// 统一读写
// ---------------------------------------------------------------------------

function loadChart(fenceIndex = 0) {
  const code = readSource();
  const kind = detectKind(code);

  if (kind === 'md') {
    const fences = findFences(code);
    if (!fences.length) throw new Error('这个 markdown 文件里没有 ```echarts 围栏');

    const index = Math.min(Math.max(0, Number(fenceIndex) || 0), fences.length - 1);
    const fence = fences[index];

    let option;
    try {
      option = JSON.parse(fence.body);
    } catch (err) {
      throw new Error(`第 ${index + 1} 个围栏的 JSON 解析失败：${err.message}`);
    }

    return {
      kind,
      code,
      option,
      nodes: nodesFromOption(option),
      fenceIndex: index,
      fences: fences.map((f) => ({ index: f.index, line: f.openLine + 1, heading: f.heading }))
    };
  }

  if (kind === 'json') {
    let option;
    try {
      option = JSON.parse(code);
    } catch (err) {
      throw new Error(`JSON 解析失败：${err.message}`);
    }
    return { kind, code, option, nodes: nodesFromOption(option), hexToName: {} };
  }

  const { option, nodes } = evaluate(code);
  return { kind, code, option, nodes, hexToName: parsePalette(code).hexToName };
}

function paletteOf(chart) {
  if (chart.kind === 'js') return parsePalette(chart.code).nameToHex;

  const out = {};
  const seen = new Set();
  chart.nodes.forEach((n) => {
    const hex = String(n[3]).toLowerCase();
    if (seen.has(hex)) return;
    seen.add(hex);
    out['c' + (seen.size)] = hex.toUpperCase();
  });
  return out;
}

function writeNodes(incoming, fenceIndex = 0) {
  const chart = loadChart(fenceIndex);
  const count = incoming.length;

  // markdown：只替换围栏正文，围栏外的内容一字不动
  if (chart.kind === 'md') {
    const fence = findFences(chart.code)[chart.fenceIndex];
    const option = applyNodesToOption(JSON.parse(fence.body), incoming);

    const body = serializeJson(option)
      .split('\n')
      .map((line) => fence.indent + line)
      .join('\n');

    const lines = chart.code.split('\n');
    const next = [...lines.slice(0, fence.openLine + 1), body, ...lines.slice(fence.closeLine)].join('\n');

    return { count, bytes: writeAtomic(next) };
  }

  if (chart.kind === 'json') {
    const option = applyNodesToOption(JSON.parse(chart.code), incoming);
    return { count, bytes: writeAtomic(serializeJson(option) + '\n') };
  }

  return { count, bytes: writeAtomic(writeNodesJs(chart.code, incoming)) };
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function readBody(req, limit = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('请求体过大'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function buildState(fenceIndex = 0) {
  const chart = loadChart(fenceIndex);
  const option = chart.option;
  const stat = fs.statSync(FILE);

  const xAxis = Array.isArray(option.xAxis) ? option.xAxis[0] : option.xAxis || {};
  const yAxis = Array.isArray(option.yAxis) ? option.yAxis[0] : option.yAxis || {};

  return {
    file: path.relative(ROOT, FILE),
    kind: chart.kind,
    fences: chart.fences || [],
    fenceIndex: chart.fenceIndex || 0,
    mtime: stat.mtimeMs,
    nodes: chart.nodes.map((n, i) => ({
      id: i,
      x: Number(n[0]),
      y: Number(n[1]),
      name: String(n[2]),
      color: String(n[3]).toLowerCase(),
      label: String(n[4])
    })),
    option: JSON.parse(JSON.stringify(option)),
    palette: paletteOf(chart),
    axis: {
      xMin: Number(xAxis.min ?? 0),
      xMax: Number(xAxis.max ?? 1),
      yMin: Number(yAxis.min ?? 0),
      yMax: Number(yAxis.max ?? 1)
    }
  };
}

function serveStatic(res, dir, relPath) {
  const target = path.join(dir, path.normalize(relPath).replace(/^(\.\.[/\\])+/, ''));
  if (!target.startsWith(dir) || !fs.existsSync(target) || fs.statSync(target).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }
  const body = fs.readFileSync(target);
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(target)] || 'application/octet-stream',
    'Content-Length': body.length,
    'Cache-Control': 'no-cache'
  });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  try {
    if (url.pathname === '/api/state' && req.method === 'GET') {
      return sendJson(res, 200, buildState(Number(url.searchParams.get('fence') || 0)));
    }

    if (url.pathname === '/api/nodes' && req.method === 'POST') {
      const raw = await readBody(req);
      const payload = JSON.parse(raw);

      if (!Array.isArray(payload.nodes)) {
        return sendJson(res, 400, { ok: false, error: 'nodes 必须是数组' });
      }

      const result = writeNodes(payload.nodes, Number(payload.fence ?? 0));
      console.log(`[sync] ${path.basename(FILE)} <- ${result.count} 个节点`);

      return sendJson(res, 200, {
        ok: true,
        savedAt: new Date().toLocaleTimeString('zh-CN', { hour12: false })
      });
    }

    if (url.pathname === '/' || url.pathname === '/index.html') {
      return serveStatic(res, PUBLIC_DIR, 'index.html');
    }

    if (url.pathname.startsWith('/vendor/')) {
      return serveStatic(res, VENDOR_DIR, url.pathname.slice('/vendor/'.length));
    }

    return serveStatic(res, PUBLIC_DIR, url.pathname.slice(1));
  } catch (err) {
    sendJson(res, 500, { ok: false, error: err.message });
  }
});

// 端口被占（常见于上次没关干净）时自动往后找，不要直接抛 EADDRINUSE
let port = BASE_PORT;
let attempts = 0;

server.on('error', (err) => {
  if (err.code !== 'EADDRINUSE' || attempts >= 20) {
    console.error(`启动失败：${err.message}`);
    process.exit(1);
  }
  attempts++;
  port = BASE_PORT + attempts;
  server.listen(port);
});

/** 启动后自动打开浏览器（--no-open 可关闭） */
function openBrowser(url) {
  const win = process.platform === 'win32';
  const bin = win ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = win ? ['/c', 'start', '', url] : [url];

  execFile(bin, args, () => {
    /* 打不开就算了，不影响服务 */
  });
}

server.on('listening', () => {
  if (attempts > 0) {
    console.log(`端口 ${BASE_PORT} 已被占用（可能是上次的实例没关），已自动改用 ${port}`);
  }

  const url = `http://localhost:${port}`;
  console.log(`ECharts 编辑器  ${url}`);
  console.log(`目标文件      ${FILE}`);
  console.log('关闭请按 Ctrl+C');

  if (!NO_OPEN) openBrowser(url);
});

server.listen(port);
