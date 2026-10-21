/* global echarts */
'use strict';

const $ = (sel) => document.querySelector(sel);

const LABEL_POSITIONS = ['left', 'right', 'top', 'bottom', 'inside'];

const state = {
  file: '',
  kind: 'js',
  fences: [],
  fenceIndex: 0,
  nodeEditable: true,
  nodes: [],
  option: null,
  palette: {},
  axis: { xMin: 0, xMax: 1, yMin: 0, yMax: 1 },
  autoSync: true,
  showGrid: false,
  snap: false,
  blogMode: true,
  dark: false,
  timer: null,
  drag: null,
  selected: new Set(),
  selKey: '',
  rowMap: new Map(),
  rows: [],
  history: [],
  future: [],
  lastHistoryAt: 0,
  keySeq: 0
};

let chart;

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const round1 = (v) => Math.round(v * 10) / 10;
const quantize = (v) => (state.snap ? Math.round(v * 2) / 2 : round1(v));

function setStatus(text, kind) {
  const el = $('#status');
  el.textContent = text;
  el.className = 'status' + (kind ? ' ' + kind : '');
}

function selectedNodes() {
  return state.nodes.filter((n) => state.selected.has(n));
}

/** When the chart cannot be written straight back to the source file */
function persistBlocked() {
  if (!state.file) return 'Blank canvas — use "Open… → Insert current chart" to write it into a file';
  if (state.kind === 'md' && !state.fences.length) return 'No chart in this file yet — create one with "Insert current chart"';
  return null;
}

// ---------------------------------------------------------------------------
// Undo / redo
// ---------------------------------------------------------------------------

function snapshot() {
  return state.nodes.map((n) => ({ ...n }));
}

function pushHistory() {
  state.history.push(snapshot());
  if (state.history.length > 80) state.history.shift();
  state.future.length = 0;
  state.lastHistoryAt = Date.now();
  updateHistoryButtons();
}

/** Avoid piling up dozens of history steps while dragging a colour well or typing */
function pushHistoryOnce(gap = 800) {
  if (Date.now() - state.lastHistoryAt < gap) return;
  pushHistory();
}

function undo() {
  if (!state.history.length) return;
  state.future.push(snapshot());
  restore(state.history.pop());
}

function redo() {
  if (!state.future.length) return;
  state.history.push(snapshot());
  restore(state.future.pop());
}

function restore(nodes) {
  const keys = new Set([...state.selected].map((n) => n.key));
  state.nodes = nodes;
  state.selected = new Set(state.nodes.filter((n) => keys.has(n.key)));
  buildPanel();
  refreshUI();
  scheduleSync();
  updateHistoryButtons();
}

function updateHistoryButtons() {
  $('#undo').disabled = state.history.length === 0;
  $('#redo').disabled = state.future.length === 0;
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

function toggleSelection(node) {
  if (state.selected.has(node)) state.selected.delete(node);
  else state.selected.add(node);
}

function selectOnly(node) {
  state.selected = new Set(node ? [node] : []);
}

function clearSelection() {
  state.selected.clear();
  refreshUI();
}

function selectAll() {
  state.selected = new Set(state.nodes);
  refreshUI();
}

function updateSelBar() {
  const bar = $('#selbar');
  const list = selectedNodes();
  const count = list.length;

  bar.hidden = count === 0;
  $('#selCount').textContent = count;

  bar.querySelectorAll('[data-act="align-x"], [data-act="align-y"]').forEach((b) => {
    b.disabled = count < 2;
  });
  bar.querySelectorAll('[data-act="dist-x"], [data-act="dist-y"]').forEach((b) => {
    b.disabled = count < 3;
  });

  const key = list.map((n) => n.key).sort().join(',');
  if (key !== state.selKey) {
    state.selKey = key;
    $('#selColor').value = (list[0] && list[0].color) || '#4bacc6';
    $('#selPos').value = '';
  }
}

function updateRowStates() {
  state.rowMap.forEach((row, node) => {
    row.root.classList.toggle('selected', state.selected.has(node));
  });
}

function refreshUI() {
  refreshChart();
  updateRowStates();
  updateSelBar();
}

// ---------------------------------------------------------------------------
// Mirror the blog's rendering environment
// ---------------------------------------------------------------------------

// Theme .layout maxes out at 1200px (15px padding) → post card 74% → minus ~40px padding ≈ 786px
const ARTICLE_WIDTH = 786;

/**
 * Matches tune() in themes/butterfly/scripts/filters/echarts-fence.js:
 * background forced transparent; text, axis lines and grid recoloured for light and dark.
 */
function blogTune(option, dark) {
  const out = JSON.parse(JSON.stringify(option));

  const text = dark ? '#c9d1d9' : '#4c4948';
  const line = dark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.12)';
  const area = dark
    ? ['rgba(255,255,255,0.03)', 'rgba(255,255,255,0.06)']
    : ['rgba(0,0,0,0.02)', 'rgba(0,0,0,0.04)'];

  out.backgroundColor = 'transparent';
  out.textStyle = Object.assign({ color: text }, out.textStyle);

  if (out.legend) {
    out.legend.textStyle = Object.assign({ color: text }, out.legend.textStyle);
  }

  if (out.radar) {
    out.radar.axisName = Object.assign({ color: text }, out.radar.axisName);
    out.radar.axisLine = Object.assign({ lineStyle: { color: line } }, out.radar.axisLine);
    out.radar.splitLine = Object.assign({ lineStyle: { color: line } }, out.radar.splitLine);
    out.radar.splitArea = Object.assign({ areaStyle: { color: area } }, out.radar.splitArea);
  }

  ['xAxis', 'yAxis'].forEach((key) => {
    if (!out[key]) return;

    const list = Array.isArray(out[key]) ? out[key] : [out[key]];
    list.forEach((axis) => {
      axis.axisLabel = Object.assign({ color: text }, axis.axisLabel);
      axis.axisLine = Object.assign({ lineStyle: { color: line } }, axis.axisLine);
    });
  });

  return out;
}

