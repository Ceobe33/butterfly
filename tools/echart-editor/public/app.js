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
  autoSync: false,
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
let treeRows = new Map(); // tree node → its row in the panel, for canvas clicks
let treeSelectedRow = null;

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
  // scatter charts are restored from nodes; data-mode charts (tree, radar, sankey…) carry their series along
  const fromSeries = !state.nodeEditable || treeEntry();

  return {
    nodes: state.nodes.map((n) => ({ ...n })),
    series: fromSeries ? JSON.parse(JSON.stringify(state.option.series || [])) : null
  };
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

function restore(snap) {
  const keys = new Set([...state.selected].map((n) => n.key));
  state.nodes = snap.nodes;
  if (snap.series) state.option.series = snap.series;
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
/**
 * Radar tooltips only ever describe the polygon you hit, so the upper series hides the lower one.
 * The blog replaces the "<radar>" marker with this; the editor mirrors it so the preview matches.
 */
function radarTooltip(option) {
  const labels = ((option.radar && option.radar.indicator) || []).map((item) => (item && item.name) || '');
  const series = (option.series || []).filter((entry) => entry && entry.type === 'radar');
  const names = series.map((entry) => entry.name);

  return (params) => {
    const index = params.dataIndex == null ? 0 : params.dataIndex;
    const head = (params.data && params.data.name) || params.seriesName || '';

    const rows = labels.map((label, i) => {
      const cells = series.map((entry) => {
        const datum = (entry.data || [])[index] || {};
        const value = Array.isArray(datum.value) ? datum.value[i] : datum.value;
        return (entry.name ? entry.name + ' ' : '') + (value == null ? '-' : value);
      });

      return label + '：' + cells.join(' ｜ ');
    });

    return (names.indexOf(head) < 0 ? [head] : []).concat(rows).join('<br/>');
  };
}

function blogTune(option, dark) {
  const out = JSON.parse(JSON.stringify(option));

  const text = dark ? '#c9d1d9' : '#4c4948';
  const line = dark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.12)';
  const area = dark
    ? ['rgba(255,255,255,0.03)', 'rgba(255,255,255,0.06)']
    : ['rgba(0,0,0,0.02)', 'rgba(0,0,0,0.04)'];

  out.backgroundColor = 'transparent';
  out.textStyle = Object.assign({ color: text }, out.textStyle);

  // mirrors the "<radar>" marker in scripts/filters/echarts-fence.js
  if (out.tooltip && out.tooltip.formatter === '<radar>') {
    out.tooltip.formatter = radarTooltip(out);
  }

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

/** The post column is 786px wide, but on a narrow screen it is the viewport that decides */
function stageWidth() {
  const wrap = $('#stage').parentElement;
  const style = getComputedStyle(wrap);
  const padding = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
  const available = Math.floor(wrap.clientWidth - padding);

  if (!available) return ARTICLE_WIDTH;

  return Math.max(240, Math.min(ARTICLE_WIDTH, available));
}

/** Canvas size matches the blog: width of #article-container .echarts-wrap, height from the height field */
function applyStage() {
  const stage = $('#stage');
  const height = Number(state.option && state.option.height) || 420;
  const width = stageWidth();

  stage.style.width = width + 'px';
  stage.style.height = height + 'px';
  stage.dataset.mode = state.blogMode ? (state.dark ? 'dark' : 'light') : 'raw';

  $('#sizeNote').textContent = width + ' × ' + height + 'px' + (width === ARTICLE_WIDTH ? '' : ' · fitted');

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

/** Tapping a tree node on the canvas highlights its row in the panel */
function bindTreeClicks() {
  chart.on('click', (params) => {
    if (!params || !treeRows.size) return;

    const row = treeRows.get(params.data);
    if (!row) return;

    if (treeSelectedRow) treeSelectedRow.classList.remove('selected');
    treeSelectedRow = row;
    row.classList.add('selected');
    row.scrollIntoView({ block: 'nearest' });
  });
}

function bindZr() {
  const zr = chart.getZr();

  zr.on('mousedown', (e) => {
    if (!state.nodeEditable) return;

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
    if (!state.nodeEditable) return;

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

/** Move an item within an array, in place */
function moveItem(list, from, to) {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return false;

  const [item] = list.splice(from, 1);
  list.splice(to, 0, item);
  return true;
}

function gripEl() {
  const grip = document.createElement('span');
  grip.className = 'grip';
  grip.textContent = '⠿';
  grip.title = 'Drag to reorder';
  return grip;
}

/** Drag-to-reorder for a set of panel rows; each row needs a .grip handle */
function makeReorderable(rows, onMove) {
  let from = -1;
  const clearMarks = () => rows.forEach((row) => row.classList.remove('drop-target'));

  rows.forEach((row, index) => {
    const grip = row.querySelector('.grip');
    if (!grip) return;

    // Only start a row drag when the grip is grabbed, so inputs stay usable
    grip.addEventListener('mousedown', () => {
      row.draggable = true;
    });

    row.addEventListener('dragstart', (event) => {
      from = index;
      row.classList.add('dragging');
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', String(index));
    });

    row.addEventListener('dragend', () => {
      row.draggable = false;
      row.classList.remove('dragging');
      clearMarks();
      from = -1;
    });

    row.addEventListener('dragover', (event) => {
      if (from < 0 || index === from) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      clearMarks();
      row.classList.add('drop-target');
    });

    row.addEventListener('drop', (event) => {
      if (from < 0 || index === from) return;
      event.preventDefault();

      const source = from;
      from = -1;
      row.draggable = false;
      clearMarks();
      onMove(source, index);
    });
  });
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

  top.append(gripEl(), color, name, del);

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
/** Draw order decides which shape catches a hover, so the panel can reorder the series itself */
function moveSeries(from, to) {
  const series = state.option && state.option.series;
  if (!Array.isArray(series) || to < 0 || to >= series.length || from === to) return;

  pushHistory();

  const [moved] = series.splice(from, 1);
  series.splice(to, 0, moved);

  refreshChart();
  scheduleSync();
  buildPanel();
}

function seriesOrderButtons(index, total) {
  const wrap = document.createElement('span');
  wrap.className = 'series-order';

  const make = (label, delta, title) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn tiny';
    button.textContent = label;
    button.title = title;
    button.disabled = delta < 0 ? index <= 0 : index >= total - 1;
    button.addEventListener('click', () => moveSeries(index, index + delta));
    return button;
  };

  wrap.append(
    make('▲', -1, 'Move earlier: drawn first, so it sits underneath the later series'),
    make('▼', 1, 'Move later: drawn on top, which makes its filled area catch the hover')
  );

  return wrap;
}

/**
 * Title / subtitle editor for charts that have no scatter nodes. Radar and pie charts carry
 * their wording here, and there was no way to change it without editing the fence by hand.
 */
function buildTitleEditor(box) {
  const option = state.option || {};
  const raw = Array.isArray(option.title) ? option.title[0] : option.title;
  const title = raw && typeof raw === 'object' ? raw : {};

  const block = document.createElement('div');
  block.className = 'data-block';

  const head = document.createElement('div');
  head.className = 'data-head';
  head.textContent = 'title';
  block.appendChild(head);

  const commit = () => {
    refreshChart();
    scheduleSync();
  };

  const field = (caption, key, placeholder) => {
    const row = document.createElement('label');
    row.className = 'data-row';

    const label = document.createElement('span');
    label.className = 'data-label';
    label.textContent = caption;

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'data-text';
    input.placeholder = placeholder;
    input.value = typeof title[key] === 'string' ? title[key] : '';
    input.addEventListener('change', () => {
      const next = input.value.trim();

      // title may be an array in the source; edit the first entry
      if (Array.isArray(option.title)) option.title = option.title[0] || {};
      if (!option.title || typeof option.title !== 'object') option.title = {};

      if (next) option.title[key] = next;
      else delete option.title[key];

      // an empty title object draws nothing but still clutters the fence
      if (!Object.keys(option.title).length) delete option.title;

      commit();
    });

    row.append(label, input);
    block.appendChild(row);
  };

  field('text', 'text', 'Chart title');
  field('subtext', 'subtext', 'Subtitle');

  box.appendChild(block);
}

/** Radar geometry: how big the polygon is, whether it's a polygon or a circle, and where it sits */
function buildRadarLayoutEditor(box) {
  const radar = state.option && state.option.radar;
  if (!radar || typeof radar !== 'object' || Array.isArray(radar)) return;

  const block = document.createElement('div');
  block.className = 'data-block';

  const head = document.createElement('div');
  head.className = 'data-head';
  head.textContent = 'radar';
  block.appendChild(head);

  const commit = () => {
    refreshChart();
    scheduleSync();
  };

  const centre = Array.isArray(radar.center) ? radar.center : ['50%', '50%'];

  const field = (caption, value, apply, placeholder) => {
    const row = document.createElement('label');
    row.className = 'data-row';

    const label = document.createElement('span');
    label.className = 'data-label';
    label.textContent = caption;

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'data-text';
    input.placeholder = placeholder;
    input.value = value == null ? '' : String(value);
    input.addEventListener('change', () => {
      apply(input.value.trim());
      commit();
    });

    row.append(label, input);
    block.appendChild(row);
  };

  field('radius', radar.radius, (next) => {
    if (next) radar.radius = next;
    else delete radar.radius;
  }, '62%');

  field('center x', centre[0], (next) => {
    const now = Array.isArray(radar.center) ? radar.center[1] : centre[1];
    radar.center = [next || '50%', now || '50%'];
  }, '50%');

  field('center y', centre[1], (next) => {
    const now = Array.isArray(radar.center) ? radar.center[0] : centre[0];
    radar.center = [now || '50%', next || '50%'];
  }, '50%');

  const choose = (caption, value, options) => {
    const row = document.createElement('label');
    row.className = 'data-row';

    const label = document.createElement('span');
    label.className = 'data-label';
    label.textContent = caption;

    const select = document.createElement('select');
    select.className = 'data-text';
    options.forEach(([key, text]) => select.appendChild(pickerOption(key, text)));
    select.value = value;
    select.addEventListener('change', () => {
      radar.shape = select.value;
      commit();
    });

    row.append(label, select);
    block.appendChild(row);
  };

  choose('shape', radar.shape === 'circle' ? 'circle' : 'polygon', [
    ['polygon', 'polygon 多边形'],
    ['circle', 'circle 圆形']
  ]);

  box.appendChild(block);
}

function buildDataEditor(box) {
  const series = Array.isArray(state.option.series) ? state.option.series : [];
  const indicators =
    state.option.radar && Array.isArray(state.option.radar.indicator)
      ? state.option.radar.indicator.map((item) => (item && item.name) || '')
      : [];

  let rendered = 0;

  series.forEach((entry, si) => {
    if (!entry) return;

    // Sankey 的数值在 links 里，单独用节点 / 连线编辑器
    if (entry.type === 'sankey') {
      box.appendChild(buildSankeyEditor(entry, `series[${si}]`));
      rendered++;
      return;
    }

    // 树图没有数值，编辑的是层级、比例和布局
    if (entry.type === 'tree') {
      box.appendChild(buildTreeEditor(entry, `series[${si}]`));
      rendered++;
      return;
    }

    if (!Array.isArray(entry.data) || !entry.data.length) return;

    const block = document.createElement('div');
    block.className = 'data-block';

    const head = document.createElement('div');
    head.className = 'data-head data-head-row';

    const headText = document.createElement('span');
    headText.textContent = `series[${si}] · ${entry.type || 'series'}`;

    head.append(headText, seriesOrderButtons(si, series.length));
    block.appendChild(head);

    entry.data.forEach((row, ri) => {
      const line = document.createElement('div');
      line.className = 'data-row';

      let label;

      // radar 的系列名就是表格里的行名，改不了的话新加的行永远叫「系列 N」
      if (indicators.length && entry.type === 'radar') {
        label = document.createElement('input');
        label.type = 'text';
        label.className = 'data-label data-text';
        label.value = String(entry.name || (row && row.name) || '');
        label.addEventListener('input', () => {
          entry.name = label.value;
          if (row && typeof row === 'object' && !Array.isArray(row)) row.name = label.value;
          refreshChart();
          scheduleSync();
        });
      } else {
        label = document.createElement('span');
        label.className = 'data-label';
        label.textContent = row && typeof row === 'object' && row.name ? row.name : `#${ri + 1}`;
      }

      const group = document.createElement('div');
      group.className = 'data-values';

      line.append(gripEl(), label, group);
      renderValueCells(group, entry.data, ri, indicators);
      block.appendChild(line);
    });

    makeReorderable([...block.querySelectorAll('.data-row')], (from, to) => {
      if (!moveItem(entry.data, from, to)) return;

      refreshChart();
      scheduleSync();
      buildPanel();
    });

    box.appendChild(block);
    rendered++;
  });

  if (!rendered) {
    const empty = document.createElement('p');
    empty.className = 'notice';
    empty.textContent = "No editable numbers in this chart's series.";
    box.appendChild(empty);
  }
}

// ---------------------------------------------------------------------------
// Sankey: nodes and links
// ---------------------------------------------------------------------------

const SANKEY_FALLBACK_COLOUR = '#4bacc6';

function hexColour(value) {
  const text = String(value || '');
  return /^#[0-9a-f]{6}$/i.test(text) ? text.toLowerCase() : SANKEY_FALLBACK_COLOUR;
}

/** Reusable "caption + control" line inside a sankey card */
function sankeyField(caption, control) {
  const wrap = document.createElement('label');
  wrap.className = 'data-sub';

  const span = document.createElement('span');
  span.textContent = caption;

  wrap.append(span, control);
  return wrap;
}

/** Dropdown of node names; unknown names are kept so a link is never silently rewired */
function nodeSelect(nodes, current, onChange) {
  const select = document.createElement('select');
  select.className = 'data-select';

  nodes.forEach((node) => {
    const option = document.createElement('option');
    option.value = node.name;
    option.textContent = node.name;
    select.appendChild(option);
  });

  if (current && !nodes.some((node) => node.name === current)) {
    const missing = document.createElement('option');
    missing.value = current;
    missing.textContent = current + ' (missing)';
    select.appendChild(missing);
  }

  select.value = current || (nodes[0] && nodes[0].name) || '';
  select.addEventListener('change', () => onChange(select.value));
  return select;
}

function buildSankeyEditor(entry, label) {
  if (!Array.isArray(entry.data)) entry.data = [];
  if (!Array.isArray(entry.links)) entry.links = [];

  const nodes = entry.data;
  const links = entry.links;

  const block = document.createElement('div');
  block.className = 'data-block';

  const commit = () => {
    refreshChart();
    scheduleSync();
  };

  const head = document.createElement('div');
  head.className = 'data-head data-head-row';

  const title = document.createElement('span');
  title.textContent = `${label} · sankey · ${nodes.length} nodes / ${links.length} links`;

  // ECharts re-sorts sankey nodes to reduce crossings unless layoutIterations is 0
  const keep = document.createElement('label');
  keep.className = 'chk keep-order';
  keep.title = 'ECharts re-sorts sankey nodes to reduce crossings; tick to keep the order you set';

  const keepBox = document.createElement('input');
  keepBox.type = 'checkbox';
  keepBox.checked = entry.layoutIterations === 0;
  keepBox.addEventListener('change', () => {
    if (keepBox.checked) entry.layoutIterations = 0;
    else delete entry.layoutIterations;
    commit();
  });

  const keepText = document.createElement('span');
  keepText.textContent = 'Keep order';
  keep.append(keepBox, keepText);

  const seriesList = (state.option && state.option.series) || [];

  head.append(title, seriesOrderButtons(seriesList.indexOf(entry), seriesList.length), keep);
  block.appendChild(head);

  // ---- nodes ----
  const nodeRows = [];

  nodes.forEach((node) => {
    const row = document.createElement('div');
    row.className = 'data-row';

    const colour = document.createElement('input');
    colour.type = 'color';
    colour.className = 'color';
    colour.value = hexColour(node.itemStyle && node.itemStyle.color);
    colour.addEventListener('input', () => {
      node.itemStyle = { ...(node.itemStyle || {}), color: colour.value };
      commit();
    });

    const name = document.createElement('input');
    name.type = 'text';
    name.className = 'data-text';
    name.value = node.name || '';
    name.addEventListener('change', () => {
      const next = name.value.trim();
      const previous = node.name;

      if (!next) {
        name.value = previous || '';
        return;
      }
      if (next === previous) return;

      node.name = next;
      // Keep every link pointing at the renamed node
      links.forEach((link) => {
        if (link.source === previous) link.source = next;
        if (link.target === previous) link.target = next;
      });

      commit();
      buildPanel(); // option lists need the new name
    });

    const remove = document.createElement('button');
    remove.className = 'del';
    remove.textContent = '×';
    remove.title = 'Delete this node and every link that touches it';
    remove.addEventListener('click', () => {
      const target = node.name;
      nodes.splice(nodes.indexOf(node), 1);

      for (let i = links.length - 1; i >= 0; i--) {
        if (links[i].source === target || links[i].target === target) links.splice(i, 1);
      }

      commit();
      buildPanel();
    });

    row.append(gripEl(), colour, name, remove);
    block.appendChild(row);
    nodeRows.push(row);
  });

  makeReorderable(nodeRows, (from, to) => {
    if (!moveItem(nodes, from, to)) return;

    // Without this the reorder is invisible: the layout engine sorts nodes again
    if (entry.layoutIterations !== 0) entry.layoutIterations = 0;

    commit();
    buildPanel();
  });

  const addNode = document.createElement('button');
  addNode.className = 'btn tiny add-row';
  addNode.textContent = '+ node';
  addNode.addEventListener('click', () => {
    const used = new Set(nodes.map((node) => node.name));
    let i = 1;
    while (used.has('Node ' + i)) i++;

    nodes.push({ name: 'Node ' + i });
    commit();
    buildPanel();
  });
  block.appendChild(addNode);

  // ---- links ----
  const linkHead = document.createElement('div');
  linkHead.className = 'data-head';
  linkHead.style.borderTop = '1px solid var(--line)';
  linkHead.textContent = `links · ${links.length}`;
  block.appendChild(linkHead);

  links.forEach((link) => {
    const row = document.createElement('div');
    row.className = 'data-row sankey-link';

    const from = nodeSelect(nodes, link.source, (value) => {
      link.source = value;
      commit();
    });

    const to = nodeSelect(nodes, link.target, (value) => {
      link.target = value;
      commit();
    });

    const value = document.createElement('input');
    value.type = 'number';
    value.step = 'any';
    value.className = 'data-num';
    value.value = String(link.value ?? 1);
    value.title = 'flow value';
    value.addEventListener('input', () => {
      const next = Number(value.value);
      if (!Number.isFinite(next)) return;
      link.value = next;
      commit();
    });

    const remove = document.createElement('button');
    remove.className = 'del';
    remove.textContent = '×';
    remove.title = 'Delete this link';
    remove.addEventListener('click', () => {
      links.splice(links.indexOf(link), 1);
      commit();
      buildPanel();
    });

    const first = document.createElement('div');
    first.className = 'link-line';
    first.append(sankeyField('from', from), remove);

    const second = document.createElement('div');
    second.className = 'link-line';
    second.append(sankeyField('to', to), value);

    row.append(first, second);
    block.appendChild(row);
  });

  const addLink = document.createElement('button');
  addLink.className = 'btn tiny add-row';
  addLink.textContent = '+ link';
  addLink.disabled = nodes.length < 2;
  addLink.addEventListener('click', () => {
    const source = nodes[nodes.length - 2];
    const target = nodes[nodes.length - 1];
    links.push({ source: source.name, target: target.name, value: 1 });
    commit();
    buildPanel();
  });
  block.appendChild(addLink);

  return block;
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

// ---------------------------------------------------------------------------
// Tree: scale, hierarchy and layout
// ---------------------------------------------------------------------------

/** The first tree series in the option, if this chart has one */
function treeEntry() {
  const series = Array.isArray(state.option && state.option.series) ? state.option.series : [];
  const index = series.findIndex((entry) => entry && entry.type === 'tree');

  return index < 0 ? null : { index, entry: series[index] };
}

function treeRoots(entry) {
  if (!Array.isArray(entry.data)) {
    entry.data = entry.data && typeof entry.data === 'object' ? [entry.data] : [];
  }

  return entry.data;
}

/** Depth-first walk: every node with its depth, parent and position among its siblings */
function flattenTree(nodes, depth, parent, out) {
  const list = out || [];

  (Array.isArray(nodes) ? nodes : []).forEach((node, index) => {
    if (!node || typeof node !== 'object') return;

    list.push({ node, depth: depth || 0, parent: parent || null, index });
    flattenTree(node.children, (depth || 0) + 1, node, list);
  });

  return list;
}

function childListOf(parent, roots) {
  if (!parent) return roots;

  if (!Array.isArray(parent.children)) parent.children = [];
  return parent.children;
}

/** Everything hanging below a node — a re-parent may not point into its own subtree */
function descendantsOf(node) {
  const out = new Set();

  flattenTree(node.children, 0, node).forEach((item) => out.add(item.node));

  return out;
}

function detachNode(node, roots) {
  const lists = [roots];

  flattenTree(roots, 0, null).forEach((item) => {
    if (Array.isArray(item.node.children)) lists.push(item.node.children);
  });

  lists.forEach((list) => {
    const at = list.indexOf(node);
    if (at >= 0) list.splice(at, 1);
  });
}

/** caption + input, matching the look of the scatter node rows */
function treeField(caption, control) {
  const field = document.createElement('label');
  field.className = 'field';

  const span = document.createElement('span');
  span.textContent = caption;

  field.append(span, control);
  return field;
}

function treeNumber(caption, value, apply, options) {
  const opts = options || {};

  const input = document.createElement('input');
  input.type = 'number';
  input.step = String(opts.step || 1);
  input.value = value == null || value === '' ? '' : String(value);

  input.addEventListener('change', () => {
    const next = Number(input.value);
    if (!Number.isFinite(next)) return;

    const lo = opts.min == null ? -Infinity : opts.min;
    const hi = opts.max == null ? Infinity : opts.max;

    pushHistoryOnce();
    apply(Math.min(hi, Math.max(lo, next)));
    refreshChart();
    scheduleSync();
  });

  return treeField(caption, input);
}

function treeText(caption, value, apply) {
  const input = document.createElement('input');
  input.type = 'text';
  input.value = value == null ? '' : String(value);

  input.addEventListener('change', () => {
    pushHistoryOnce();
    apply(input.value.trim());
    refreshChart();
    scheduleSync();
  });

  return treeField(caption, input);
}

/** One hierarchy row: name, parent, order among siblings, add child, delete */
function makeTreeRow(item, roots, rebuild) {
  const node = item.node;
  const parent = item.parent;

  const row = document.createElement('div');
  row.className = 'tree-row';
  row.style.setProperty('--depth', String(Math.min(item.depth, 8)));

  const top = document.createElement('div');
  top.className = 'tree-row-top';

  const name = document.createElement('input');
  name.className = 'data-text';
  name.value = node.name == null ? '' : String(node.name);
  name.title = 'Rename this node';
  name.addEventListener('change', () => {
    pushHistoryOnce();
    node.name = name.value;
    refreshChart();
    scheduleSync();
  });

  const addChild = document.createElement('button');
  addChild.className = 'tree-btn';
  addChild.textContent = '+';
  addChild.title = 'Add a node one level below this one';
  addChild.addEventListener('click', () => {
    pushHistory();
    childListOf(node, roots).push({ name: '新节点' });
    node.collapsed = false; // otherwise a collapsed branch hides the new child
    rebuild();
    scheduleSync();
  });

  const del = document.createElement('button');
  del.className = 'tree-btn del';
  del.textContent = '×';
  del.title = 'Delete this node and everything under it';
  del.addEventListener('click', () => {
    pushHistory();
    detachNode(node, roots);
    rebuild();
    scheduleSync();
  });

  top.append(name, addChild, del);

  const bot = document.createElement('div');
  bot.className = 'tree-row-bot';

  const cap = document.createElement('span');
  cap.className = 'tree-cap';
  cap.textContent = '父级';

  const blocked = descendantsOf(node);
  blocked.add(node);

  const candidates = flattenTree(roots, 0, null).filter((other) => !blocked.has(other.node));

  const parentSel = document.createElement('select');
  parentSel.className = 'data-select';
  parentSel.title = 'Move this node under another one';

  const none = document.createElement('option');
  none.value = '';
  none.textContent = '— 顶层 —';
  parentSel.appendChild(none);

  candidates.forEach((other, at) => {
    const option = document.createElement('option');
    option.value = String(at);
    option.textContent = '  '.repeat(other.depth) + (other.node.name || '(未命名)');
    parentSel.appendChild(option);
  });

  const parentAt = candidates.findIndex((other) => other.node === parent);
  parentSel.value = parentAt < 0 ? '' : String(parentAt);

  parentSel.addEventListener('change', () => {
    const target = parentSel.value === '' ? null : candidates[Number(parentSel.value)].node;
    if (!target && !parent) return;

    pushHistory();
    detachNode(node, roots);
    childListOf(target, roots).push(node);
    if (target) target.collapsed = false;
    rebuild();
    scheduleSync();
  });

  const move = (delta) => () => {
    const list = childListOf(parent, roots);
    const at = list.indexOf(node);
    const to = at + delta;

    if (at < 0 || to < 0 || to >= list.length) return;

    pushHistory();
    list.splice(at, 1);
    list.splice(to, 0, node);
    rebuild();
    scheduleSync();
  };

  const up = document.createElement('button');
  up.className = 'tree-btn';
  up.textContent = '↑';
  up.title = 'Move up among its siblings';
  up.addEventListener('click', move(-1));

  const down = document.createElement('button');
  down.className = 'tree-btn';
  down.textContent = '↓';
  down.title = 'Move down among its siblings';
  down.addEventListener('click', move(1));

  bot.append(cap, parentSel, up, down);

  row.append(top, bot);
  treeRows.set(node, row);

  return row;
}

function buildTreeEditor(entry, label) {
  const roots = treeRoots(entry);
  const flat = flattenTree(roots, 0, null);

  if (!entry.label || typeof entry.label !== 'object') entry.label = {};
  if (!entry.lineStyle || typeof entry.lineStyle !== 'object') entry.lineStyle = {};

  const block = document.createElement('div');
  block.className = 'data-block';

  const head = document.createElement('div');
  head.className = 'data-head data-head-row';

  const headText = document.createElement('span');
  headText.textContent = `${label} · tree · ${flat.length} nodes`;

  const seriesList = (state.option && state.option.series) || [];
  head.append(headText, seriesOrderButtons(seriesList.indexOf(entry), seriesList.length));
  block.appendChild(head);

  // --- size and layout ------------------------------------------------------
  const grid = document.createElement('div');
  grid.className = 'tree-grid';

  const pad = Array.isArray(entry.label.padding) ? entry.label.padding : null;
  const padAt = (at) => (pad ? pad[at] : entry.label.padding);

  const setPad = (at) => (next) => {
    const current = Array.isArray(entry.label.padding)
      ? entry.label.padding.slice()
      : [entry.label.padding || 0, entry.label.padding || 0];

    current[at] = next;
    entry.label.padding = current;
  };

  grid.append(
    // the container height is the option's "height" field, exactly as the blog reads it
    treeNumber('画布高', Number(state.option.height) || 420, (next) => {
      state.option.height = next;
      applyStage();
    }, { min: 160, max: 2000, step: 20 }),
    treeNumber('字号', entry.label.fontSize, (next) => {
      entry.label.fontSize = next;
    }, { min: 4, max: 64 }),
    treeNumber('行高', entry.label.lineHeight, (next) => {
      entry.label.lineHeight = next;
    }, { min: 0, max: 200 }),
    treeNumber('上下', padAt(0), setPad(0), { min: 0, max: 200 }),
    treeNumber('左右', padAt(1), setPad(1), { min: 0, max: 200 }),
    treeNumber('线宽', entry.lineStyle.width, (next) => {
      entry.lineStyle.width = next;
    }, { min: 0, max: 40 }),
    treeNumber('节点', entry.symbolSize, (next) => {
      entry.symbolSize = next;
    }, { min: 0, max: 60 }),
    treeNumber('层级', entry.initialTreeDepth, (next) => {
      entry.initialTreeDepth = next;
    }, { min: 0, max: 20 }),
    treeText('上', entry.top, (next) => {
      entry.top = next;
    }),
    treeText('下', entry.bottom, (next) => {
      entry.bottom = next;
    }),
    treeText('左', entry.left, (next) => {
      entry.left = next;
    }),
    treeText('右', entry.right, (next) => {
      entry.right = next;
    })
  );

  block.appendChild(grid);

  // --- hierarchy ------------------------------------------------------------
  const list = document.createElement('div');
  list.className = 'tree-list';

  flat.forEach((item) => list.appendChild(makeTreeRow(item, roots, buildPanel)));

  block.appendChild(list);

  return block;
}

function buildPanel() {
  const box = $('#nodes');
  box.innerHTML = '';
  state.rows = [];
  state.rowMap = new Map();
  treeRows = new Map();

  // No scatter nodes: fall back to editing the numbers
  if (!state.nodeEditable) {
    const notice = document.createElement('p');
    notice.className = 'notice';
    notice.textContent = state.tabFence
      ? 'Tab group: each "## section" is one chart and they are rendered at build time. Only the first tab is previewed here — edit the sections in the article.'
      : state.tableFence
        ? 'Table fence: the chart is generated from the markdown table. Saving writes your edits back into that table.'
        : treeEntry()
        ? 'Tree chart: edit the hierarchy, the node scale and the layout box below.'
        : 'This chart has no scatter nodes, so edit its data directly below.';
    box.appendChild(notice);

    buildRadarLayoutEditor(box);
    buildTitleEditor(box);
    buildDataEditor(box);

    const tree = treeEntry();
    $('#count').textContent = tree ? String(flattenTree(treeRoots(tree.entry), 0, null).length) : '0';
    // radar carries no nodes, but each series is still a row worth adding
    $('#add').disabled = !radarSeriesAddable();
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

  makeReorderable(
    state.rows.map((row) => row.root),
    (from, to) => {
      pushHistory();
      if (!moveItem(state.nodes, from, to)) return;

      buildPanel();
      refreshUI();
      scheduleSync();
    }
  );

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

/** Radar has no scatter nodes, but its series are still rows the panel can add */
function radarSeriesAddable() {
  const radar = state.option && state.option.radar;
  return Boolean(radar && Array.isArray(radar.indicator) && radar.indicator.length);
}

/** New radar series: every indicator starts at 0, so the row can be filled in place */
function addRadarSeries() {
  if (!radarSeriesAddable()) return;

  pushHistory();

  const series = Array.isArray(state.option.series) ? state.option.series : [];
  const taken = new Set(series.map((entry) => String((entry && entry.name) || '')));

  let n = series.length + 1;
  while (taken.has('系列 ' + n)) n++;
  const name = '系列 ' + n;

  // 表格围栏的配色是构建时按系列顺序取的，这里跟着取同一个，预览才不会和文章对不上
  const colors =
    state.tableColors && state.tableColors.length
      ? state.tableColors
      : ['#4BACC6', '#E60000', '#A9C9E8', '#F79646', '#9BBB59', '#8064A2'];
  const color = colors[series.length % colors.length];

  series.push({
    name,
    type: 'radar',
    symbol: 'none',
    lineStyle: { color, width: 2 },
    itemStyle: { color },
    areaStyle: { color, opacity: 0.18 },
    data: [{ value: state.option.radar.indicator.map(() => 0), name }]
  });

  state.option.series = series;

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

  if (state.tabFence) {
    setStatus('Tab group — edit the sections in the article', 'warn');
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

    // the body is rewritten as strict JSON, so the blog's fence filter can pick it up again
    if (state.kind === 'md') state.strictJson = true;

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
  state.timer = setTimeout(() => {
    state.timer = null;

    // 排队这段时间里可能被取消了自动同步，到点再确认一次
    if (!state.autoSync) return;

    save();
  }, 350);
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
    tableFence: data.tableFence === true,
    tableColors: data.tableColors,
    tabFence: data.tabFence === true,
    strictJson: data.strictJson !== false,
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

  // 切换文件/围栏时丢掉排队中的写入，否则旧数据会被写进新打开的文件
  clearTimeout(state.timer);
  state.timer = null;

  $('#file').textContent = data.file || 'Blank canvas';

  buildFencePicker();
  applyStage();

  if (!chart) {
    chart = echarts.init($('#chart'), null, { renderer: 'canvas' });
    bindZr();
    bindTreeClicks();
  }

  buildPanel();
  refreshUI();
  updateHistoryButtons();
}

/** Templates are the chart shapes this project already uses, served by /api/templates */
let templateCache = null;

async function loadTemplates() {
  if (templateCache) return templateCache;

  const data = await (await fetch('/api/templates')).json();
  templateCache = data.templates || [];
  return templateCache;
}

function pickerOption(value, text) {
  const option = document.createElement('option');
  option.value = value;
  option.textContent = text;
  return option;
}

/** A markdown file may hold several ```echarts fences, so let the user pick one */
async function buildFencePicker() {
  const picker = $('#fencePicker');
  const fences = state.fences || [];
  const canInsert = state.kind === 'md';

  picker.innerHTML = '';

  if (!fences.length && canInsert) {
    picker.appendChild(pickerOption('', 'No chart in this article yet'));
  }

  fences.forEach((fence) => {
    picker.appendChild(
      pickerOption(
        String(fence.index),
        `Fence ${fence.index + 1} · line ${fence.line}${fence.heading ? ' · ' + fence.heading : ''}`
      )
    );
  });

  if (canInsert) {
    if (fences.length) picker.appendChild(pickerOption('sep', '──────────────────'));

    const templates = await loadTemplates().catch(() => []);
    templates.forEach((template, index) => {
      picker.appendChild(pickerOption(`new:${index}`, `＋ New · ${template.label}`));
    });

    if (fences.length) {
      picker.appendChild(pickerOption('dup', '⧉ Duplicate this chart'));
    }
  }

  // the separator is a visual break only
  [...picker.options].filter((option) => option.value === 'sep').forEach((option) => {
    option.disabled = true;
  });

  picker.hidden = picker.options.length === 0;
  if (picker.hidden) return;

  picker.value = fences.length ? String(state.fenceIndex) : '';
}

/** Write a new fence directly below the one being edited, then switch to it */
async function insertFenceAfter(option, nodes, label) {
  if (state.kind !== 'md' || !state.file) throw new Error('open a markdown article first');

  setStatus('Adding chart…', 'busy');

  const data = await postJson('/api/insert', {
    path: state.file,
    mode: 'after',
    fence: state.fenceIndex,
    option,
    nodes
  });

  chartCache = null; // fence counts changed
  applyData(data.state);
  setStatus(`Added ${label} · fence ${data.index + 1}`, 'ok');
}

async function createFromTemplate(index) {
  try {
    const template = (await loadTemplates())[index];
    if (!template) throw new Error('template not found');

    await insertFenceAfter(JSON.parse(JSON.stringify(template.option)), null, template.shape);
  } catch (err) {
    setStatus('Add failed: ' + err.message, 'err');
    await buildFencePicker();
  }
}

async function duplicateCurrentChart() {
  try {
    // node charts keep their positions in the node list, not in the option
    const nodes = state.nodeEditable ? state.nodes : null;
    await insertFenceAfter(JSON.parse(JSON.stringify(state.option)), nodes, 'copy');
  } catch (err) {
    setStatus('Add failed: ' + err.message, 'err');
    await buildFencePicker();
  }
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

  // the stage width follows the window, so re-measure rather than only resizing the chart
  window.addEventListener('resize', () => {
    if (!state.option) return;

    applyStage();
  });

  // the checkbox has to show what the engine actually does, otherwise "unchecked" still syncs
  $('#autoSync').checked = state.autoSync;

  $('#autoSync').addEventListener('change', (e) => {
    state.autoSync = e.target.checked;

    if (state.autoSync) {
      scheduleSync();
      return;
    }

    // 关掉自动同步时，把已经排队的写入一并取消，否则 350ms 后仍会写文件
    clearTimeout(state.timer);
    state.timer = null;
    setStatus('Auto-sync off — ⌘S to save', 'warn');
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
  $('#add').addEventListener('click', () => {
    if (state.nodeEditable) addNode();
    else addRadarSeries();
  });

  bindFileModal();

  $('#fencePicker').addEventListener('change', async (e) => {
    const value = e.target.value;

    if (value === 'sep') return;

    if (value.startsWith('new:')) {
      await createFromTemplate(Number(value.slice(4)));
      return;
    }

    if (value === 'dup') {
      await duplicateCurrentChart();
      return;
    }

    const target = Number(value);
    setStatus('Switching fence…', 'busy');

    try {
      applyData(await loadState(target));
      loadedStatus();
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

/** The blog's fence filter only parses strict JSON; anything else is skipped there */
function loadedStatus() {
  if (state.strictJson === false) {
    setStatus('Not strict JSON — the blog skips this chart; saving rewrites it', 'warn');
    return;
  }
  setStatus('Loaded', 'ok');
}

async function boot() {
  bindStatic();
  applyData(await loadState(0));
  loadedStatus();
}

boot().catch((err) => setStatus('Failed to load: ' + err.message, 'err'));
