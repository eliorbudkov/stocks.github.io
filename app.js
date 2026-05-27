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

// expose for the script-version check (not used otherwise)
window.__stocksAppVersion = 11;

// --- Drawing (trend lines on price chart) ---
// Architecture:
// 1. #drawCatcher overlay (z=10) catches all pointer events ONLY while in draw mode.
// 2. Lines are stored as { t1, p1, t2, p2 } in `drawnLines`.
// 3. Rendering is done via an SVG overlay (#drawOverlay, z=5) by converting
//    each line's (time, price) back to pixels using the SAME chart APIs that
//    were used to read the click — guaranteeing visual consistency.
// 4. Re-render on every chart pan/zoom + resize so lines stay anchored.
const SVG_NS = 'http://www.w3.org/2000/svg';
const drawnLines = [];          // [{ t1, p1, t2, p2 }]
let drawMode = false;
let firstPt = null;             // { time, price }
let cursorPx = null;            // { x, y } for preview line

function setDrawMode(on) {
  drawMode = on;
  firstPt = null;
  cursorPx = null;
  $('drawBtn').classList.toggle('active', on);
  $('chartWrap').classList.toggle('drawing', on);
  renderLines();
}

function clickPosToTimePrice(e) {
  const chartEl = $('priceChart');
  const rect = chartEl.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  const time = priceChart.timeScale().coordinateToTime(x);
  const price = candleSeries.coordinateToPrice(y);
  if (time == null || price == null) return null;
  return { time, price, x, y };
}

function onCatcherDown(e) {
  const pt = clickPosToTimePrice(e);
  if (!pt) {
    // Click outside data area — give brief feedback
    statusEl.textContent = 'לחץ בתוך אזור הנרות בגרף';
    return;
  }
  if (!firstPt) {
    firstPt = { time: pt.time, price: pt.price };
    cursorPx = { x: pt.x, y: pt.y };
    renderLines();
  } else {
    drawnLines.push({ t1: firstPt.time, p1: firstPt.price, t2: pt.time, p2: pt.price });
    setDrawMode(false);
  }
}

function onCatcherMove(e) {
  if (!firstPt) return;
  const chartEl = $('priceChart');
  const rect = chartEl.getBoundingClientRect();
  cursorPx = { x: e.clientX - rect.left, y: e.clientY - rect.top };
  renderLines();
}

const catcher = $('drawCatcher');
catcher.addEventListener('pointerdown', onCatcherDown);
catcher.addEventListener('pointermove', onCatcherMove);
catcher.addEventListener('touchstart', (e) => { e.preventDefault(); }, { passive: false });

function renderLines() {
  const svg = $('drawOverlay');
  const chartEl = $('priceChart');
  const w = chartEl.clientWidth;
  const h = chartEl.clientHeight;
  svg.setAttribute('width', w);
  svg.setAttribute('height', h);
  while (svg.firstChild) svg.removeChild(svg.firstChild);

  const ts = priceChart.timeScale();
  for (const ln of drawnLines) {
    const x1 = ts.timeToCoordinate(ln.t1);
    const x2 = ts.timeToCoordinate(ln.t2);
    const y1 = candleSeries.priceToCoordinate(ln.p1);
    const y2 = candleSeries.priceToCoordinate(ln.p2);
    if (x1 == null || x2 == null || y1 == null || y2 == null) continue;
    appendSvgLine(svg, x1, y1, x2, y2, false);
  }
  if (drawMode && firstPt && cursorPx) {
    const x1 = ts.timeToCoordinate(firstPt.time);
    const y1 = candleSeries.priceToCoordinate(firstPt.price);
    if (x1 != null && y1 != null) {
      appendSvgLine(svg, x1, y1, cursorPx.x, cursorPx.y, true);
    }
  }
}