/** Canvas size matches the blog: width of #article-container .echarts-wrap, height from the height field */
function applyStage() {
  const stage = $('#stage');
  const height = Number(state.option.height) || 420;

  stage.style.width = ARTICLE_WIDTH + 'px';
  stage.style.height = height + 'px';
  stage.dataset.mode = state.blogMode ? (state.dark ? 'dark' : 'light') : 'raw';

  $('#sizeNote').textContent = ARTICLE_WIDTH + ' × ' + height + 'px';

  if (chart) chart.resize();
}

// ---------------------------------------------------------------------------
// Chart
// ---------------------------------------------------------------------------

function buildOption() {
  const opt = JSON.parse(JSON.stringify(state.option));

  // on the blog, height is the container-size convention and never reaches option
  delete opt.height;

  // node mode: series is rebuilt from nodes; data mode: option is the source of truth, used as is
  if (state.nodeEditable) {
    const lineIndex = opt.series.findIndex((s) => s && s.type === 'line');
    const scatterIndex = opt.series.findIndex((s) => s && s.type === 'scatter');

    if (lineIndex >= 0) {
      const line = state.nodes.map((n) => [n.x, n.y]);
      if (line.length > 1) line.push([state.nodes[0].x, state.nodes[0].y]);
      opt.series[lineIndex].data = line;
    }

    if (scatterIndex >= 0) {
      const originals = opt.series[scatterIndex].data || [];

      opt.series[scatterIndex].data = state.nodes.map((n) => {
        // keep the datum's own style fields (some labels set fontSize individually)
        const base = n.id != null && originals[n.id] && !Array.isArray(originals[n.id]) ? originals[n.id] : {};
        const selected = state.selected.has(n);

        return {
          name: n.name,
          value: [n.x, n.y],
          itemStyle: {
            ...(base.itemStyle || {}),
            color: n.color,
            ...(selected ? { borderColor: '#ffffff', borderWidth: 3 } : {})
          },
          label: { ...(base.label || {}), position: n.label }
        };
      });
    }
  }

  // Reference grid (borrows the axis splitLine; the axis itself stays hidden)
  ['xAxis', 'yAxis'].forEach((name) => {
    const axis = Array.isArray(opt[name]) ? opt[name][0] : opt[name];
    if (!axis) return;

    axis.show = state.showGrid;
    axis.interval = 1;
    axis.axisLine = { show: false };
    axis.axisTick = { show: false };
    axis.axisLabel = { show: false };
    axis.splitLine = {
      show: state.showGrid,
      lineStyle: { color: 'rgba(255,255,255,0.08)', type: 'dashed' }
    };
  });

  return state.blogMode ? blogTune(opt, state.dark) : opt;
}

function refreshChart() {
  chart.setOption(buildOption(), true);
}

// ---------------------------------------------------------------------------
// Dragging / marquee
// ---------------------------------------------------------------------------

