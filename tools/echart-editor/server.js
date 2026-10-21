#!/usr/bin/env node
/**
 * ECharts editor in the browser — tweak the chart and sync the data straight back into the source.
 *
 *   npm run ec                                          # blank canvas; pick a file in the browser
 *   npm run ec -- --file source/_posts/xxx.md           # open an ```echarts fence inside an article
 *
 * Options: --file <path>  --port <port>  --no-open  --keep-alive
 *
 * Two source formats are recognised automatically:
 *
 *   A. A JS script (`var option = {...}` + `const nodes = [[x,y,name,color,pos], ...]`)
 *      the source is run through a vm to pull out option; on save only the nodes block is rewritten,
 *      untouched entries are written back verbatim and everything else (palette constants, comments) is left alone.
 *
 *   B. A plain-JSON option (an option saved straight out as a braces file)
 *      parsed with JSON.parse; nodes come from the series whose type is scatter,
 *      and on save the series data is rebuilt and the whole file re-serialised.
 */

'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const vm = require('vm');
const { execFile } = require('child_process');

// themes/butterfly/tools/echart-editor -> repo root (four levels up)
const ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const PUBLIC_DIR = path.join(__dirname, 'public');
const VENDOR_DIR = path.join(__dirname, 'vendor');

function arg(name, fallback) {
  const i = process.argv.indexOf('--' + name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

// without --file it opens on a blank canvas; files are picked in the browser
const fileArg = arg('file', null);
let FILE = fileArg ? path.resolve(ROOT, fileArg) : null;

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

/** initial option for a blank canvas (no hard-coded text colour; the blog's tune() decides) */
const DEFAULT_OPTION = {
  height: 420,
  grid: { top: 40, right: 40, bottom: 40, left: 40 },
  xAxis: { type: 'value', show: false, min: 0, max: 10 },
  yAxis: { type: 'value', show: false, min: 0, max: 10 },
  series: [
    {
      type: 'line',
      smooth: 0.4,
      symbol: 'none',
      lineStyle: { color: 'rgba(120,120,120,0.35)', width: 4 },
      data: []
    },
    {
      type: 'scatter',
      symbolSize: 26,
      z: 2,
      itemStyle: { borderColor: '#ffffff', borderWidth: 2, opacity: 0.95 },
      label: { show: true, formatter: '{b}', fontSize: 10, lineHeight: 12, distance: 8 },
      data: []
    }
  ]
};

const DEFAULT_PALETTE = {
  c1: '#4BACC6',
  c2: '#8064A2',
  c3: '#C0504D',
  c4: '#E36C0A',
  c5: '#F79646',
  c6: '#FFC000',
  c7: '#9BBB59'
};

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function readSource() {
  return fs.readFileSync(FILE, 'utf8');
}

function writeAtomic(text) {
  fs.writeFileSync(FILE + '.tmp', text, 'utf8');
  fs.renameSync(FILE + '.tmp', FILE);

  chartListCache = null; // file changed, so fence counts in the picker must be recomputed
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
 * Find every ```echarts fence in the markdown.
 * Records opening/closing line numbers, the indent and the nearest heading above, so the UI can tell them apart.
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

    if (close < 0) break; // never closed, so ignore the rest

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

/** Pull [x, y, name, colour, labelPosition] out of the scatter series */
function nodesFromOption(option) {
  const index = seriesIndexOf(option, 'scatter');
  // Radar and pie charts have no scatter series: they open for viewing with no draggable points
  if (index < 0) return [];

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

/** Write the edited nodes back into option, keeping each datum's other style fields */
function applyNodesToOption(option, nodes) {
  const scatterIndex = seriesIndexOf(option, 'scatter');
  if (scatterIndex < 0) return option; // nothing to do without a scatter series

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
// Format A: JS source
// ---------------------------------------------------------------------------

/** Locate the brackets of `const nodes = [ ... ]` */
function findNodesBlock(code) {
  const m = /const\s+nodes\s*=\s*\[/.exec(code);
  if (!m) throw new Error('no "const nodes = [ ... ]" found in the source');

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

  throw new Error('the nodes array is not closed properly');
}

/** Split array elements on top-level commas (ignoring commas inside strings and comments) */
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
 * Separate the leading comments from the entry code.
 * rawFull keeps the original blank lines and indentation so untouched entries can go back verbatim;
 * gap is the run of newlines before the entry (used to restore blank lines between sections).
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

/** Run the source in a vm to get the real option / nodes */
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
    throw new Error('could not read option from the source');
  }
  if (!Array.isArray(out.nodes)) {
    throw new Error('could not read the nodes array from the source');
  }
  return out;
}

/** Collect the colour constants in the source: const cBlue = '#4BACC6' */
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

/** Write nodes back into the JS source, replacing only the nodes block */
function writeNodesJs(code, incoming) {
  const block = findNodesBlock(code);
  const parsed = evaluate(code).nodes;
  const parts = splitTopLevel(code.slice(block.bodyStart, block.bodyEnd));
  const originals = parts.map((p, i) => ({ ...dissect(p), value: parsed[i] }));
  const palette = parsePalette(code);

  const pieces = incoming.map((node) => {
    const id = Number.isInteger(node.id) ? node.id : -1;
    const orig = id >= 0 && originals[id] ? originals[id] : null;

    // untouched entries: copy the original text, comments, blank lines and all
    if (orig && sameValue(orig.value, node)) return orig.rawFull;

    const head = orig ? orig.comments.map((c) => '  ' + c) : [];
    return (orig ? orig.gap : '\n') + head.concat(indent(renderEntry(node, palette))).join('\n');
  });

  const body = pieces.join(',') + '\n';
  return code.slice(0, block.bodyStart) + body + code.slice(block.bodyEnd);
}

// ---------------------------------------------------------------------------
// Format B: plain-JSON option
// ---------------------------------------------------------------------------

/** Custom serialiser: keep short objects and arrays on one line so diffs stay readable */
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
// Read and write
// ---------------------------------------------------------------------------

function loadChart(fenceIndex = 0) {
  const code = readSource();
  const kind = detectKind(code);

  if (kind === 'md') {
    const fences = findFences(code);

    // Article with no chart yet: hand back a blank canvas so "Insert current chart" can create one
    if (!fences.length) {
      return {
        kind,
        code,
        option: JSON.parse(JSON.stringify(DEFAULT_OPTION)),
        nodes: [],
        nodeEditable: true,
        fences: [],
        fenceIndex: 0
      };
    }

    const index = Math.min(Math.max(0, Number(fenceIndex) || 0), fences.length - 1);
    const fence = fences[index];

    let option;
    try {
      option = JSON.parse(fence.body);
    } catch (err) {
      throw new Error(`JSON in fence ${index + 1} failed to parse: ${err.message}`);
    }

    return {
      kind,
      code,
      option,
      nodes: nodesFromOption(option),
      nodeEditable: seriesIndexOf(option, 'scatter') >= 0,
      fenceIndex: index,
      fences: fences.map((f) => ({ index: f.index, line: f.openLine + 1, heading: f.heading }))
    };
  }

  if (kind === 'json') {
    let option;
    try {
      option = JSON.parse(code);
    } catch (err) {
      throw new Error(`JSON parse failed: ${err.message}`);
    }
    return {
      kind,
      code,
      option,
      nodes: nodesFromOption(option),
      nodeEditable: seriesIndexOf(option, 'scatter') >= 0,
      hexToName: {}
    };
  }

  const { option, nodes } = evaluate(code);
  return { kind, code, option, nodes, nodeEditable: true, hexToName: parsePalette(code).hexToName };
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
  if (!FILE) {
    throw new Error('no target file yet: open one, or use "Insert current chart" to create a chart');
  }

  const chart = loadChart(fenceIndex);
  const count = incoming.length;

  // markdown: replace only the fence body, nothing outside it
  if (chart.kind === 'md') {
    const fence = findFences(chart.code)[chart.fenceIndex];
    if (!fence) throw new Error('this file has no chart yet — use "Insert current chart" to add one');

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

/**
 * Charts without a scatter series (radar and the like) write the whole option back instead.
 * Only md and json are supported; in JS sources option is derived from nodes, so it cannot be overwritten wholesale.
 */
function writeOption(incoming, fenceIndex = 0) {
  if (!FILE) throw new Error('no target file yet');
  if (!incoming || typeof incoming !== 'object') throw new Error('invalid option');

  const chart = loadChart(fenceIndex);

  if (chart.kind === 'js') {
    throw new Error('use node editing for JS-format charts');
  }

  if (chart.kind === 'md') {
    const fence = findFences(chart.code)[chart.fenceIndex];
    if (!fence) throw new Error('this file has no chart yet — use "Insert current chart" first');

    const text = serializeJson(incoming);
    const body = text
      .split('\n')
      .map((line) => fence.indent + line)
      .join('\n');

    const lines = chart.code.split('\n');
    const next = [...lines.slice(0, fence.openLine + 1), body, ...lines.slice(fence.closeLine)].join('\n');

    return { count: 1, bytes: writeAtomic(next) };
  }

  return { count: 1, bytes: writeAtomic(serializeJson(incoming) + '\n') };
}

// ---------------------------------------------------------------------------
// Workspace: browse / open / create
// ---------------------------------------------------------------------------

const SKIP_DIRS = new Set(['node_modules', '.git', 'public', 'themes', '.deploy_git', '.github', '.idea', '.vscode']);

/** Keep a client-supplied relative path inside the site directory */
function resolveInRoot(relPath) {
  const target = path.resolve(ROOT, relPath);
  const rel = path.relative(ROOT, target);

  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('path is outside the site directory');
  }
  if (!fs.existsSync(target) || fs.statSync(target).isDirectory()) {
    throw new Error('file not found: ' + relPath);
  }

  return target;
}

let chartListCache = null;
let chartListPromise = null;

/**
 * Count ```echarts occurrences per markdown file in a single grep pass.
 * Reading file by file took 8s on a cold disk; grep streams it in one process and is an order of magnitude faster.
 * Returns null when grep is unavailable, and the caller falls back.
 */
function grepChartCounts(dir) {
  return new Promise((resolve) => {
    execFile(
      'grep',
      ['-rcF', '--include=*.md', '```echarts', dir],
      { cwd: ROOT, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
      (err, stdout) => {
        // exit code 1 means "no match", not a failure; only real errors (no grep installed) fall back
        if (err && typeof err.code !== 'number') return resolve(null);
        resolve(stdout || '');
      }
    );
  });
}

/** Fallback: read the files one by one (portable but slower) */
async function scanChartCounts(dir) {
  const out = [];
  const stack = [dir];

  while (stack.length) {
    const current = stack.pop();

    let entries;
    try {
      entries = await fs.promises.readdir(current, { withFileTypes: true });
    } catch (err) {
      continue;
    }

    for (const entry of entries) {
      if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;

      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (!/\.md$/i.test(entry.name)) continue;

      let text;
      try {
        text = await fs.promises.readFile(full, 'utf8');
      } catch (err) {
        continue;
      }
      if (!text.includes('echarts')) continue;

      const count = findFences(text).length;
      if (count > 0) out.push({ path: path.relative(ROOT, full), fences: count });
    }
  }

  return out;
}

/** Files that contain charts (with fence counts) */
async function buildChartList() {
  const out = [];
  const stdout = await grepChartCounts('source');

  if (stdout !== null) {
    stdout.split('\n').forEach((line) => {
      const at = line.lastIndexOf(':');
      if (at <= 0) return;

      const count = Number(line.slice(at + 1));
      if (!Number.isFinite(count) || count <= 0) return;
      out.push({ path: line.slice(0, at), fences: count });
    });
  } else {
    out.push(...(await scanChartCounts(path.join(ROOT, 'source'))));
  }

  // Standalone chart files in the repo root
  try {
    const entries = await fs.promises.readdir(ROOT, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isFile() || !/\.(json|js)$/i.test(entry.name)) continue;
      if (/^(package|package-lock|db)\.json$/i.test(entry.name)) continue;

      const text = await fs.promises.readFile(path.join(ROOT, entry.name), 'utf8');
      if (text.includes('series')) out.push({ path: entry.name, fences: 1 });
    }
  } catch (err) {
    /* root not readable — never mind */
  }

  out.sort((a, b) => a.path.localeCompare(b.path));
  chartListCache = out;
  return out;
}

/** Every file (no fence counting, so it is quick) */
function plainFileList() {
  const out = [];

  const walk = (dir, depth) => {
    if (depth > 8) return;

    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      return;
    }

    entries.forEach((entry) => {
      if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) return;

      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full, depth + 1);
        return;
      }
      if (/\.md$/i.test(entry.name)) out.push({ path: path.relative(ROOT, full), fences: null });
    });
  };

  walk(path.join(ROOT, 'source'), 0);

  try {
    fs.readdirSync(ROOT, { withFileTypes: true }).forEach((entry) => {
      if (!entry.isFile() || !/\.(json|js)$/i.test(entry.name)) return;
      if (/^(package|package-lock|db)\.json$/i.test(entry.name)) return;
      out.push({ path: entry.name, fences: null });
    });
  } catch (err) {
    /* root not readable — never mind */
  }

  out.sort((a, b) => a.path.localeCompare(b.path));
  return out;
}