function appendSvgLine(svg, x1, y1, x2, y2, preview) {
  const ln = document.createElementNS(SVG_NS, 'line');
  ln.setAttribute('x1', x1); ln.setAttribute('y1', y1);
  ln.setAttribute('x2', x2); ln.setAttribute('y2', y2);
  if (preview) ln.setAttribute('class', 'preview');
  svg.appendChild(ln);
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

// Keep lines anchored on pan/zoom/resize
priceChart.timeScale().subscribeVisibleLogicalRangeChange(renderLines);
window.addEventListener('resize', () => setTimeout(renderLines, 80));

$('drawBtn').addEventListener('click', () => setDrawMode(!drawMode));
$('clearLinesBtn').addEventListener('click', () => {
  drawnLines.length = 0;
  setDrawMode(false);
  renderLines();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && drawMode) setDrawMode(false);
});

// =========================================================
// WhatsApp Price Alerts
// =========================================================
const LS_PHONE = 'stocks.alerts.phone';
const LS_ALERTS = 'stocks.alerts.list';

let alerts = [];           // [{ id, ticker, price, direction, lastPrice, triggered }]
let alertsTimer = null;
const ALERT_INTERVAL_MS = 5 * 60 * 1000;  // 5 min

function loadAlerts() {
  try {
    alerts = JSON.parse(localStorage.getItem(LS_ALERTS) || '[]');
  } catch { alerts = []; }
  const phone = localStorage.getItem(LS_PHONE) || '';
  $('alertPhone').value = phone;
  renderAlerts();
}

function saveAlerts() {
  localStorage.setItem(LS_ALERTS, JSON.stringify(alerts));
}

function renderAlerts() {
  const list = $('alertsList');
  list.innerHTML = '';
  if (alerts.length === 0) {
    list.innerHTML = '<div class="alerts-empty">אין התראות פעילות</div>';
    return;
  }
  for (const a of alerts) {
    const row = document.createElement('div');
    row.className = 'alert-item' + (a.triggered ? ' triggered' : '');
    const dirText = a.direction === 'above' ? '↑ מעל' : '↓ מתחת';
    const dirClass = a.direction === 'above' ? 'dir-up' : 'dir-down';
    const last = a.lastPrice != null ? `· אחרון: ${a.lastPrice.toFixed(2)}` : '';
    const trig = a.triggered ? ' · ✅ נורה' : '';
    row.innerHTML = `
      <div class="info">
        <span class="sym">${a.ticker}</span>
        <span class="${dirClass}">${dirText} ${a.price}</span>
        <span class="last">${last}${trig}</span>
      </div>
      <div class="actions">
        <button data-act="reset" data-id="${a.id}">איפוס</button>
        <button data-act="del" data-id="${a.id}" class="del">מחק</button>
      </div>
    `;
    list.appendChild(row);
  }
  list.querySelectorAll('button[data-act]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      const act = btn.dataset.act;
      if (act === 'del') {
        alerts = alerts.filter(a => a.id !== id);
      } else if (act === 'reset') {
        const a = alerts.find(x => x.id === id);
        if (a) { a.triggered = false; a.lastPrice = null; }
      }
      saveAlerts();
      renderAlerts();
    });
  });
}

function addAlert() {
  const ticker = $('alertTicker').value.trim().toUpperCase();
  const price = parseFloat($('alertPrice').value);
  const direction = $('alertDir').value;
  if (!ticker || !Number.isFinite(price)) {
    alert('הזן סימול ומחיר תקינים');
    return;
  }
  alerts.push({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    ticker, price, direction,
    lastPrice: null, triggered: false,
  });
  saveAlerts();
  renderAlerts();
  $('alertTicker').value = '';
  $('alertPrice').value = '';
}

async function fetchLastPrice(ticker) {
  try {
    const result = await fetchYahoo(ticker, '5d');
    const q = result.indicators?.quote?.[0];
    const closes = q?.close || [];
    for (let i = closes.length - 1; i >= 0; i--) {
      if (closes[i] != null) return closes[i];
    }
  } catch (e) {
    console.warn('alert fetch failed', ticker, e);
  }
  return null;
}

function buildAlertMessage(a, curr) {
  const dir = a.direction === 'above' ? 'מעל' : 'מתחת';
  return `🔔 ${a.ticker} חצה ${dir} ${a.price}\nמחיר כעת: ${curr.toFixed(2)}\nזמן: ${new Date().toLocaleString('he-IL')}`;
}