function pickNode(px, py) {
  let best = null;
  let bestDist = 18;

  state.nodes.forEach((n) => {
    const p = chart.convertToPixel({ gridIndex: 0 }, [n.x, n.y]);
    if (!p) return;
    const d = Math.hypot(p[0] - px, p[1] - py);
    if (d < bestDist) {
      bestDist = d;
      best = n;
    }
  });

  return best;
}

function paintMarquee(rect) {
  const box = $('#marquee');
  box.style.display = 'block';
  box.style.left = Math.min(rect.x0, rect.x1) + 'px';
  box.style.top = Math.min(rect.y0, rect.y1) + 'px';
  box.style.width = Math.abs(rect.x1 - rect.x0) + 'px';
  box.style.height = Math.abs(rect.y1 - rect.y0) + 'px';
}

function applyMarquee(rect, additive) {
  const left = Math.min(rect.x0, rect.x1);
  const right = Math.max(rect.x0, rect.x1);
  const top = Math.min(rect.y0, rect.y1);
  const bottom = Math.max(rect.y0, rect.y1);

  const picked = state.nodes.filter((n) => {
    const p = chart.convertToPixel({ gridIndex: 0 }, [n.x, n.y]);
    return p && p[0] >= left && p[0] <= right && p[1] >= top && p[1] <= bottom;
  });

  state.selected = additive ? new Set([...state.selected, ...picked]) : new Set(picked);
}

function bindZr() {
  const zr = chart.getZr();

  zr.on('mousedown', (e) => {
    const hit = pickNode(e.offsetX, e.offsetY);
    const shift = Boolean(e.event && e.event.shiftKey);

    if (!hit) {
      state.drag = {
        mode: 'marquee',
        additive: shift,
        rect: { x0: e.offsetX, y0: e.offsetY, x1: e.offsetX, y1: e.offsetY }
      };
      paintMarquee(state.drag.rect);
      return;
    }

    if (shift) {
      toggleSelection(hit);
      refreshUI();
      return;
    }

    if (!state.selected.has(hit)) {
      selectOnly(hit);
      refreshUI();
    }

    const origin = chart.convertFromPixel({ gridIndex: 0 }, [e.offsetX, e.offsetY]) || [hit.x, hit.y];

    state.drag = {
      mode: 'nodes',
      pushed: false,
      start: { x: origin[0], y: origin[1] },
      items: [...state.selected].map((node) => ({ node, x0: node.x, y0: node.y }))
    };

    zr.setCursorStyle('grabbing');
  });

  zr.on('mousemove', (e) => {
    const drag = state.drag;

    if (!drag) {
      zr.setCursorStyle(pickNode(e.offsetX, e.offsetY) ? 'grab' : 'default');
      return;
    }

    if (drag.mode === 'marquee') {
      drag.rect.x1 = e.offsetX;
      drag.rect.y1 = e.offsetY;
      paintMarquee(drag.rect);
      return;
    }

    const point = chart.convertFromPixel({ gridIndex: 0 }, [e.offsetX, e.offsetY]);
    if (!point) return;

    if (!drag.pushed) {
      pushHistory();
      drag.pushed = true;
    }

    const dx = point[0] - drag.start.x;
    const dy = point[1] - drag.start.y;

    drag.items.forEach((item) => {
      item.node.x = quantize(clamp(item.x0 + dx, state.axis.xMin, state.axis.xMax));
      item.node.y = quantize(clamp(item.y0 + dy, state.axis.yMin, state.axis.yMax));
      syncRowFor(item.node);
    });

    refreshChart();
    scheduleSync();
  });

  const endDrag = () => {
    const drag = state.drag;
    if (!drag) return;

    state.drag = null;
    zr.setCursorStyle('default');

    if (drag.mode === 'marquee') {
      $('#marquee').style.display = 'none';
      const moved = Math.abs(drag.rect.x1 - drag.rect.x0) > 3 || Math.abs(drag.rect.y1 - drag.rect.y0) > 3;

      if (moved) applyMarquee(drag.rect, drag.additive);
      else if (!drag.additive) state.selected.clear();

      refreshUI();
      return;
    }

    refreshUI();
    scheduleSync();
  };

  zr.on('mouseup', endDrag);
  zr.on('globalout', endDrag);
}

// ---------------------------------------------------------------------------
// Bulk actions
// ---------------------------------------------------------------------------

function afterBatch() {
  refreshChart();
  updateSelBar();
  scheduleSync();
}

