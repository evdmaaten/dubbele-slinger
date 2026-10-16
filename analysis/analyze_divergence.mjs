/**
 * Local single-recording phase-space divergence diagnostic.
 * Reads measured image angles and explicit quality gaps; never uploads data.
 * Run: node analysis/analyze_divergence.mjs [local-analysis-directory]
 * All reported times are video-playback seconds. No 8x conversion is assumed.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { preparePhaseSeries, singleSeriesDivergence, fitDivergence } from '../lyapunov.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const directory = resolve(process.argv[2] || join(root, '.local-data', 'video-analyse'));
const sha256 = (content) => createHash('sha256').update(content).digest('hex');
const deg = Math.PI / 180;
const median = (values) => {
  const a = [...values].sort((x, y) => x - y);
  return a.length ? (a[Math.floor((a.length - 1) / 2)] + a[Math.ceil((a.length - 1) / 2)]) / 2 : null;
};
const scatter = (values) => {
  const center = median(values);
  return center === null ? null : 1.4826 * median(values.map((v) => Math.abs(v - center)));
};
function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/).filter((line) => line && !line.startsWith('#'));
  const headers = lines.shift().split(',');
  return lines.map((line) => Object.fromEntries(line.split(',').map((value, i) => [headers[i], value])));
}
const rawBytes = await readFile(join(directory, 'tracking-raw.csv'));
const qualityBytes = await readFile(join(directory, 'tracking-quality.csv'));
const angleBytes = await readFile(join(directory, 'hoeken-videotijd.csv'));
const raw = parseCSV(rawBytes.toString('utf8'));
const quality = parseCSV(qualityBytes.toString('utf8'));
const angleRows = parseCSV(angleBytes.toString('utf8'));
const anglesByFrame = new Map(angleRows.map((row) => [Number(row.frame), row]));
if (raw.length !== quality.length || quality.some((row, index) => Number(row.frame) !== index)) {
  throw new Error('Tracking and quality frames do not align.');
}
if (anglesByFrame.size !== angleRows.length) throw new Error('Duplicate frames in the exported angle CSV.');
const rawSeries = raw.map((row, i) => {
  const measured = anglesByFrame.get(i);
  const accepted = quality[i].accepted === '1';
  if (accepted !== Boolean(measured) || (measured && Math.abs(Number(measured.t) - Number(row.t_video_s)) > 1e-7)) {
    throw new Error(`Exported angle CSV does not match tracking quality/timestamps at frame ${i}.`);
  }
  return {
    t: Number(row.t_video_s), frame: i,
    // Use the exact public-to-the-local-UI CSV precision, so restoring the
    // accompanying settings reproduces this report's numerical inputs.
    theta1: measured ? Number(measured.theta1_deg) * deg : null,
    theta2: measured ? Number(measured.theta2_deg) * deg : null,
    valid: accepted && Number.isFinite(Number(measured.theta1_deg)) && Number.isFinite(Number(measured.theta2_deg)),
  };
});
const selection = { start: 13.5, end: 70 };
const series = rawSeries.filter((row) => row.t >= selection.start && row.t <= selection.end);
const base = {
  smoothingWindow: 11, maxGap: 0.05, tau: 1,
  theiler: 6, horizon: 0.5, maxPairs: 250, minPairs: 10,
  minInitialDistance: 0.05, maxInitialDistance: 0.20,
};
const scenarios = [
  { id: 'basis', label: 'Basis: 11 frames', color: '#087e8b', ...base },
  { id: 'smoothing-7', label: 'Venster 7 frames', color: '#cc641c', ...base, smoothingWindow: 7 },
  { id: 'smoothing-15', label: 'Venster 15 frames', color: '#6a4c93', ...base, smoothingWindow: 15 },
  { id: 'theiler-10', label: 'Theiler: 10 video-s', color: '#32734b', ...base, theiler: 10 },
  { id: 'distance-010', label: 'Beginafstand maximaal 0,10', color: '#606b75', ...base, maxInitialDistance: 0.10 },
];
const fitWindow = { start: 0.1, end: 0.4 };
const results = [];
for (const settings of scenarios) {
  const prepared = preparePhaseSeries(series, settings);
  const output = {
    id: settings.id, label: settings.label, color: settings.color, settings,
    preparationDiagnostics: prepared.diagnostics,
    preparationWarnings: prepared.warnings,
    preparedValidCount: prepared.rows.filter((row) => row.valid).length,
    status: 'unavailable', rows: [], pairs: [], fit: null,
  };
  try {
    const divergence = singleSeriesDivergence(prepared, settings);
    output.rows = divergence.rows;
    output.pairs = divergence.pairs;
    output.pairCount = divergence.pairCount;
    output.diagnostics = divergence.diagnostics;
    output.warnings = divergence.warnings;
    const distances = divergence.pairs.map((pair) => pair.delta0);
    const anchorTimes = divergence.pairs.flatMap((pair) => [pair.t1, pair.t2]);
    output.initialDistanceSummary = distances.length ? {
      min: Math.min(...distances), median: median(distances), max: Math.max(...distances),
      distinctAnchorFrames: new Set(divergence.pairs.flatMap((pair) => [pair.i, pair.j])).size,
      note: 'Overlapping pairs are correlated; pair count is not an independent sample size.',
    } : null;
    output.anchorTimeSummary = anchorTimes.length ? {
      minVideoSeconds: Math.min(...anchorTimes), medianVideoSeconds: median(anchorTimes),
      maxVideoSeconds: Math.max(...anchorTimes),
      fractionAtOrAfter50VideoSeconds: anchorTimes.filter((t) => t >= 50).length / anchorTimes.length,
      note: 'Repeated use of later, lower-amplitude states is a selection limitation, not independent evidence of chaotic recurrence.',
    } : null;
    try {
      output.fit = fitDivergence(divergence.rows, fitWindow);
      output.status = 'descriptive_fit_only';
    } catch (error) {
      output.fitError = error.message;
      output.status = divergence.rows.length ? 'curve_without_fit' : 'unavailable';
    }
  } catch (error) {
    output.error = error.message;
  }
  results.push(output);
}

// This stationary-looking interval estimates observed tracking/motion scatter;
// it is not a calibrated measurement uncertainty and does not correct the data.
const baseline = preparePhaseSeries(rawSeries.filter((row) => row.t >= 10.5 && row.t < 11.8), base);
const baselineValid = baseline.rows.filter((row) => row.valid);
const baselineScatter = Object.fromEntries(['theta1', 'theta2', 'omega1', 'omega2'].map((name) => [name, scatter(baselineValid.map((row) => row[name]))]));
const scenarioSlopes = results.map((result) => result.fit?.slope).filter(Number.isFinite);
const report = {
  status: 'Exploratory finite-window divergence of measured image-angle proxies; no validated Lyapunov exponent or chaos claim.',
  provenance: {
    rawTrackingFile: 'tracking-raw.csv', rawTrackingSHA256: sha256(rawBytes),
    qualityFile: 'tracking-quality.csv', qualitySHA256: sha256(qualityBytes),
    analysedAngleFile: 'hoeken-videotijd.csv', analysedAngleSHA256: sha256(angleBytes),
    anglePrecision: 'Same exported five-decimal-degree values as the HTML measurement import; raw frames retain explicit quality gaps.',
    totalFrames: raw.length, acceptedFrames: rawSeries.filter((row) => row.valid).length,
    analysedWindowVideoSeconds: selection,
    selectedFrames: series.length, selectedAcceptedFrames: series.filter((row) => row.valid).length,
  },
  time: {
    primaryUnit: 'video playback seconds', physicalTimeScale: 'UNKNOWN', playbackFps: 30,
    timeFactor: 1, noConfirmedSlowMotionConversion: true,
  },
  method: {
    type: 'Single-recording nearest-neighbor mean log divergence, Rosenstein-style',
    state: '[theta1, theta2, tau*omega1, tau*omega2]',
    angleConvention: 'Tracked pivot-to-orange and orange-to-green image angles; not independently calibrated joint angles.',
    norm: 'Euclidean norm with wrapped angular differences and unwrapped angular-velocity differences.',
    averaging: 'Mean of log(delta_pair(t)/delta_pair(0)) for a fixed cohort valid over the complete horizon.',
    gapPolicy: 'Explicit rejected frames remain gaps. No pair evolution crosses an invalid segment. No simulator correction.',
    derivativePolicy: 'Centered local regression of unwrapped angles; full smoothing window required, eroding segment edges.',
    fitWindowLagVideoSeconds: fitWindow,
    fitWindowSelection: 'Fixed before scenario comparison; not selected to maximize a positive slope or R-squared.',
  },
  baselineNoiseProxy: {
    windowVideoSeconds: [10.5, 11.8], validStateCount: baselineValid.length,
    robustScatterInRadiansAndRadiansPerVideoSecond: baselineScatter,
    phaseScatterNormAtTau1: Math.hypot(...Object.values(baselineScatter).map((value) => value ?? 0)),
    limitation: 'Observed spread includes tracking noise and possible real motion; not a calibrated confidence interval or complete phase-distance noise floor.',
  },
  scenarios: results,
  sensitivitySummary: {
    successfullyFittedScenarios: scenarioSlopes.length,
    slopeRangePerVideoSecond: scenarioSlopes.length ? [Math.min(...scenarioSlopes), Math.max(...scenarioSlopes)] : null,
    slopeChangesSign: scenarioSlopes.some((value) => value < 0) && scenarioSlopes.some((value) => value > 0),
    validatedPhysicalLyapunovExponent: false,
    interpretation: scenarioSlopes.some((value) => value < 0) && scenarioSlopes.some((value) => value > 0)
      ? 'The fitted slope changes sign across these exploratory settings. This recording does not support a robust positive Lyapunov estimate under this analysis.'
      : 'A stable sign alone would not establish chaos or a validated Lyapunov exponent; assess noise, stationarity, scale and fit-window sensitivity.',
  },
  limitations: [
    'Only one decaying, nonstationary recording is available; repeated phase-space visits are not repeated experiments.',
    'A positive finite-window slope can result from tracking noise, differentiation, phase mismatch, dissipation, or a transient; it is not proof of chaos.',
    'Rod masses are user-confirmed as upper 0.2703 kg and lower 0.2000 kg (each reported +/-0.001 kg), with no separate point weights at the yellow tracking markers. Uniform density, centres of mass, moments of inertia and damping remain uncalibrated model assumptions.',
    'Marker centres, physical hinge axes, camera roll, perspective and real time scale are not independently calibrated.',
    'The short horizon is imposed by frequent rejected tracking frames. It may not contain a genuine exponential-growth regime.',
    'Nearest-neighbor selection is concentrated in the later, lower-amplitude part of this decaying recording; early states may have no sufficiently close returns.',
    'Smoothing-window, exclusion-window and initial-distance sensitivity must be considered together.',
    'R-squared describes linear agreement in the chosen window only; it does not validate a Lyapunov exponent.',
    'Pairs and successive lag points share measurements and are correlated; no independent-observation confidence interval is supplied.',
  ],
};
await mkdir(directory, { recursive: true });
await writeFile(join(directory, 'faseruimte-divergentie.json'), JSON.stringify(report, null, 2) + '\n');
const csvRows = ['scenario,t_lag_video_s,mean_log_delta_ratio,pair_count'];
for (const result of results) for (const row of result.rows) {
  if (row.valid !== false && Number.isFinite(row.value)) csvRows.push([result.id, row.t, row.value, row.count ?? result.pairCount].join(','));
}
await writeFile(join(directory, 'faseruimte-divergentie.csv'), csvRows.join('\n') + '\n');
await writeFile(join(directory, 'faseruimte-instellingen.json'), JSON.stringify({
  schema: 'dubbele-slinger/divergence-v1',
  filename: 'hoeken-videotijd.csv',
  settings: {
    mode: 'single', clock: 'video', factor: 1, offset: 13.5, end: 70,
    tau: 1, smoothing: 11, gap: 0.05, theiler: 6, horizon: 0.5,
    floor: 0.05, radius: 0.2, fitStart: 0.1, fitEnd: 0.4,
  },
  note: 'Analysegrenzen zijn oorspronkelijke videotijden. Dit zijn verkennende instellingen, geen gekalibreerde fysische parameters.',
}, null, 2) + '\n');
await writeFile(join(directory, 'LEESMIJ-FASERUIMTE.txt'), [
  'LOKALE FASERUIMTE-DIVERGENTIE UIT EEN OPNAME',
  '',
  'De primaire tijdas is videotijd. De fysieke tijdschaal is onbekend; er is geen bevestigde 8x-omrekening.',
  'Dit is een verkennende analyse van afgeleide beeldhoeken. Een positieve helling bewijst geen chaos of Lyapunovexponent.',
  '',
  'Bekijken:',
  '- faseruimte-divergentie.png: wetenschappelijke figuur (na uitvoeren render_divergence.py).',
  '- faseruimte-divergentie.svg: zelfstandige vectorfiguur, direct te openen in een browser.',
  '- faseruimte-divergentie.json: bronhashes, preprocessing, vijf scenarios, curvepunten, paren en fitdiagnostiek.',
  '- faseruimte-divergentie.csv: gemiddelde logdivergentie per scenario en tijdvertraging.',
  '',
  'In de lokale HTML-interface:',
  '1. Herstel eerst de instellingen uit faseruimte-instellingen.json; dit wist een eventueel eerder geladen meetbestand.',
  '2. Laad daarna hoeken-videotijd.csv als enkele meetopname.',
  '3. Controleer venster 13,5-70 oorspronkelijke videoseconden en tijdsoort video.',
  '',
  'Herhalen vanuit de repository:',
  'node analysis/analyze_divergence.mjs',
  'python analysis/render_divergence.py',
  '',
  'Tracking-CSV, video, afgeleide metingen en deze rapportbestanden blijven lokaal.',
  'Geen gaten worden met een simulator ingevuld. Geometrie, perspectief en echte tijd zijn niet gekalibreerd.',
].join('\n') + '\n');

const escape = (text) => String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const format = (number, digits = 3) => Number.isFinite(number) ? number.toFixed(digits).replace('.', ',') : '—';
const usable = results.flatMap((result) => result.rows.filter((row) => row.valid !== false && Number.isFinite(row.value)));
const xMax = base.horizon;
let yMin = Math.min(0, ...usable.map((row) => row.value));
let yMax = Math.max(0.1, ...usable.map((row) => row.value));
const margin = Math.max(0.05, (yMax - yMin) * 0.12);
yMin -= margin; yMax += margin;
const box = { x: 105, y: 155, w: 760, h: 470 };
const X = (t) => box.x + t / xMax * box.w;
const Y = (v) => box.y + box.h - (v - yMin) / (yMax - yMin) * box.h;
const parts = [
  '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="980" viewBox="0 0 1200 980">',
  '<rect width="1200" height="980" fill="white"/>',
  '<style>text{font-family:Arial,sans-serif;fill:#172936}.small{font-size:14px}.tick{font-size:13px;fill:#52636d}.note{font-size:15px;fill:#43545f}</style>',
  '<text x="70" y="48" font-size="28" font-weight="bold">Faseruimte-divergentie uit één opname</text>',
  '<text x="70" y="80" class="note">Verkennende diagnose · tijd = videoseconden · fysieke tijdschaal onbekend</text>',
  `<text x="70" y="109" class="note">Analyse ${selection.start}–${selection.end} video-s; θ₁, θ₂ en τ·ω₁, τ·ω₂; τ = 1 video-s</text>`,
  `<rect x="${X(fitWindow.start)}" y="${box.y}" width="${X(fitWindow.end) - X(fitWindow.start)}" height="${box.h}" fill="#eef2f5"/>`,
];
for (let i = 0; i <= 5; i++) {
  const x = i / 5 * xMax; const y = yMin + i / 5 * (yMax - yMin);
  parts.push(`<path d="M ${X(x)} ${box.y} V ${box.y + box.h}" stroke="#e1e6e9"/><text x="${X(x)}" y="${box.y + box.h + 24}" class="tick" text-anchor="middle">${format(x, 1)}</text>`);
  parts.push(`<path d="M ${box.x} ${Y(y)} H ${box.x + box.w}" stroke="#e1e6e9"/><text x="${box.x - 15}" y="${Y(y) + 5}" class="tick" text-anchor="end">${format(y, 2)}</text>`);
}
parts.push(`<path d="M ${box.x} ${box.y} V ${box.y + box.h} H ${box.x + box.w}" stroke="#425965" fill="none"/>`);
parts.push(`<text x="${box.x + box.w / 2}" y="${box.y + box.h + 58}" font-size="17" text-anchor="middle">Tijd sinds gekozen nabije toestanden (videoseconden)</text>`);
parts.push(`<text transform="translate(33,${box.y + box.h / 2}) rotate(-90)" font-size="17" text-anchor="middle">Gemiddelde ln[δ(t) / δ(0)]</text>`);
results.forEach((result, index) => {
  const points = result.rows.filter((row) => row.valid !== false && Number.isFinite(row.value));
  if (points.length) parts.push(`<polyline points="${points.map((row) => `${X(row.t)},${Y(row.value)}`).join(' ')}" stroke="${result.color}" stroke-width="2.5" fill="none"/>`);
  const legendY = 174 + index * 86;
  parts.push(`<path d="M 893 ${legendY} H 919" stroke="${result.color}" stroke-width="3"/><text x="930" y="${legendY + 5}" class="small">${escape(result.label)}</text>`);
  parts.push(`<text x="930" y="${legendY + 26}" class="small">Paren: ${result.pairCount ?? 0}</text>`);
  parts.push(`<text x="930" y="${legendY + 47}" class="small">Helling: ${format(result.fit?.slope)} /video-s</text>`);
  if (index === 0 && result.fit && Number.isFinite(result.fit.slope)) {
    const at = (t) => result.fit.intercept + result.fit.slope * t;
    parts.push(`<path d="M ${X(fitWindow.start)} ${Y(at(fitWindow.start))} L ${X(fitWindow.end)} ${Y(at(fitWindow.end))}" stroke="#152f3c" stroke-width="2" stroke-dasharray="7 5"/>`);
  }
});
if (!usable.length) parts.push('<text x="480" y="365" font-size="21" text-anchor="middle">Onvoldoende geldige nabije trajectparen</text>');
parts.push(
  '<text x="70" y="742" font-size="18" font-weight="bold">Interpretatie en grenzen</text>',
  `<text x="70" y="774" class="note">Grijs: vooraf gekozen fitvenster ${fitWindow.start}–${fitWindow.end} video-s; streepjes: basisfit.</text>`,
  '<text x="70" y="802" class="note">Een positieve helling is hier geen bewezen Lyapunovexponent en geen bewijs van chaos.</text>',
  '<text x="70" y="830" class="note">De opname dooft uit; beeldhoeken en afgeleide snelheden bevatten trackingruis.</text>',
  '<text x="70" y="858" class="note">Afgekeurde frames blijven gaten. Alle paren hebben dezelfde volledige horizon van 0,5 video-s.</text>',
  '<text x="70" y="886" class="note">Paren en meetpunten zijn onderling afhankelijk. Er is geen onafhankelijke foutmarge berekend.</text>',
  '<text x="70" y="930" class="small">Instellingen, kwaliteitsdiagnostiek, bronhashes en alle scenarioresultaten: faseruimte-divergentie.json</text>',
  '</svg>',
);
await writeFile(join(directory, 'faseruimte-divergentie.svg'), parts.join('\n'));
console.log(JSON.stringify({
  outputDirectory: directory,
  baselineNoiseProxy: report.baselineNoiseProxy,
  results: results.map(({ id, status, preparedValidCount, pairCount, initialDistanceSummary, fit, fitError, error, warnings, diagnostics }) =>
    ({ id, status, preparedValidCount, pairCount, initialDistanceSummary, fit, fitError, error, warnings, diagnostics })),
}, null, 2));