function fireAlert(a, curr) {
  const msg = buildAlertMessage(a, curr);
  // Desktop notification
  if ('Notification' in window && Notification.permission === 'granted') {
    try { new Notification('התראת מניה', { body: msg }); } catch {}
  }
  // Open WhatsApp send link in new tab
  const phone = ($('alertPhone').value || '').replace(/[^0-9]/g, '');
  if (phone) {
    const url = `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`;
    window.open(url, '_blank');
  }
}

async function checkAlerts() {
  if (alerts.length === 0) {
    $('autoInfo').textContent = '⏱ אין התראות לבדוק';
    return;
  }
  $('autoInfo').textContent = '⏱ בודק כעת...';
  // Unique tickers
  const tickers = [...new Set(alerts.filter(a => !a.triggered).map(a => a.ticker))];
  const prices = {};
  for (const t of tickers) {
    prices[t] = await fetchLastPrice(t);
  }
  let firedCount = 0;
  for (const a of alerts) {
    if (a.triggered) continue;
    const curr = prices[a.ticker];
    if (curr == null) continue;
    const prev = a.lastPrice;
    const cross =
      (a.direction === 'above' && curr >= a.price && (prev == null || prev < a.price)) ||
      (a.direction === 'below' && curr <= a.price && (prev == null || prev > a.price));
    a.lastPrice = curr;
    if (cross) {
      a.triggered = true;
      fireAlert(a, curr);
      firedCount++;
    }
  }
  saveAlerts();
  renderAlerts();
  const now = new Date().toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
  $('autoInfo').textContent = `⏱ נבדק ב-${now}${firedCount ? ` · ${firedCount} ירו` : ''}`;
}

function startAlertsPolling() {
  if (alertsTimer) clearInterval(alertsTimer);
  alertsTimer = setInterval(checkAlerts, ALERT_INTERVAL_MS);
}

$('addAlertBtn').addEventListener('click', addAlert);
$('alertPrice').addEventListener('keydown', (e) => { if (e.key === 'Enter') addAlert(); });
$('alertTicker').addEventListener('keydown', (e) => { if (e.key === 'Enter') addAlert(); });
$('alertPhone').addEventListener('change', () => {
  localStorage.setItem(LS_PHONE, $('alertPhone').value.trim());
});
$('checkAlertsBtn').addEventListener('click', checkAlerts);
$('enableNotifBtn').addEventListener('click', async () => {
  if (!('Notification' in window)) {
    alert('הדפדפן לא תומך בהתראות מסך');
    return;
  }
  const perm = await Notification.requestPermission();
  $('enableNotifBtn').textContent = perm === 'granted' ? '✓ הותר' : 'אפשר התראות מסך';
});

loadAlerts();
startAlertsPolling();

// =========================================================
// Real-time scanner
// =========================================================
const LS_WATCHLIST = 'stocks.scanner.watchlist';
let scannerWatchlist = [];
const scannerData = {};   // ticker -> { price, prev, change, changePct, rsi, ma50, ma200, volume, updated, error }
let scannerTimer = null;
let scannerActive = false;
let scannerIntervalMs = 30000;
let scannerSortKey = 'ticker';
let scannerSortDir = 1;   // 1 = asc, -1 = desc

function loadWatchlist() {
  try { scannerWatchlist = JSON.parse(localStorage.getItem(LS_WATCHLIST) || '[]'); }
  catch { scannerWatchlist = []; }
}
function saveWatchlist() {
  localStorage.setItem(LS_WATCHLIST, JSON.stringify(scannerWatchlist));
}

function addToWatchlist(raw) {
  const ticker = (raw || '').trim().toUpperCase();
  if (!ticker) return;
  if (scannerWatchlist.includes(ticker)) return;
  scannerWatchlist.push(ticker);
  saveWatchlist();
  renderScanner();
  fetchScannerTicker(ticker).then(renderScanner);
}

function removeFromWatchlist(ticker) {
  scannerWatchlist = scannerWatchlist.filter(t => t !== ticker);
  delete scannerData[ticker];
  saveWatchlist();
  renderScanner();
}