function batchAction(act) {
  const list = selectedNodes();
  if (!list.length) return;

  if (act === 'clear') {
    clearSelection();
    return;
  }

  if (act === 'delete') {
    pushHistory();
    state.nodes = state.nodes.filter((n) => !state.selected.has(n));
    state.selected.clear();
    buildPanel();
    refreshUI();
    scheduleSync();
    return;
  }

  if (act === 'align-x' || act === 'align-y') {
    if (list.length < 2) return;
    const key = act === 'align-y' ? 'y' : 'x';
    pushHistory();

    const avg = list.reduce((sum, n) => sum + n[key], 0) / list.length;
    const value = round1(avg);
    list.forEach((n) => {
      n[key] = value;
      syncRowFor(n);
    });

    afterBatch();
    return;
  }

  if (act === 'dist-x' || act === 'dist-y') {
    if (list.length < 3) return;
    const key = act === 'dist-x' ? 'x' : 'y';
    const sorted = list.slice().sort((a, b) => a[key] - b[key]);
    pushHistory();

    const first = sorted[0][key];
    const last = sorted[sorted.length - 1][key];
    const step = (last - first) / (sorted.length - 1);

    sorted.forEach((n, i) => {
      n[key] = round1(first + step * i);
      syncRowFor(n);
    });

    afterBatch();
  }
}

function applyBatchColor(hex) {
  const list = selectedNodes();
  if (!list.length) return;

  pushHistoryOnce();
  list.forEach((node) => {
    node.color = hex;
    const row = state.rowMap.get(node);
    if (row) row.color.value = hex;
  });

  refreshChart();
  scheduleSync();
}

function applyBatchLabel(position) {
  const list = selectedNodes();
  if (!list.length) return;

  pushHistoryOnce();
  list.forEach((node) => {
    node.label = position;
    const row = state.rowMap.get(node);
    if (row) row.pos.value = position;
  });

  refreshChart();
  scheduleSync();
}

function nudge(dx, dy) {
  const list = selectedNodes();
  if (!list.length) return;

  pushHistoryOnce();
  list.forEach((node) => {
    node.x = round1(clamp(node.x + dx, state.axis.xMin, state.axis.xMax));
    node.y = round1(clamp(node.y + dy, state.axis.yMin, state.axis.yMax));
    syncRowFor(node);
  });

  afterBatch();
}

// ---------------------------------------------------------------------------
// Side panel
// ---------------------------------------------------------------------------

function numberInput(value) {
  const input = document.createElement('input');
  input.type = 'number';
  input.step = '0.1';
  input.value = String(value);
  return input;
}

function field(labelText, input) {
  const wrap = document.createElement('label');
  wrap.className = 'field';

  const span = document.createElement('span');
  span.textContent = labelText;

  wrap.append(span, input);
  return { wrap, input };
}

function makeRow(node) {
  const root = document.createElement('div');
  root.className = 'row';

  const top = document.createElement('div');
  top.className = 'row-top';

  const color = document.createElement('input');
  color.type = 'color';
  color.className = 'color';
  color.value = node.color;

  const name = document.createElement('textarea');
  name.className = 'name';
  name.rows = 2;
  name.spellcheck = false;
  name.value = node.name;

  const del = document.createElement('button');
  del.className = 'del';
  del.textContent = '×';
  del.title = 'Delete this node';

  top.append(color, name, del);

  const bottom = document.createElement('div');
  bottom.className = 'row-bot';

  const fx = field('x', numberInput(node.x));
  const fy = field('y', numberInput(node.y));

  const posWrap = document.createElement('label');
  posWrap.className = 'pos-field';
  posWrap.append(document.createTextNode('Label'));

  const pos = document.createElement('select');
  LABEL_POSITIONS.forEach((value) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = value;
    pos.appendChild(option);
  });
  pos.value = LABEL_POSITIONS.includes(node.label) ? node.label : 'right';
  posWrap.appendChild(pos);

  bottom.append(fx.wrap, fy.wrap, posWrap);
  root.append(top, bottom);

  const row = { root, node, x: fx.input, y: fy.input, name, color, pos };

  // Click the row to select; Shift adds
  root.addEventListener('mousedown', (e) => {
    if (e.target.closest('input, textarea, select, button')) return;

    if (e.shiftKey) toggleSelection(node);
    else selectOnly(node);

    refreshUI();
  });

  color.addEventListener('focus', () => pushHistory());
  color.addEventListener('input', () => {
    node.color = color.value;
    refreshChart();
    scheduleSync();
  });

  name.addEventListener('focus', () => pushHistory());
  name.addEventListener('input', () => {
    node.name = name.value;
    refreshChart();
    scheduleSync();
  });

  const bindNumber = (input, key) => {
    input.addEventListener('focus', () => pushHistory());

    input.addEventListener('input', () => {
      const value = Number(input.value);
      if (!Number.isFinite(value)) return;
      node[key] = value;
      refreshChart();
      scheduleSync();
    });

    input.addEventListener('change', () => {
      const value = Number(input.value);
      if (!Number.isFinite(value)) {
        input.value = String(node[key]);
        return;
      }
      const min = key === 'x' ? state.axis.xMin : state.axis.yMin;
      const max = key === 'x' ? state.axis.xMax : state.axis.yMax;
      node[key] = round1(clamp(value, min, max));
      input.value = String(node[key]);
      refreshChart();
      scheduleSync();
    });
  };

  bindNumber(fx.input, 'x');
  bindNumber(fy.input, 'y');

  pos.addEventListener('change', () => {
    pushHistory();
    node.label = pos.value;
    refreshChart();
    scheduleSync();
  });

  del.addEventListener('click', () => {
    pushHistory();
    state.nodes = state.nodes.filter((n) => n !== node);
    state.selected.delete(node);
    buildPanel();
    refreshUI();
    scheduleSync();
  });

  return row;
}