async function listFiles(chartsOnly = false) {
  if (!chartsOnly) return plainFileList();
  if (chartListCache) return chartListCache;

  if (!chartListPromise) {
    chartListPromise = buildChartList().finally(() => {
      chartListPromise = null;
    });
  }

  return chartListPromise;
}

/** Where a chart can go: top of the file, after each heading, or the end */
function anchorsFor(target) {
  const lines = fs.readFileSync(target, 'utf8').split('\n');
  const anchors = [{ mode: 'start', line: 0, label: 'Top of file' }];

  lines.forEach((line, i) => {
    const m = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (m) {
      anchors.push({ mode: 'after-heading', line: i + 1, label: `line ${i + 1} · ${m[1]} ${m[2]}` });
    }
  });

  anchors.push({ mode: 'end', line: lines.length, label: 'End of file' });
  return anchors;
}

/** Insert the current canvas as a new ```echarts fence at the chosen spot */
function insertFence(payload) {
  const target = resolveInRoot(payload.path);
  const lines = fs.readFileSync(target, 'utf8').split('\n');

  const source =
    payload.option && typeof payload.option === 'object'
      ? JSON.parse(JSON.stringify(payload.option))
      : JSON.parse(JSON.stringify(DEFAULT_OPTION));

  const option = applyNodesToOption(source, payload.nodes || []);
  const json = serializeJson(option).split('\n');

  let at;
  let block;

  if (payload.mode === 'start') {
    at = 0;
    block = ['```echarts', ...json, '```', ''];
  } else if (payload.mode === 'end') {
    at = lines.length;
    block = ['', '```echarts', ...json, '```', ''];
  } else {
    at = Math.min(Math.max(0, Number(payload.line) || 0), lines.length);
    block = ['', '```echarts', ...json, '```', ''];
  }

  lines.splice(at, 0, ...block);

  const text = lines.join('\n');
  fs.writeFileSync(target + '.tmp', text, 'utf8');
  fs.renameSync(target + '.tmp', target);

  chartListCache = null;
  FILE = target;

  const openLine = at + block.indexOf('```echarts');
  const index = findFences(text).findIndex((fence) => fence.openLine === openLine);

  return { index: index >= 0 ? index : 0, file: path.relative(ROOT, target) };
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
        reject(new Error('request body too large'));
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
  if (!FILE) {
    return {
      file: null,
      kind: 'blank',
      fences: [],
      fenceIndex: 0,
      mtime: 0,
      nodes: [],
      nodeEditable: true,
      option: JSON.parse(JSON.stringify(DEFAULT_OPTION)),
      palette: { ...DEFAULT_PALETTE },
      axis: { xMin: 0, xMax: 10, yMin: 0, yMax: 10 }
    };
  }

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
    nodeEditable: chart.nodeEditable !== false,
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

// ---------------------------------------------------------------------------
// Liveness: quit once the tab is closed, so nothing keeps sitting on the port
// ---------------------------------------------------------------------------

const KEEP_ALIVE = process.argv.includes('--keep-alive'); // stay alive, never auto-quit
const CLIENT_TIMEOUT = 120000; // quit after this long with no heartbeat (crash or sleep)
const EXIT_GRACE = 3000; // grace period after a page closes, so a reload is not killed by mistake

const clients = new Map(); // page id -> last heartbeat
let hadClient = false;
let exitTimer = null;

function cancelExit() {
  if (!exitTimer) return;
  clearTimeout(exitTimer);
  exitTimer = null;
}

function scheduleExit(reason) {
  if (KEEP_ALIVE || exitTimer) return;

  console.log(`\n[exit] ${reason}, shutting down in ${EXIT_GRACE / 1000}s…`);
  exitTimer = setTimeout(() => {
    console.log('[exit] stopped');
    process.exit(0);
  }, EXIT_GRACE);
}

setInterval(() => {
  if (KEEP_ALIVE) return;

  const now = Date.now();
  for (const [id, seen] of clients) {
    if (now - seen > CLIENT_TIMEOUT) clients.delete(id);
  }

  if (hadClient && clients.size === 0) scheduleExit('page went quiet');
}, 30000);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  try {
    if (url.pathname === '/api/ping' && req.method === 'POST') {
      const payload = JSON.parse((await readBody(req)) || '{}');
      if (payload.id) {
        const id = String(payload.id);
        const isNew = !clients.has(id);
        clients.set(id, Date.now());
        hadClient = true;
        if (isNew) {
          const total = clients.size;
          console.log(`[page] connected (${total} page${total === 1 ? '' : 's'} open)`);
        }
      }
      cancelExit();
      return sendJson(res, 200, { ok: true });
    }

    if (url.pathname === '/api/bye' && req.method === 'POST') {
      const payload = JSON.parse((await readBody(req)) || '{}');
      if (payload.id && clients.delete(String(payload.id))) {
        const left = clients.size;
        console.log(`[page] disconnected (${left} page${left === 1 ? '' : 's'} left)`);
      }
      if (hadClient && clients.size === 0) scheduleExit('page closed');
      return sendJson(res, 200, { ok: true });
    }

    if (url.pathname === '/api/state' && req.method === 'GET') {
      return sendJson(res, 200, buildState(Number(url.searchParams.get('fence') || 0)));
    }

    if (url.pathname === '/api/nodes' && req.method === 'POST') {
      const raw = await readBody(req);
      const payload = JSON.parse(raw);

      if (!Array.isArray(payload.nodes)) {
        return sendJson(res, 400, { ok: false, error: 'nodes must be an array' });
      }

      const result = writeNodes(payload.nodes, Number(payload.fence ?? 0));
      console.log(`[sync] ${path.basename(FILE)} <- ${result.count} node(s)`);

      return sendJson(res, 200, {
        ok: true,
        savedAt: new Date().toLocaleTimeString('zh-CN', { hour12: false })
      });
    }

    if (url.pathname === '/api/option' && req.method === 'POST') {
      const payload = JSON.parse(await readBody(req));
      const result = writeOption(payload.option, Number(payload.fence ?? 0));
      console.log(`[sync] ${path.basename(FILE)} <- option (data mode)`);

      return sendJson(res, 200, {
        ok: true,
        savedAt: new Date().toLocaleTimeString('zh-CN', { hour12: false })
      });
    }

    if (url.pathname === '/api/files' && req.method === 'GET') {
      const chartsOnly = url.searchParams.get('charts') === '1';
      return sendJson(res, 200, { files: await listFiles(chartsOnly), chartsOnly });
    }

    if (url.pathname === '/api/anchors' && req.method === 'GET') {
      const target = resolveInRoot(url.searchParams.get('path') || '');
      return sendJson(res, 200, { anchors: anchorsFor(target) });
    }

    if (url.pathname === '/api/open' && req.method === 'POST') {
      const payload = JSON.parse(await readBody(req));
      FILE = resolveInRoot(payload.path);
      console.log(`[open] ${payload.path}`);
      return sendJson(res, 200, { ok: true, state: buildState(0) });
    }

    if (url.pathname === '/api/insert' && req.method === 'POST') {
      const payload = JSON.parse(await readBody(req));
      const result = insertFence(payload);
      console.log(`[insert] ${result.file} <- new fence #${result.index + 1}`);
      return sendJson(res, 200, { ok: true, index: result.index, state: buildState(result.index) });
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

// If the port is taken (usually a leftover instance) try the next one rather than throwing EADDRINUSE
let port = BASE_PORT;
let attempts = 0;

server.on('error', (err) => {
  if (err.code !== 'EADDRINUSE' || attempts >= 20) {
    console.error(`failed to start: ${err.message}`);
    process.exit(1);
  }
  attempts++;
  port = BASE_PORT + attempts;
  server.listen(port);
});

/** Open the browser once listening (disable with --no-open) */
function openBrowser(url) {
  const win = process.platform === 'win32';
  const bin = win ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = win ? ['/c', 'start', '', url] : [url];

  execFile(bin, args, () => {
    /* if it does not open, carry on regardless */
  });
}

server.on('listening', () => {
  if (attempts > 0) {
    console.log(`port ${BASE_PORT} was busy (a previous instance?), now listening on ${port}`);
  }

  const url = `http://localhost:${port}`;
  console.log(`ECharts editor  ${url}`);
  console.log(`Target          ${FILE || '(none yet — pick a file in the browser)'}`);
  console.log(KEEP_ALIVE ? 'staying alive · Ctrl+C to quit' : 'quits when the page closes · Ctrl+C also works');

  if (!NO_OPEN) openBrowser(url);

  // Warm the "charts only" index in the background so the dialog opens instantly
  listFiles(true).catch(() => {
    /* a failed warm-up is harmless */
  });
});

server.listen(port);