async function fetchScannerTicker(ticker) {
  try {
    const result = await fetchYahoo(ticker, '1y');
    const q = result.indicators?.quote?.[0];
    if (!q) throw new Error('אין נתונים');
    const rawCloses = q.close || [];
    const vols = q.volume || [];
    // Filter nulls but keep paired with volume
    const closes = [];
    const volsAligned = [];
    for (let i = 0; i < rawCloses.length; i++) {
      if (rawCloses[i] == null) continue;
      closes.push(rawCloses[i]);
      volsAligned.push(vols[i] ?? 0);
    }
    if (closes.length < 2) throw new Error('מעט נתונים');
    const last = closes[closes.length - 1];
    const prev = closes[closes.length - 2];
    const rsiArr = rsi(closes, 14);
    const rsiVal = rsiArr[closes.length - 1];
    const ma50Arr = sma(closes, 50);
    const ma200Arr = sma(closes, 200);
    scannerData[ticker] = {
      price: last,
      prev,
      change: last - prev,
      changePct: ((last - prev) / prev) * 100,
      rsi: rsiVal,
      ma50: ma50Arr[closes.length - 1],
      ma200: ma200Arr[closes.length - 1],
      volume: volsAligned[volsAligned.length - 1] || 0,
      currency: result.meta?.currency || '',
      updated: Date.now(),
    };
  } catch (e) {
    scannerData[ticker] = { error: String(e.message || e), updated: Date.now() };
  }
}

async function scanOnce() {
  if (scannerWatchlist.length === 0) return;
  $('scannerLastUpdate').textContent = 'מעדכן...';
  // Throttled parallelism: batches of 3
  for (let i = 0; i < scannerWatchlist.length; i += 3) {
    const batch = scannerWatchlist.slice(i, i + 3);
    await Promise.all(batch.map(fetchScannerTicker));
    renderScanner();
  }
  const now = new Date().toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  $('scannerLastUpdate').textContent = `עודכן ב-${now}`;
}

function startScanner() {
  if (scannerActive) return;
  scannerActive = true;
  $('scannerStart').style.display = 'none';
  $('scannerStop').style.display = '';
  scanOnce();
  scannerTimer = setInterval(scanOnce, scannerIntervalMs);
}

function stopScanner() {
  scannerActive = false;
  if (scannerTimer) { clearInterval(scannerTimer); scannerTimer = null; }
  $('scannerStart').style.display = '';
  $('scannerStop').style.display = 'none';
  $('scannerLastUpdate').textContent = 'מושהה';
}

function sortedTickers() {
  const arr = [...scannerWatchlist];
  arr.sort((a, b) => {
    if (scannerSortKey === 'ticker') {
      return scannerSortDir * a.localeCompare(b);
    }
    const da = scannerData[a] || {};
    const db = scannerData[b] || {};
    const va = da[scannerSortKey];
    const vb = db[scannerSortKey];
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    return scannerSortDir * (va - vb);
  });
  return arr;
}