/** Data mode: turn the numbers in series into editable inputs */
function buildDataEditor(box) {
  const series = Array.isArray(state.option.series) ? state.option.series : [];
  const indicators =
    state.option.radar && Array.isArray(state.option.radar.indicator)
      ? state.option.radar.indicator.map((item) => (item && item.name) || '')
      : [];

  series.forEach((entry, si) => {
    if (!entry || !Array.isArray(entry.data) || !entry.data.length) return;

    const block = document.createElement('div');
    block.className = 'data-block';

    const head = document.createElement('div');
    head.className = 'data-head';
    head.textContent = `series[${si}] · ${entry.type || 'series'}`;
    block.appendChild(head);

    entry.data.forEach((row, ri) => {
      const line = document.createElement('div');
      line.className = 'data-row';

      const label = document.createElement('span');
      label.className = 'data-label';
      label.textContent = row && typeof row === 'object' && row.name ? row.name : `#${ri + 1}`;
      line.appendChild(label);

      const group = document.createElement('div');
      group.className = 'data-values';
      line.appendChild(group);

      renderValueCells(group, entry.data, ri, indicators);
      block.appendChild(line);
    });

    box.appendChild(block);
  });

  if (!box.querySelector('.data-num')) {
    const empty = document.createElement('p');
    empty.className = 'notice';
    empty.textContent = "No editable numbers in this chart's series.";
    box.appendChild(empty);
  }
}

/** A row may be a number, an array of numbers or {value: ...}; all become inputs */
function renderValueCells(container, data, index, indicators) {
  const item = data[index];

  const make = (value, apply, hint) => {
    const input = document.createElement('input');
    input.type = 'number';
    input.step = 'any';
    input.className = 'data-num';
    input.value = String(value);
    if (hint) input.title = hint;

    input.addEventListener('input', () => {
      const next = Number(input.value);
      if (!Number.isFinite(next)) return;

      apply(next);
      refreshChart();
      scheduleSync();
    });

    container.appendChild(input);
  };

  if (typeof item === 'number') {
    make(item, (next) => {
      data[index] = next;
    });
    return;
  }

  if (Array.isArray(item)) {
    item.forEach((value, vi) => {
      if (typeof value !== 'number') return;
      make(
        value,
        (next) => {
          item[vi] = next;
        },
        indicators[vi]
      );
    });
    return;
  }

  if (item && typeof item === 'object') {
    const value = item.value;

    if (typeof value === 'number') {
      make(value, (next) => {
        item.value = next;
      });
      return;
    }

    if (Array.isArray(value)) {
      value.forEach((single, vi) => {
        if (typeof single !== 'number') return;
        make(
          single,
          (next) => {
            value[vi] = next;
          },
          indicators[vi]
        );
      });
    }
  }
}

