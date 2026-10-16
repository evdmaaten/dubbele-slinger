import { parsePathCSV, makePathComparison } from './paths.js';

const $ = id => document.getElementById(id);
const COLORS = { one: '#008c94', two: '#d26948', grid: '#e4e8df', ink: '#63757a', axis: '#9badab' };
const CONTROL_IDS = ['path-time-factor', 'path-offset', 'path-until', 'path-marker1', 'path-marker2', 'path-scale', 'path-roll', 'path-overlay'];
const FIELDS = {
  timeFactor: { id: 'path-time-factor', min: 0, exclusive: true },
  offsetVideo: { id: 'path-offset', min: 0 },
  maxTime: { id: 'path-until', min: 0, exclusive: true },
  marker1Fraction: { id: 'path-marker1', min: 0, max: 1 },
  marker2Fraction: { id: 'path-marker2', min: 0, max: 1 },
  pixelsPerMeter: { id: 'path-scale', min: 0, exclusive: true, optional: true },
  cameraRollDeg: { id: 'path-roll' },
};
let initialized = false, lastPrimary = null, loadedRows = null, filename = '', expectedFilename = '';
let lastError = '', loadVersion = 0, loading = false;

function numberText(value, decimals = 2) {
  return Number.isFinite(value) ? value.toLocaleString('nl-NL', { maximumFractionDigits: decimals }) : '—';
}

function allowed(value, rule) {
  return typeof value === 'number' && Number.isFinite(value)
    && (rule.min === undefined || (rule.exclusive ? value > rule.min : value >= rule.min))
    && (rule.max === undefined || value <= rule.max);
}

function readSettings() {
  const settings = {};
  for (const [name, rule] of Object.entries(FIELDS)) {
    const input = $(rule.id), raw = input.value.trim();
    if (rule.optional && !raw && !input.validity?.badInput) { settings[name] = null; continue; }
    const value = Number(raw);
    if (!raw || input.validity?.badInput || !allowed(value, rule)) {
      const labels = {
        timeFactor: 'Tijdsfactor moet positief zijn.', offsetVideo: 'Het starttijdstip in de video moet nul of positief zijn.',
        maxTime: 'Het einde van het modelvenster moet positief zijn.',
        marker1Fraction: 'Markeerfractie 1 moet tussen 0 en 1 liggen.', marker2Fraction: 'Markeerfractie 2 moet tussen 0 en 1 liggen.',
        pixelsPerMeter: 'Schaal moet leeg zijn of een positief aantal pixels per meter.', cameraRollDeg: 'Beeldrotatie moet een eindig aantal graden zijn.',
      };
      throw new Error(labels[name]);
    }
    settings[name] = value;
  }
  settings.overlay = settings.pixelsPerMeter !== null && $('path-overlay').checked;
  return settings;
}

function updateOverlayControl() {
  const input = $('path-scale'), raw = input.value.trim();
  const available = raw !== '' && !input.validity?.badInput && allowed(Number(raw), FIELDS.pixelsPerMeter);
  $('path-overlay').disabled = !available;
  if (!available) $('path-overlay').checked = false;
}

function prepareCanvas(id) {
  const canvas = $(id), box = canvas.getBoundingClientRect();
  if (box.width <= 0 || box.height <= 0) return null;
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.round(box.width * ratio)), height = Math.max(1, Math.round(box.height * ratio));
  if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, box.width, box.height);
  return { canvas, ctx, width: box.width, height: box.height,
    plotWidth: Math.max(30, box.width - 82), plotHeight: Math.max(30, box.height - 70) };
}

function blank(canvas, message) {
  if (!canvas) return;
  const { ctx, width, height } = canvas;
  ctx.fillStyle = COLORS.ink; ctx.font = '12px Segoe UI, sans-serif'; ctx.textAlign = 'center';
  ctx.fillText(message, width / 2, height / 2, Math.max(20, width - 24));
  canvas.canvas.setAttribute('aria-label', message);
}

