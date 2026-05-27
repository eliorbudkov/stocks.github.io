const $ = (id) => document.getElementById(id);
const statusEl = $('status');
const infoBar = $('infoBar');

const chartCommon = {
  layout: {
    background: { color: '#161b22' },
    textColor: '#e6edf3',
  },
  grid: {
    vertLines: { color: '#2a313c' },
    horzLines: { color: '#2a313c' },
  },
  rightPriceScale: { borderColor: '#2a313c' },
  timeScale: { borderColor: '#2a313c', timeVisible: false },
  crosshair: { mode: 1 },
};

const priceChart = LightweightCharts.createChart($('priceChart'), {
  ...chartCommon,
  height: $('priceChart').clientHeight,
});
const volumeChart = LightweightCharts.createChart($('volumeChart'), {
  ...chartCommon,
  height: $('volumeChart').clientHeight,
});
const rsiChart = LightweightCharts.createChart($('rsiChart'), {
  ...chartCommon,
  height: $('rsiChart').clientHeight,
});

const candleSeries = priceChart.addCandlestickSeries({
  upColor: '#26a69a', downColor: '#ef5350',
  borderUpColor: '#26a69a', borderDownColor: '#ef5350',
  wickUpColor: '#26a69a', wickDownColor: '#ef5350',
});
const ma20Series  = priceChart.addLineSeries({ color: '#f7b500', lineWidth: 2, priceLineVisible: false });
const ma150Series = priceChart.addLineSeries({ color: '#ab47bc', lineWidth: 2, priceLineVisible: false });
const ma200Series = priceChart.addLineSeries({ color: '#29b6f6', lineWidth: 2, priceLineVisible: false });

const volumeSeries = volumeChart.addHistogramSeries({
  priceFormat: { type: 'volume' },
  priceScaleId: '',
});
volumeChart.priceScale('').applyOptions({ scaleMargins: { top: 0.1, bottom: 0 } });

const rsiSeries = rsiChart.addLineSeries({ color: '#2f81f7', lineWidth: 2 });
rsiSeries.createPriceLine({ price: 70, color: '#ef5350', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: '70' });
rsiSeries.createPriceLine({ price: 30, color: '#26a69a', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: '30' });

// Sync time scales across the 3 charts
function syncTimeScales() {
  const charts = [priceChart, volumeChart, rsiChart];
  charts.forEach((src) => {
    src.timeScale().subscribeVisibleLogicalRangeChange((range) => {
      if (!range) return;
      charts.forEach((dst) => { if (dst !== src) dst.timeScale().setVisibleLogicalRange(range); });
    });
  });
}
syncTimeScales();

function resizeCharts() {
  priceChart.applyOptions({ width: $('priceChart').clientWidth });
  volumeChart.applyOptions({ width: $('volumeChart').clientWidth });
  rsiChart.applyOptions({ width: $('rsiChart').clientWidth });
}
window.addEventListener('resize', resizeCharts);
resizeCharts();

// --- Indicators ---
function sma(closes, period) {
  const out = new Array(closes.length).fill(null);
  let sum = 0;
  for (let i = 0; i < closes.length; i++) {
    sum += closes[i];
    if (i >= period) sum -= closes[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

function rsi(closes, period = 14) {
  const out = new Array(closes.length).fill(null);
  if (closes.length <= period) return out;
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gain += d; else loss -= d;
  }
  let avgG = gain / period;
  let avgL = loss / period;
  out[period] = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL);
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    const g = d > 0 ? d : 0;
    const l = d < 0 ? -d : 0;
    avgG = (avgG * (period - 1) + g) / period;
    avgL = (avgL * (period - 1) + l) / period;
    out[i] = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL);
  }
  return out;
}