function buildPanel() {
  const box = $('#nodes');
  box.innerHTML = '';
  state.rows = [];
  state.rowMap = new Map();

  // No scatter nodes: fall back to editing the numbers
  if (!state.nodeEditable) {
    const notice = document.createElement('p');
    notice.className = 'notice';
    notice.textContent = 'This chart has no scatter nodes, so edit the numbers below.';
    box.appendChild(notice);

    buildDataEditor(box);

    $('#count').textContent = '0';
    $('#add').disabled = true;
    return;
  }

  $('#add').disabled = false;

  state.nodes.forEach((node) => {
    const row = makeRow(node);
    state.rows.push(row);
    state.rowMap.set(node, row);
    box.appendChild(row.root);
  });

  $('#count').textContent = state.nodes.length;
  updateRowStates();
}

function syncRowFor(node) {
  const row = state.rowMap.get(node);
  if (!row) return;

  if (document.activeElement !== row.x) row.x.value = String(node.x);
  if (document.activeElement !== row.y) row.y.value = String(node.y);
}

function addNode() {
  if (!state.nodeEditable) return;

  pushHistory();

  const colors = Object.values(state.palette);
  const node = {
    id: null,
    key: 'n' + state.keySeq++,
    x: round1((state.axis.xMin + state.axis.xMax) / 2),
    y: round1((state.axis.yMin + state.axis.yMax) / 2),
    name: 'NEW',
    color: (colors[0] || '#4bacc6').toLowerCase(),
    label: 'right'
  };

  state.nodes.push(node);
  selectOnly(node);

  buildPanel();
  refreshUI();
  scheduleSync();
}

// ---------------------------------------------------------------------------
// Open a file / create a chart
// ---------------------------------------------------------------------------

let fileCache = null; // all files
let chartCache = null; // files that contain charts
let selectedFile = null;
let anchorCache = [];

/** Fetch the list that matches the "charts only" toggle */
async function ensureFileList() {
  const chartsOnly = $('#onlyCharts').checked;

  if (chartsOnly) {
    if (!chartCache) {
      const data = await (await fetch('/api/files?charts=1')).json();
      chartCache = data.files || [];
    }
    return;
  }

  if (!fileCache) {
    const data = await (await fetch('/api/files')).json();
    fileCache = data.files || [];
  }
}

function activeFiles() {
  return $('#onlyCharts').checked ? chartCache || [] : fileCache || [];
}

async function showFileModal() {
  $('#fileModal').hidden = false;
  $('#fileSearch').value = '';

  try {
    await ensureFileList();
  } catch (err) {
    setStatus('Could not read the file list: ' + err.message, 'err');
  }

  renderFileList();
}

function renderFileList() {
  const query = $('#fileSearch').value.trim().toLowerCase();
  const list = $('#fileList');
  list.innerHTML = '';

  const files = activeFiles()
    .filter((item) => !query || item.path.toLowerCase().includes(query))
    .slice(0, 500);

  if (!files.length) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = $('#onlyCharts').checked ? 'No file contains a chart yet' : 'No matching files';
    list.appendChild(empty);
    return;
  }

  files.forEach((item) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'file-item' + (item.path === selectedFile ? ' active' : '');
    button.dataset.path = item.path;
    button.textContent = item.fences ? `${item.path}   ·   ${item.fences} chart(s)` : item.path;
    list.appendChild(button);
  });
}

async function pickFile(file) {
  selectedFile = file;
  renderFileList();
  $('#modalOpen').disabled = false;

  const isMarkdown = /\.md$/i.test(file);
  const select = $('#anchorSel');

  anchorCache = [];
  select.innerHTML = '<option value="">Insert at…</option>';
  select.disabled = !isMarkdown;
  $('#modalInsert').disabled = true;

  if (!isMarkdown) return;

  try {
    const data = await (await fetch('/api/anchors?path=' + encodeURIComponent(file))).json();
    if (!data.anchors) throw new Error(data.error || 'read failed');

    anchorCache = data.anchors;
    data.anchors.forEach((anchor, i) => {
      const option = document.createElement('option');
      option.value = String(i);
      option.textContent = anchor.label;
      select.appendChild(option);
    });
  } catch (err) {
    setStatus('Could not read insert positions: ' + err.message, 'err');
  }
}

async function postJson(url, payload) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await res.json();
  if (!res.ok || !data.ok) throw new Error(data.error || res.statusText);
  return data;
}

async function openSelectedFile() {
  if (!selectedFile) return;
  setStatus('Opening…', 'busy');

  try {
    const data = await postJson('/api/open', { path: selectedFile });
    applyData(data.state);
    $('#fileModal').hidden = true;
    setStatus('Opened', 'ok');
  } catch (err) {
    setStatus('Open failed: ' + err.message, 'err');
  }
}