function renderScanner() {
  const tbody = $('scannerBody');
  // Update sort indicators
  document.querySelectorAll('#scannerTable th[data-sort]').forEach(th => {
    const isActive = th.dataset.sort === scannerSortKey;
    th.innerHTML = th.textContent.replace(/^[▲▼]\s*/, '') ;
    if (isActive) {
      const arrow = scannerSortDir === 1 ? '▲' : '▼';
      th.innerHTML = `<span class="sort-ind">${arrow}</span>${th.textContent}`;
    }
  });

  if (scannerWatchlist.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="sc-empty">הוסף סימולים לרשימה (לדוגמה: AAPL, MSFT, TSLA, או TEVA.TA)</td></tr>';
    return;
  }

  const tickers = sortedTickers();
  tbody.innerHTML = '';
  for (const t of tickers) {
    const d = scannerData[t] || {};
    const tr = document.createElement('tr');
    tr.dataset.ticker = t;
    if (d.error) {
      tr.innerHTML = `<td class="sc-sym">${t}</td><td colspan="6" style="color:var(--red)">שגיאה: ${d.error}</td><td><button class="sc-del" data-t="${t}" type="button">✕</button></td>`;
    } else if (d.price == null) {
      tr.innerHTML = `<td class="sc-sym">${t}</td><td colspan="6" style="color:var(--text-soft)">טוען...</td><td><button class="sc-del" data-t="${t}" type="button">✕</button></td>`;
    } else {
      const dirCls = d.changePct >= 0 ? 'up' : 'down';
      const dirSign = d.changePct >= 0 ? '+' : '';
      const rsiCls = d.rsi >= 70 ? 'over' : d.rsi <= 30 ? 'under' : '';
      const ma50Cls = d.price > d.ma50 ? 'above' : 'below';
      const ma200Cls = d.price > d.ma200 ? 'above' : 'below';
      const ma50Arrow = d.price > d.ma50 ? '↑' : '↓';
      const ma200Arrow = d.price > d.ma200 ? '↑' : '↓';
      tr.innerHTML = `
        <td class="sc-sym">${t}</td>
        <td>${fmt(d.price)}</td>
        <td class="sc-change ${dirCls}">${dirSign}${fmt(d.changePct, 2)}%</td>
        <td class="sc-rsi ${rsiCls}">${fmt(d.rsi, 1)}</td>
        <td class="sc-ma ${ma50Cls}">${ma50Arrow} ${fmt(d.ma50)}</td>
        <td class="sc-ma ${ma200Cls}">${ma200Arrow} ${fmt(d.ma200)}</td>
        <td class="col-vol">${fmtVol(d.volume)}</td>
        <td><button class="sc-del" data-t="${t}" type="button">✕</button></td>
      `;
    }
    tbody.appendChild(tr);
  }
  // Wire up actions
  tbody.querySelectorAll('button.sc-del').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      removeFromWatchlist(btn.dataset.t);
    });
  });
  tbody.querySelectorAll('tr[data-ticker]').forEach(tr => {
    tr.addEventListener('click', () => {
      $('ticker').value = tr.dataset.ticker;
      load();
      document.querySelector('header').scrollIntoView({ behavior: 'smooth' });
    });
  });
}

$('scannerAdd').addEventListener('click', () => {
  addToWatchlist($('scannerTicker').value);
  $('scannerTicker').value = '';
});
$('scannerTicker').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    addToWatchlist($('scannerTicker').value);
    $('scannerTicker').value = '';
  }
});
$('scannerStart').addEventListener('click', startScanner);
$('scannerStop').addEventListener('click', stopScanner);
$('scannerInterval').addEventListener('change', () => {
  scannerIntervalMs = parseInt($('scannerInterval').value, 10) || 30000;
  if (scannerActive) { stopScanner(); startScanner(); }
});
document.querySelectorAll('#scannerTable th[data-sort]').forEach(th => {
  th.addEventListener('click', () => {
    const k = th.dataset.sort;
    if (scannerSortKey === k) scannerSortDir = -scannerSortDir;
    else { scannerSortKey = k; scannerSortDir = 1; }
    renderScanner();
  });
});

loadWatchlist();
renderScanner();
if (scannerWatchlist.length > 0) {
  scanOnce();
}