function boundsFor(paths, unit) {
  let minX = 0, maxX = 0, minY = 0, maxY = 0;
  for (const rows of paths) for (const row of rows) {
    if (!row.valid) continue;
    for (const n of [1, 2]) {
      const x = row[`x${n}`], y = row[`y${n}`];
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
  }
  const extent = Math.max(maxX - minX, maxY - minY) || (unit === 'px' ? 100 : 0.2);
  const padding = extent * 0.09;
  return { minX: minX - padding, maxX: maxX + padding, minY: minY - padding, maxY: maxY + padding };
}

function equalAspect(bounds, width, height) {
  const centerX = (bounds.minX + bounds.maxX) / 2, centerY = (bounds.minY + bounds.maxY) / 2;
  const scale = Math.min(width / (bounds.maxX - bounds.minX), height / (bounds.maxY - bounds.minY));
  return { minX: centerX - width / (2 * scale), maxX: centerX + width / (2 * scale),
    minY: centerY - height / (2 * scale), maxY: centerY + height / (2 * scale) };
}

function tickStep(span) {
  const power = 10 ** Math.floor(Math.log10(span / 4));
  const fraction = span / 4 / power;
  return power * (fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10);
}

function ticks(min, max, step) {
  const values = [], first = Math.ceil(min / step);
  for (let n = first; n * step <= max + step * 1e-8 && values.length < 30; n++) values.push(n * step);
  return values;
}

function tickText(value, step) {
  if (Math.abs(value) < step * 1e-8) return '0';
  if (Math.abs(value) >= 10000 || Math.abs(value) < 0.0001) return value.toExponential(1).replace('.', ',');
  return numberText(value, Math.max(0, Math.min(6, -Math.floor(Math.log10(step)))));
}

function drawPlot(canvas, series, unit, bounds, sharedSize = null) {
  if (!canvas) return;
  const { ctx, width, height } = canvas;
  const plotWidth = sharedSize?.width ?? canvas.plotWidth, plotHeight = sharedSize?.height ?? canvas.plotHeight;
  const left = 60 + (canvas.plotWidth - plotWidth) / 2, top = 22 + (canvas.plotHeight - plotHeight) / 2;
  const domain = equalAspect(bounds, plotWidth, plotHeight);
  const toX = value => left + (value - domain.minX) / (domain.maxX - domain.minX) * plotWidth;
  const toY = value => top + (domain.maxY - value) / (domain.maxY - domain.minY) * plotHeight;
  const xStep = tickStep(domain.maxX - domain.minX), yStep = tickStep(domain.maxY - domain.minY);
  ctx.font = '10px Segoe UI, sans-serif'; ctx.lineWidth = 1;
  for (const value of ticks(domain.minX, domain.maxX, xStep)) {
    const x = toX(value);
    ctx.strokeStyle = Math.abs(value) < xStep * 1e-8 ? COLORS.axis : COLORS.grid;
    ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, top + plotHeight); ctx.stroke();
    ctx.fillStyle = COLORS.ink; ctx.textAlign = 'center'; ctx.fillText(tickText(value, xStep), x, top + plotHeight + 17);
  }
  for (const value of ticks(domain.minY, domain.maxY, yStep)) {
    const y = toY(value);
    ctx.strokeStyle = Math.abs(value) < yStep * 1e-8 ? COLORS.axis : COLORS.grid;
    ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(left + plotWidth, y); ctx.stroke();
    ctx.fillStyle = COLORS.ink; ctx.textAlign = 'right'; ctx.fillText(tickText(value, yStep), left - 7, y + 3);
  }
  ctx.fillStyle = COLORS.ink; ctx.font = '11px Segoe UI, sans-serif'; ctx.textAlign = 'right';
  ctx.fillText(`x (${unit}) →`, left + plotWidth, height - 7);
  ctx.textAlign = 'left'; ctx.fillText(`y (${unit}) ↑`, left, 12);
  ctx.save(); ctx.beginPath(); ctx.rect(left, top, plotWidth, plotHeight); ctx.clip();
  for (const { rows, dashed = false } of series) for (const n of [1, 2]) {
    ctx.strokeStyle = n === 1 ? COLORS.one : COLORS.two;
    ctx.lineWidth = dashed ? 1.5 : 1.8; ctx.setLineDash(dashed ? [5, 4] : []); ctx.beginPath();
    let connected = false, previousFrame = null, lastPoint = null;
    for (const row of rows) {
      const x = row[`x${n}`], y = row[`y${n}`];
      if (!row.valid || !Number.isFinite(x) || !Number.isFinite(y)) { connected = false; previousFrame = null; continue; }
      const frameGap = Number.isInteger(previousFrame) && Number.isInteger(row.frame) && row.frame !== previousFrame + 1;
      if (!connected || row.breakBefore || frameGap) ctx.moveTo(toX(x), toY(y));
      else ctx.lineTo(toX(x), toY(y));
      connected = true; previousFrame = row.frame; lastPoint = [toX(x), toY(y)];
    }
    ctx.stroke(); ctx.setLineDash([]);
    if (lastPoint) { ctx.beginPath(); ctx.arc(...lastPoint, dashed ? 2.5 : 3, 0, Math.PI * 2); ctx.fillStyle = ctx.strokeStyle; ctx.fill(); }
  }
  ctx.setLineDash([]); ctx.strokeStyle = '#172d36'; ctx.lineWidth = 1.3;
  const pivotX = toX(0), pivotY = toY(0);
  ctx.beginPath(); ctx.moveTo(pivotX - 4, pivotY); ctx.lineTo(pivotX + 4, pivotY); ctx.moveTo(pivotX, pivotY - 4); ctx.lineTo(pivotX, pivotY + 4); ctx.stroke();
  ctx.fillStyle = '#172d36'; ctx.font = '10px Segoe UI, sans-serif'; ctx.textAlign = 'left'; ctx.fillText('P', pivotX + 6, pivotY - 6);
  ctx.restore();
  canvas.canvas.setAttribute('aria-label', `XY-banen van markeerpunten 1 en 2; x rechts en y omhoog in ${unit}; gelijke schaal op beide assen; P is het ophangpunt.`);
}