async function insertCurrentChart() {
  const anchor = anchorCache[Number($('#anchorSel').value)];
  if (!selectedFile || !anchor) return;

  setStatus('Inserting…', 'busy');

  try {
    const data = await postJson('/api/insert', {
      path: selectedFile,
      mode: anchor.mode,
      line: anchor.line,
      nodes: state.nodes,
      option: state.option
    });

    chartCache = null; // fence count changed; recount next time the dialog opens
    applyData(data.state);
    $('#fileModal').hidden = true;
    setStatus(`Inserted into ${data.state.file} · fence ${data.index + 1}`, 'ok');
  } catch (err) {
    setStatus('Insert failed: ' + err.message, 'err');
  }
}

function bindFileModal() {
  $('#openFile').addEventListener('click', showFileModal);
  $('#modalClose').addEventListener('click', () => {
    $('#fileModal').hidden = true;
  });

  $('#fileModal').addEventListener('click', (e) => {
    if (e.target.id === 'fileModal') $('#fileModal').hidden = true;
  });

  $('#fileSearch').addEventListener('input', renderFileList);

  $('#onlyCharts').addEventListener('change', async () => {
    try {
      await ensureFileList();
      renderFileList();
    } catch (err) {
      setStatus('Could not read the file list: ' + err.message, 'err');
    }
  });

  $('#fileList').addEventListener('click', (e) => {
    const item = e.target.closest('.file-item');
    if (item) pickFile(item.dataset.path);
  });

  $('#modalOpen').addEventListener('click', openSelectedFile);

  $('#anchorSel').addEventListener('change', (e) => {
    $('#modalInsert').disabled = !e.target.value;
  });

  $('#modalInsert').addEventListener('click', insertCurrentChart);
}

// ---------------------------------------------------------------------------
// Sync to source
// ---------------------------------------------------------------------------

async function save() {
  clearTimeout(state.timer);

  const blocked = persistBlocked();
  if (blocked) {
    setStatus(blocked, 'warn');
    return;
  }

  setStatus('Syncing…', 'busy');

  try {
    const res = await fetch(state.nodeEditable ? '/api/nodes' : '/api/option', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        state.nodeEditable
          ? { nodes: state.nodes, fence: state.fenceIndex }
          : { option: state.option, fence: state.fenceIndex }
      )
    });
    const data = await res.json();

    if (!res.ok || !data.ok) throw new Error(data.error || res.statusText);
    setStatus('Synced ' + data.savedAt, 'ok');
  } catch (err) {
    setStatus('Sync failed: ' + err.message, 'err');
  }
}

function scheduleSync() {
  clearTimeout(state.timer);

  const blocked = persistBlocked();
  if (blocked) {
    setStatus(blocked, 'warn');
    return;
  }

  if (!state.autoSync) {
    setStatus('Unsaved changes', 'warn');
    return;
  }

  setStatus('Syncing…', 'busy');
  state.timer = setTimeout(save, 350);
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

function bindKeyboard() {
  document.addEventListener('keydown', (e) => {
    const tag = (e.target.tagName || '').toLowerCase();
    const typing = tag === 'input' || tag === 'textarea' || tag === 'select';
    const meta = e.metaKey || e.ctrlKey;

    if (meta && e.key.toLowerCase() === 's') {
      e.preventDefault();
      save();
      return;
    }

    if (meta && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
      return;
    }

    if (meta && e.key.toLowerCase() === 'a' && !typing) {
      e.preventDefault();
      selectAll();
      return;
    }

    if (e.key === 'Escape' && !$('#fileModal').hidden) {
      $('#fileModal').hidden = true;
      return;
    }

    if (e.key === 'Escape') {
      if (state.selected.size) clearSelection();
      e.target.blur?.();
      return;
    }

    if (typing || !state.selected.size) return;

    const step = e.shiftKey ? 0.5 : 0.1;
    const deltas = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, step],
      ArrowDown: [0, -step]
    };
    const delta = deltas[e.key];
    if (!delta) return;

    e.preventDefault();
    nudge(delta[0], delta[1]);
  });
}