// =========================================================
// Day Gainers / Losers screener (Yahoo predefined screeners)
// =========================================================
const screenerProxies = [
  (u) => `https://corsproxy.io/?${encodeURIComponent(u)}`,
  (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  (u) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
];

async function fetchYahooScreener(scrId, count = 100) {
  const url = `https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?scrIds=${scrId}&count=${count}&lang=en-US&region=US`;
  let lastErr;
  for (const wrap of screenerProxies) {
    try {
      const r = await fetch(wrap(url));
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      const result = j?.finance?.result?.[0];
      if (!result) throw new Error('פורמט לא צפוי');
      return result.quotes || [];
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('הסורק לא זמין');
}

function numVal(v) {
  if (v == null) return null;
  if (typeof v === 'number') return v;
  if (typeof v === 'object' && 'raw' in v) return v.raw;
  return null;
}

async function runScreener() {
  const dir = $('screenerDir').value;
  const threshold = parseFloat($('screenerThreshold').value) || 0;
  const scrId = dir === 'up' ? 'day_gainers' : dir === 'down' ? 'day_losers' : 'most_actives';
  const labelMap = { up: 'עליות', down: 'ירידות', active: 'פעילות' };

  $('screenerStatus').textContent = `סורק ${labelMap[dir]}...`;
  $('screenerRunBtn').disabled = true;
  $('screenerCount').textContent = '';
  $('screenerBody').innerHTML = '<tr><td colspan="6" class="sc-empty">טוען...</td></tr>';

  try {
    const quotes = await fetchYahooScreener(scrId, 100);
    let filtered = quotes;
    if (dir === 'up') {
      filtered = quotes.filter(q => (numVal(q.regularMarketChangePercent) ?? 0) >= threshold);
    } else if (dir === 'down') {
      filtered = quotes.filter(q => (numVal(q.regularMarketChangePercent) ?? 0) <= -threshold);
    }
    // Sort: gainers desc, losers asc (most extreme first)
    filtered.sort((a, b) => {
      const pa = numVal(a.regularMarketChangePercent) ?? 0;
      const pb = numVal(b.regularMarketChangePercent) ?? 0;
      return dir === 'down' ? pa - pb : pb - pa;
    });
    renderScreenerResults(filtered, dir, threshold);
    const now = new Date().toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
    $('screenerStatus').textContent = `עודכן ב-${now}`;
    $('screenerCount').textContent = `${filtered.length} מתוך ${quotes.length} עומדים בסף`;
  } catch (e) {
    $('screenerStatus').textContent = 'שגיאה: ' + (e.message || e);
    $('screenerBody').innerHTML = '<tr><td colspan="6" class="sc-empty" style="color:var(--red)">לא הצלחנו לשלוף את הרשימה. נסה שוב.</td></tr>';
  } finally {
    $('screenerRunBtn').disabled = false;
  }
}

function renderScreenerResults(quotes, dir, threshold) {
  const tbody = $('screenerBody');
  if (quotes.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="sc-empty">לא נמצאו מנייות שעומדות בסף ${threshold}%</td></tr>`;
    return;
  }
  tbody.innerHTML = '';
  for (const q of quotes) {
    const sym = q.symbol;
    const name = q.shortName || q.longName || '';
    const price = numVal(q.regularMarketPrice);
    const pct = numVal(q.regularMarketChangePercent);
    const vol = numVal(q.regularMarketVolume);
    const dirCls = (pct ?? 0) >= 0 ? 'up' : 'down';
    const dirSign = (pct ?? 0) >= 0 ? '+' : '';
    const tr = document.createElement('tr');
    tr.dataset.ticker = sym;
    tr.innerHTML = `
      <td class="sc-sym">${sym}</td>
      <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;font-size:11px;color:var(--text-soft)" title="${name}">${name}</td>
      <td>${price != null ? fmt(price) : '-'}</td>
      <td class="sc-change ${dirCls}">${pct != null ? dirSign + fmt(pct, 2) + '%' : '-'}</td>
      <td class="col-vol">${vol != null ? fmtVol(vol) : '-'}</td>
      <td><button class="sc-del" data-add="${sym}" type="button" title="הוסף לרשימת המעקב">+</button></td>
    `;
    tbody.appendChild(tr);
  }
  // Wire row click → load into main chart
  tbody.querySelectorAll('tr[data-ticker]').forEach(tr => {
    tr.addEventListener('click', () => {
      $('ticker').value = tr.dataset.ticker;
      load();
      document.querySelector('header').scrollIntoView({ behavior: 'smooth' });
    });
  });
  // Wire + button → add to watchlist
  tbody.querySelectorAll('button[data-add]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      addToWatchlist(btn.dataset.add);
      btn.textContent = '✓';
      btn.disabled = true;
    });
  });
}

$('screenerRunBtn').addEventListener('click', runScreener);
$('screenerThreshold').addEventListener('keydown', (e) => { if (e.key === 'Enter') runScreener(); });
$('screenerDir').addEventListener('change', () => {
  // When switching to "active", threshold doesn't matter
  $('screenerThreshold').disabled = $('screenerDir').value === 'active';
});

load();