function assumptionText(settings) {
  const clock = settings.timeFactor === 1
    ? 'Tijdsfactor 1 veronderstelt realtime; de echte tijdschaal van de video is nog onbekend.'
    : `Tijdsfactor ${numberText(settings.timeFactor, 4)} is een scenario; de echte tijdschaal is nog onbekend.`;
  return `${clock} De groene stip ligt vóór het uiteinde; markeerfracties moeten nog worden gemeten (1 = scharnier/eindpunt).`;
}

function redraw() {
  if (!initialized) return;
  updateOverlayControl();
  const measuredCanvas = prepareCanvas('measured-path-chart'), modelCanvas = prepareCanvas('model-path-chart');
  const clear = message => { blank(measuredCanvas, message); blank(modelCanvas, message); };
  let settings;
  try { settings = readSettings(); }
  catch (error) { clear('Geen baan bij ongeldige instellingen'); $('path-status').textContent = error.message; return; }
  if (loading) { clear('Meetbestand wordt ingelezen…'); $('path-status').textContent = 'Lokaal meetbestand wordt ingelezen…'; return; }
  if (lastError) { clear('Meetbestand niet ingelezen'); $('path-status').textContent = lastError; return; }
  if (!loadedRows) {
    clear('Laad een lokale baan-CSV');
    $('path-status').textContent = `${expectedFilename ? `Laad ${expectedFilename} opnieuw; het JSON-bestand bevat geen meetpunten.` : 'Nog geen baanmeting geladen.'} ${assumptionText(settings)}`;
    return;
  }
  if (!lastPrimary?.samples?.length || lastPrimary.status === 'error') {
    clear('Bereken eerst een geldige modelproef'); $('path-status').textContent = 'Bereken eerst een geldige modelproef voor een gezamenlijk tijdvenster.'; return;
  }
  try {
    const result = makePathComparison(loadedRows, lastPrimary.samples, { ...settings, s1: lastPrimary.params.s1, s2: lastPrimary.params.s2 });
    if (!result.flags.hasOverlap || !result.timeRange || !result.flags.measuredValidCount) {
      clear('Geen geldige punten in hetzelfde tijdvenster');
      $('path-status').textContent = `Geen overlap van geldige meetpunten en model. Controleer videotijd, factor en eindtijd. ${assumptionText(settings)}`;
      return;
    }
    let measuredBounds, modelBounds, sharedSize = null;
    if (result.flags.scaled) {
      measuredBounds = modelBounds = boundsFor([result.measuredPath, result.modelPath], 'm');
      if (measuredCanvas && modelCanvas) sharedSize = { width: Math.min(measuredCanvas.plotWidth, modelCanvas.plotWidth), height: Math.min(measuredCanvas.plotHeight, modelCanvas.plotHeight) };
    } else {
      measuredBounds = boundsFor([result.measuredPath], 'px'); modelBounds = boundsFor([result.modelPath], 'm');
    }
    drawPlot(measuredCanvas, [{ rows: result.measuredPath }], result.unit, measuredBounds, sharedSize);
    const modelSeries = [{ rows: result.modelPath }];
    if (settings.overlay && result.flags.scaled) modelSeries.push({ rows: result.measuredPath, dashed: true });
    drawPlot(modelCanvas, modelSeries, 'm', modelBounds, sharedSize);
    const range = `${numberText(result.timeRange.start, 3)}–${numberText(result.timeRange.end, 3)} s modeltijd`;
    const scaling = result.flags.scaled
      ? `Beide panelen in meter op dezelfde assen; omzetting met ${numberText(settings.pixelsPerMeter, 3)} px/m en ${numberText(settings.cameraRollDeg, 3)}° rotatie is voorlopig. Geen perspectiefcorrectie of ruimtelijke RMSE.`
      : 'Links pixels, rechts meters, met afzonderlijke asbereiken; vormgelijkenis is geen ruimtelijke overeenstemming.';
    const overlay = settings.overlay && result.flags.scaled ? ' Rechts: gemeten baan gestreept, model doorgetrokken; voorlopige overlay.' : '';
    const gaps = result.flags.hasGaps ? ' Onderbrekingen in de meetbaan blijven zichtbaar.' : '';
    const warnings = result.warnings?.length ? ` ${result.warnings.join(' ')}` : '';
    $('path-status').textContent = `${result.flags.measuredValidCount} geldige meetpunten; ${result.flags.measuredInvalidCount} ongeldige en ${result.flags.excludedCount} buiten het venster. Gedeeld venster: ${range}. ${scaling}${overlay}${gaps} ${assumptionText(settings)}${warnings}`;
  } catch (error) {
    clear('Geen baan bij ongeldige gegevens'); $('path-status').textContent = error.message;
  }
}