async function loadState(fence = 0) {
  const res = await fetch('/api/state?fence=' + fence);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

/** Feed the /api/state response into the page; the first call also initialises the chart */
function applyData(data) {
  Object.assign(state, {
    file: data.file,
    kind: data.kind || 'js',
    fences: data.fences || [],
    fenceIndex: data.fenceIndex || 0,
    nodeEditable: data.nodeEditable !== false,
    nodes: data.nodes,
    option: data.option,
    palette: data.palette,
    axis: data.axis,
    selKey: ''
  });

  state.nodes.forEach((n, i) => {
    n.key = 'k' + i;
  });
  state.keySeq = state.nodes.length;
  state.selected.clear();
  state.history.length = 0;
  state.future.length = 0;

  $('#file').textContent = data.file || 'Blank canvas';

  buildFencePicker();
  applyStage();

  if (!chart) {
    chart = echarts.init($('#chart'), null, { renderer: 'canvas' });
    bindZr();
  }

  buildPanel();
  refreshUI();
  updateHistoryButtons();
}

/** A markdown file may hold several ```echarts fences, so let the user pick one */
function buildFencePicker() {
  const picker = $('#fencePicker');
  const fences = state.fences || [];

  picker.hidden = fences.length === 0;
  if (!fences.length) return;

  picker.innerHTML = '';
  fences.forEach((fence) => {
    const option = document.createElement('option');
    option.value = String(fence.index);
    option.textContent = `Fence ${fence.index + 1} · line ${fence.line}${fence.heading ? ' · ' + fence.heading : ''}`;
    picker.appendChild(option);
  });

  picker.value = String(state.fenceIndex);
}

// ---------------------------------------------------------------------------
// Heartbeat: let the server quit once the page closes
// ---------------------------------------------------------------------------

const CLIENT_ID = 'c' + Math.random().toString(36).slice(2, 10);

function pingServer() {
  fetch('/api/ping', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: CLIENT_ID }),
    keepalive: true
  }).catch(() => {
    /* ignore it if the server has already quit */
  });
}

function sayBye() {
  const body = JSON.stringify({ id: CLIENT_ID });

  // sendBeacon still gets through while the page unloads
  if (navigator.sendBeacon) {
    navigator.sendBeacon('/api/bye', new Blob([body], { type: 'application/json' }));
    return;
  }

  fetch('/api/bye', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    keepalive: true
  }).catch(() => {});
}

function bindLiveness() {
  pingServer();
  setInterval(pingServer, 5000);

  // background tabs have their timers throttled, so ping again as soon as it is visible
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') pingServer();
  });

  // closing, reloading or navigating away all notify once
  let saidBye = false;
  const byeOnce = () => {
    if (saidBye) return;
    saidBye = true;
    sayBye();
  };

  window.addEventListener('pagehide', (event) => {
    if (event.persisted) return; // going into the back/forward cache is not a close
    byeOnce();
  });

  window.addEventListener('beforeunload', byeOnce);
}

function bindStatic() {
  bindLiveness();

  window.addEventListener('resize', () => chart && chart.resize());

  $('#autoSync').addEventListener('change', (e) => {
    state.autoSync = e.target.checked;
    if (state.autoSync) scheduleSync();
  });

  $('#grid').addEventListener('change', (e) => {
    state.showGrid = e.target.checked;
    refreshChart();
  });

  $('#snap').addEventListener('change', (e) => {
    state.snap = e.target.checked;
  });

  $('#blogMode').addEventListener('change', (e) => {
    state.blogMode = e.target.checked;
    applyStage();
    refreshChart();
  });

  $('#darkMode').addEventListener('change', (e) => {
    state.dark = e.target.checked;
    applyStage();
    refreshChart();
  });

  $('#undo').addEventListener('click', undo);
  $('#redo').addEventListener('click', redo);
  $('#save').addEventListener('click', save);
  $('#add').addEventListener('click', addNode);

  bindFileModal();

  $('#fencePicker').addEventListener('change', async (e) => {
    const target = Number(e.target.value);
    setStatus('Switching fence…', 'busy');

    try {
      applyData(await loadState(target));
      setStatus('Loaded', 'ok');
    } catch (err) {
      setStatus('Switch failed: ' + err.message, 'err');
    }
  });

  $('#selbar').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn || btn.disabled) return;
    batchAction(btn.dataset.act);
  });

  $('#selColor').addEventListener('input', (e) => applyBatchColor(e.target.value));

  $('#selPos').addEventListener('change', (e) => {
    if (!e.target.value) return;
    applyBatchLabel(e.target.value);
    e.target.value = '';
  });

  bindKeyboard();
}

async function boot() {
  bindStatic();
  applyData(await loadState(0));
  setStatus('Loaded', 'ok');
}

boot().catch((err) => setStatus('Failed to load: ' + err.message, 'err'));