// --- Data fetching (Yahoo Finance via CORS proxy) ---
async function fetchYahoo(symbol, range) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=1d`;
  const proxies = [
    (u) => `https://corsproxy.io/?${encodeURIComponent(u)}`,
    (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
    (u) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
  ];
  let lastErr;
  for (const wrap of proxies) {
    try {
      const r = await fetch(wrap(url));
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      if (j.chart?.error) throw new Error(j.chart.error.description || 'Yahoo error');
      if (!j.chart?.result?.[0]) throw new Error('סימול לא נמצא');
      return j.chart.result[0];
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('בעיה בשליפת הנתונים');
}

function fmt(n, d = 2) {
  if (n == null || isNaN(n)) return '-';
  return Number(n).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
}
function fmtVol(n) {
  if (n == null) return '-';
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(2) + 'K';
  return String(n);
}

// Map UI range -> { fetch: Yahoo range with enough history for MAs, show: # trading days to display }
const RANGE_MAP = {
  '1mo': { fetch: '2y', show: 22 },
  '2mo': { fetch: '2y', show: 44 },
  '3mo': { fetch: '2y', show: 66 },
  '6mo': { fetch: '2y', show: 130 },
  '1y':  { fetch: '5y', show: 252 },
  '2y':  { fetch: '5y', show: 504 },
  '5y':  { fetch: '10y', show: 1260 },
  'max': { fetch: 'max', show: Infinity },
};

let lastData = null;

function getMaPeriods() {
  const clamp = (v, d) => {
    const n = parseInt(v, 10);
    if (!Number.isFinite(n) || n < 2) return d;
    return Math.min(500, n);
  };
  return [
    clamp($('maP1').value, 20),
    clamp($('maP2').value, 150),
    clamp($('maP3').value, 200),
  ];
}

function setArrow(elId, price, maVal) {
  const el = $(elId);
  if (maVal == null || isNaN(maVal) || price == null || isNaN(price)) {
    el.textContent = '–';
    el.className = 'ma-arrow';
    el.title = 'אין נתון';
    return;
  }
  const up = price >= maVal;
  el.textContent = up ? '▲' : '▼';
  el.className = 'ma-arrow ' + (up ? 'up' : 'down');
  const diff = price - maVal;
  const pct = (diff / maVal) * 100;
  el.title = `מחיר ${up ? 'מעל' : 'מתחת'} לממוצע ב-${fmt(Math.abs(diff))} (${fmt(Math.abs(pct), 2)}%)`;
}

function renderMAs() {
  if (!lastData) return;
  const { rows, closeArr, showFrom } = lastData;
  const [p1, p2, p3] = getMaPeriods();
  const a1 = sma(closeArr, p1);
  const a2 = sma(closeArr, p2);
  const a3 = sma(closeArr, p3);
  const toLine = (arr) => rows.map((r, i) => (i < showFrom || arr[i] == null) ? null : { time: r.time, value: arr[i] }).filter(Boolean);
  ma20Series.setData(toLine(a1));
  ma150Series.setData(toLine(a2));
  ma200Series.setData(toLine(a3));

  const last = rows.length - 1;
  const lastClose = closeArr[last];

  $('iMa20').textContent  = fmt(a1[last]);
  $('iMa150').textContent = fmt(a2[last]);
  $('iMa200').textContent = fmt(a3[last]);
  $('lblMa1').textContent = `MA${p1}:`;
  $('lblMa2').textContent = `MA${p2}:`;
  $('lblMa3').textContent = `MA${p3}:`;
  $('legMa1').textContent = `MA ${p1}`;
  $('legMa2').textContent = `MA ${p2}`;
  $('legMa3').textContent = `MA ${p3}`;

  setArrow('arrMa1', lastClose, a1[last]);
  setArrow('arrMa2', lastClose, a2[last]);
  setArrow('arrMa3', lastClose, a3[last]);
}

async function load() {
  const symbol = $('ticker').value.trim().toUpperCase();
  const uiRange = $('range').value;
  const cfg = RANGE_MAP[uiRange] || RANGE_MAP['2y'];
  if (!symbol) { statusEl.textContent = 'הקלד סימול'; return; }

  statusEl.classList.remove('error');
  statusEl.textContent = 'טוען נתונים עבור ' + symbol + '...';
  $('loadBtn').disabled = true;

  try {
    const result = await fetchYahoo(symbol, cfg.fetch);
    const ts = result.timestamp || [];
    const q = result.indicators?.quote?.[0] || {};
    const opens = q.open || [], highs = q.high || [], lows = q.low || [], closes = q.close || [], vols = q.volume || [];

    const rows = [];
    for (let i = 0; i < ts.length; i++) {
      if (closes[i] == null) continue;
      rows.push({
        time: ts[i],
        open: opens[i], high: highs[i], low: lows[i], close: closes[i], volume: vols[i] ?? 0,
      });
    }
    if (rows.length === 0) throw new Error('אין נתונים זמינים');

    const closeArr = rows.map(r => r.close);
    const rsiArr   = rsi(closeArr, 14);

    // Slice display window — indicators are computed on full history for proper lookback
    const showFrom = cfg.show === Infinity ? 0 : Math.max(0, rows.length - cfg.show);

    const candles = [];
    const vData = [];
    for (let i = showFrom; i < rows.length; i++) {
      const r = rows[i];
      candles.push({ time: r.time, open: r.open, high: r.high, low: r.low, close: r.close });
      vData.push({
        time: r.time,
        value: r.volume,
        color: (i > 0 && r.close < rows[i-1].close) ? 'rgba(239, 83, 80, 0.6)' : 'rgba(38, 166, 154, 0.6)',
      });
    }
    const toLine = (arr) => rows.map((r, i) => (i < showFrom || arr[i] == null) ? null : { time: r.time, value: arr[i] }).filter(Boolean);

    candleSeries.setData(candles);
    volumeSeries.setData(vData);
    rsiSeries.setData(toLine(rsiArr));

    lastData = { rows, closeArr, result, showFrom };
    renderMAs();

    priceChart.timeScale().fitContent();

    const last = rows.length - 1;
    const lastClose = closeArr[last];
    const prevClose = closeArr[last - 1] ?? lastClose;
    const change = lastClose - prevClose;
    const pct = (change / prevClose) * 100;
    const meta = result.meta || {};
    $('iSymbol').textContent = meta.symbol || symbol;
    $('iPrice').textContent = fmt(lastClose) + (meta.currency ? ' ' + meta.currency : '');
    const chEl = $('iChange');
    chEl.textContent = (change >= 0 ? '+' : '') + fmt(change) + ' (' + (pct >= 0 ? '+' : '') + fmt(pct) + '%)';
    chEl.className = 'val ' + (change >= 0 ? 'up' : 'down');
    const rsiVal = rsiArr[last];
    const rsiEl = $('iRsi');
    rsiEl.textContent = fmt(rsiVal, 1);
    rsiEl.className = 'val ' + (rsiVal >= 70 ? 'down' : rsiVal <= 30 ? 'up' : '');
    infoBar.style.display = 'flex';

    const shown = rows.length - showFrom;
    statusEl.textContent = `מציג ${shown} ימי מסחר (מתוך ${rows.length} שנטענו) · נפח אחרון: ${fmtVol(rows[last].volume)}`;
  } catch (e) {
    statusEl.classList.add('error');
    statusEl.textContent = 'שגיאה: ' + (e.message || e);
    infoBar.style.display = 'none';
  } finally {
    $('loadBtn').disabled = false;
  }
}

$('loadBtn').addEventListener('click', load);
$('ticker').addEventListener('keydown', (e) => { if (e.key === 'Enter') load(); });
$('range').addEventListener('change', load);
['maP1', 'maP2', 'maP3'].forEach(id => {
  $(id).addEventListener('change', renderMAs);
  $(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') renderMAs(); });
});

// --- Drawing (trend lines on price chart) ---
const SVG_NS = 'http://www.w3.org/2000/svg';
const drawnLines = [];          // [{ t1, p1, t2, p2 }]
let drawMode = false;
let firstPt = null;             // { time, price }
let cursorPt = null;            // { x, y } for preview rubber-band

function setDrawMode(on) {
  drawMode = on;
  firstPt = null;
  cursorPt = null;
  $('drawBtn').classList.toggle('active', on);
  $('chartWrap').classList.toggle('drawing', on);
  renderLines();
}

function pixelToTimePrice(x, y) {
  let time = priceChart.timeScale().coordinateToTime(x);
  // If outside data range, snap to nearest known bar so the line still anchors
  if (time == null && lastData && lastData.rows.length) {
    const logical = priceChart.timeScale().coordinateToLogical(x);
    if (logical != null) {
      const rows = lastData.rows;
      const idx = Math.max(0, Math.min(rows.length - 1, Math.round(logical)));
      time = rows[idx].time;
    }
  }
  const price = candleSeries.coordinateToPrice(y);
  if (time == null || price == null) return null;
  return { time, price };
}

function chartRelative(e) {
  const chartEl = $('priceChart');
  const rect = chartEl.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  const inside = x >= 0 && y >= 0 && x <= rect.width && y <= rect.height;
  return { x, y, inside };
}

function handleDrawClick(e) {
  if (!drawMode) return;
  const { x, y, inside } = chartRelative(e);
  if (!inside) return;
  const pt = pixelToTimePrice(x, y);
  if (!pt) return;

  e.preventDefault();
  e.stopPropagation();
  if (e.stopImmediatePropagation) e.stopImmediatePropagation();

  if (!firstPt) {
    firstPt = { time: pt.time, price: pt.price };
    cursorPt = { x, y };
    renderLines();
  } else {
    drawnLines.push({ t1: firstPt.time, p1: firstPt.price, t2: pt.time, p2: pt.price });
    setDrawMode(false);
  }
}

function handleDrawMove(e) {
  if (!drawMode || !firstPt) return;
  const { x, y, inside } = chartRelative(e);
  if (!inside) return;
  cursorPt = { x, y };
  renderLines();
}

// Attach at document level with capture phase — guarantees we see the event
// before any chart-internal handler can call setPointerCapture or stopPropagation.
document.addEventListener('pointerdown', handleDrawClick, { capture: true });
document.addEventListener('pointermove', handleDrawMove, { capture: true });
// Also block click+mousedown while in draw mode so the chart doesn't react
['click', 'mousedown', 'touchstart'].forEach(type => {
  document.addEventListener(type, (e) => {
    if (!drawMode) return;
    const { inside } = chartRelative(e);
    if (!inside) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();
  }, { capture: true });
});

function renderLines() {
  const svg = $('drawOverlay');
  const chartEl = $('priceChart');
  const w = chartEl.clientWidth;
  const h = chartEl.clientHeight;
  svg.setAttribute('width', w);
  svg.setAttribute('height', h);
  // Clear
  while (svg.firstChild) svg.removeChild(svg.firstChild);

  const ts = priceChart.timeScale();

  for (const ln of drawnLines) {
    const x1 = ts.timeToCoordinate(ln.t1);
    const x2 = ts.timeToCoordinate(ln.t2);
    const y1 = candleSeries.priceToCoordinate(ln.p1);
    const y2 = candleSeries.priceToCoordinate(ln.p2);
    if (x1 == null || x2 == null || y1 == null || y2 == null) continue;
    appendLine(svg, x1, y1, x2, y2, false);
  }

  // Preview line from firstPt to cursor while drawing
  if (drawMode && firstPt && cursorPt) {
    const x1 = ts.timeToCoordinate(firstPt.time);
    const y1 = candleSeries.priceToCoordinate(firstPt.price);
    if (x1 != null && y1 != null) {
      appendLine(svg, x1, y1, cursorPt.x, cursorPt.y, true);
    }
  }
}

function appendLine(svg, x1, y1, x2, y2, preview) {
  const ln = document.createElementNS(SVG_NS, 'line');
  ln.setAttribute('x1', x1); ln.setAttribute('y1', y1);
  ln.setAttribute('x2', x2); ln.setAttribute('y2', y2);
  if (preview) ln.setAttribute('class', 'preview');
  svg.appendChild(ln);
  // Endpoints for non-preview lines
  if (!preview) {
    for (const [cx, cy] of [[x1, y1], [x2, y2]]) {
      const c = document.createElementNS(SVG_NS, 'circle');
      c.setAttribute('cx', cx);
      c.setAttribute('cy', cy);
      c.setAttribute('r', 3);
      c.setAttribute('class', 'endpoint');
      svg.appendChild(c);
    }
  }
}

// Redraw lines on pan/zoom/resize
priceChart.timeScale().subscribeVisibleLogicalRangeChange(renderLines);
const origResizeCharts = resizeCharts;
window.addEventListener('resize', () => setTimeout(renderLines, 60));

$('drawBtn').addEventListener('click', () => setDrawMode(!drawMode));
$('clearLinesBtn').addEventListener('click', () => {
  drawnLines.length = 0;
  setDrawMode(false);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && drawMode) setDrawMode(false);
});

load();