/** Bind once after the page's controls exist. No file is fetched automatically. */
export function initPathView() {
  if (initialized) return;
  initialized = true;
  for (const id of CONTROL_IDS) $(id).addEventListener('input', redraw);
  $('path-file').addEventListener('change', async event => {
    const file = event.target.files[0]; if (!file) return;
    const version = ++loadVersion;
    loadedRows = null; filename = ''; expectedFilename = ''; lastError = ''; loading = true;
    $('path-file-label').textContent = 'Bezig met lokaal inlezen…'; redraw();
    try {
      if (file.size > 5_000_000) throw new Error('Maximaal 5 MB per baanbestand.');
      const text = await file.text();
      if (version !== loadVersion) return;
      loadedRows = parsePathCSV(text); filename = file.name;
      $('path-file-label').textContent = filename;
    } catch (error) {
      if (version !== loadVersion) return;
      loadedRows = null; lastError = error.message; $('path-file-label').textContent = 'Bestand niet ingelezen';
    } finally {
      if (version === loadVersion) { loading = false; event.target.value = ''; redraw(); }
    }
  });
  $('path-clear').addEventListener('click', () => {
    loadVersion++; loadedRows = null; filename = ''; expectedFilename = ''; lastError = ''; loading = false;
    $('path-file').value = ''; $('path-file-label').textContent = 'Selecteer een lokaal baanbestand';
    $('path-overlay').checked = false; redraw();
  });
  redraw();
}

/** Redraw on a completed calculation or resize; omit the argument to retain it. */
export function updatePathView(primary) {
  if (arguments.length) lastPrimary = primary;
  redraw();
}

/** JSON contains settings and a filename, never the imported marker positions. */
export function getPathComparisonSettings() {
  try { return { ...readSettings(), filename: filename || expectedFilename || null }; }
  catch (error) { return { valid: false, error: error.message, filename: filename || expectedFilename || null }; }
}

/** Restore only recognized finite settings. Require the CSV to be loaded again. */
export function restorePathComparisonSettings(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return;
  for (const [name, rule] of Object.entries(FIELDS)) {
    const value = config[name];
    if (rule.optional && value === null) $(rule.id).value = '';
    else if (allowed(value, rule)) $(rule.id).value = String(value);
  }
  $('path-overlay').checked = config.overlay === true;
  loadVersion++; loadedRows = null; filename = ''; lastError = ''; loading = false;
  expectedFilename = typeof config.filename === 'string' && config.filename.length <= 255 ? config.filename : '';
  $('path-file').value = ''; $('path-file-label').textContent = expectedFilename ? `${expectedFilename} · opnieuw laden` : 'Selecteer een lokaal baanbestand';
  redraw();
}
