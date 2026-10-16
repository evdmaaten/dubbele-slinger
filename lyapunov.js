/**
 * Finite-window phase-space divergence, not an automatic chaos diagnosis.
 * Single-record method follows temporally separated neighbours as in Rosenstein,
 * Collins & De Luca (1993), using directly observed 4D states, not delay embedding.
 * https://delucafoundation.org/download/bibliography/cjd/056.pdf
 * Keep the SAME pair cohort at every lag. Normalizing each pair by d(0) then
 * changes only the intercept of the average log-distance, not its slope.
 */
const KEYS = ['theta1', 'theta2', 'omega1', 'omega2'];
const TWO_PI = 2 * Math.PI;
const EPS = 1e-10;
const finite = (v, label) => {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`${label} moet een eindig getal zijn.`);
  return v;
};
const positive = (v, label) => {
  if (!(finite(v, label) > 0)) throw new Error(`${label} moet groter zijn dan nul.`);
  return v;
};
const median = values => {
  if (!values.length) return null;
  const a = [...values].sort((x, y) => x - y), mid = a.length >> 1;
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
};
const mean = a => a.reduce((sum, v) => sum + v / a.length, 0);
const wrapped = d => Math.atan2(Math.sin(d), Math.cos(d));
const angleDifference = (a, b) => wrapped(a % TWO_PI - b % TWO_PI);
const rowsOf = (input, label) => {
  const rows = Array.isArray(input) ? input : input?.rows;
  if (!Array.isArray(rows)) throw new Error(`${label} moet een array of een object met rows zijn.`);
  return rows;
};
const usable = row => row.valid !== false && row.valid !== 0 && KEYS.every(k => typeof row[k] === 'number' && Number.isFinite(row[k]));

/** Angles in radians; tau has the time unit of omega's denominator. */
export function phaseDistance(a, b, { tau = 1 } = {}) {
  positive(tau, 'tau');
  if (!a || !b) throw new Error('Twee fasetoestanden zijn nodig.');
  KEYS.forEach(k => { finite(a[k], k); finite(b[k], k); });
  const result = Math.hypot(angleDifference(a.theta1, b.theta1), angleDifference(a.theta2, b.theta2),
    tau * (a.omega1 - b.omega1), tau * (a.omega2 - b.omega2));
  return finite(result, 'Faseafstand');
}

function validateTimes(rows) {
  rows.forEach((r, i) => {
    if (!r || typeof r !== 'object') throw new Error('Ongeldige tijdreeksregel.');
    finite(r.t, 'Tijd');
    if (i && r.t <= rows[i - 1].t) throw new Error('Tijden moeten strikt toenemen.');
  });
}

function gapInfo(rows, maxGap) {
  positive(maxGap, 'maxGap');
  const intervals = rows.slice(1).map((r, i) => r.t - rows[i].t);
  const medianDt = median(intervals);
  // A missing frame can be shorter than maxGap. Infer a conservative cadence
  // gate as well; explicit invalid rows and segment/frame breaks always win.
  return { medianDt, effectiveMaxGap: medianDt ? Math.min(maxGap, medianDt * 1.5) : maxGap };
}

function breakBetween(a, b, gap) {
  return b.t - a.t > gap + EPS || b.breakBefore === true
    || (Number.isInteger(a.frame) && Number.isInteger(b.frame) && b.frame !== a.frame + 1)
    || (a.segment !== undefined && b.segment !== undefined && a.segment !== b.segment);
}

function normalizeSeries(input, maxGap) {
  const raw = rowsOf(input, 'Fasereeks'); validateTimes(raw);
  const info = gapInfo(raw, maxGap);
  let segment = -1, previous = null, previousRaw = null;
  const rows = raw.map(r => {
    if (!usable(r)) { previous = null; previousRaw = null; return { ...r, valid: false, segment: null }; }
    const disconnected = !previous || breakBetween(previousRaw, r, info.effectiveMaxGap);
    if (disconnected) segment++;
    const row = { ...r, valid: true, segment,
      theta1: disconnected ? r.theta1 : previous.theta1 + angleDifference(r.theta1, previousRaw.theta1),
      theta2: disconnected ? r.theta2 : previous.theta2 + angleDifference(r.theta2, previousRaw.theta2) };
    previous = row; previousRaw = r;
    return row;
  });
  return { rows, ...info, segmentCount: segment + 1 };
}

/**
 * Unwrap within contiguous angle segments. Estimate missing velocities with a
 * centred full odd-window linear regression; segment edges remain invalid.
 * Supplied velocities are derivatives with respect to INPUT time and therefore
 * multiply by timeFactor. Angles themselves are not smoothed or interpolated.
 */
export function preparePhaseSeries(input, { timeFactor = 1, timeOffset = 0, smoothingWindow = 5, maxGap = 0.1 } = {}) {
  positive(timeFactor, 'timeFactor'); finite(timeOffset, 'timeOffset'); positive(maxGap, 'maxGap');
  if (!Number.isInteger(smoothingWindow) || smoothingWindow < 3 || smoothingWindow > 101 || smoothingWindow % 2 !== 1) {
    throw new Error('smoothingWindow moet een oneven geheel getal van 3 t/m 101 zijn.');
  }
  const raw = rowsOf(input, 'Hoekreeks'); validateTimes(raw);
  const timed = raw.map(r => ({ ...r, t: finite((r.t - timeOffset) / timeFactor, 'Omgerekende tijd') }));
  const info = gapInfo(timed, maxGap);
  let sourceSegment = -1, previous = null, previousRaw = null;
  const unwrapped = timed.map(r => {
    const angleValid = r.valid !== false && r.valid !== 0
      && ['theta1', 'theta2'].every(k => typeof r[k] === 'number' && Number.isFinite(r[k]));
    if (!angleValid) { previous = null; previousRaw = null; return { ...r, valid: false, sourceSegment: null }; }
    const disconnected = !previous || breakBetween(previousRaw, r, info.effectiveMaxGap);
    if (disconnected) sourceSegment++;
    const row = { ...r, valid: true, sourceSegment,
      theta1: disconnected ? r.theta1 : previous.theta1 + angleDifference(r.theta1, previousRaw.theta1),
      theta2: disconnected ? r.theta2 : previous.theta2 + angleDifference(r.theta2, previousRaw.theta2) };
    previous = row; previousRaw = r; return row;
  });
  let derivedVelocityCount = 0, providedVelocityCount = 0, edgeInvalidCount = 0;
  const half = (smoothingWindow - 1) / 2;
  const phaseRows = unwrapped.map((r, i) => {
    const base = { t: r.t, theta1: r.valid ? r.theta1 : null, theta2: r.valid ? r.theta2 : null,
      omega1: null, omega2: null, valid: false, segment: r.sourceSegment };
    if (Number.isInteger(r.frame)) base.frame = r.frame;
    if (!r.valid) return base;
    let derived = false;
    for (const [angle, velocity] of [['theta1', 'omega1'], ['theta2', 'omega2']]) {
      if (r[velocity] !== undefined && r[velocity] !== null) {
        if (typeof r[velocity] === 'number' && Number.isFinite(r[velocity])) base[velocity] = finite(r[velocity] * timeFactor, velocity);
        continue;
      }
      if (i < half || i + half >= unwrapped.length) continue;
      const window = unwrapped.slice(i - half, i + half + 1);
      if (!window.every(s => s.valid && s.sourceSegment === r.sourceSegment)) continue;
      const centre = mean(window.map(s => s.t - r.t)), angleMean = mean(window.map(s => s[angle]));
      let xx = 0, xy = 0;
      for (const s of window) { const dt = s.t - r.t - centre; xx += dt * dt; xy += dt * (s[angle] - angleMean); }
      if (xx > 0) { base[velocity] = finite(xy / xx, 'Afgeleide hoeksnelheid'); derived = true; }
    }
    base.valid = usable({ ...base, valid: true });
    if (base.valid) { if (derived) derivedVelocityCount++; else providedVelocityCount++; }
    else edgeInvalidCount++;
    return base;
  });
  const normalized = normalizeSeries(phaseRows, maxGap);
  const validCount = normalized.rows.filter(r => r.valid).length;
  return { rows: normalized.rows, diagnostics: { inputCount: raw.length, validCount, invalidCount: raw.length - validCount,
    segments: normalized.segmentCount, derivedVelocityCount, providedVelocityCount, edgeInvalidCount,
    smoothingWindow, timeFactor, timeOffset, maxGap, ...info },
    warnings: ['Afgeleide hoeksnelheden zijn gevoelig voor meetruis en vensterkeuze; gaten worden niet overbrugd.',
      'tau en Theiler-/fit-/horizontijden moeten dezelfde gekozen tijdseenheid gebruiken.'] };
}

function stateAt(series, t) {
  const rows = series.rows;
  if (!rows.length || t < rows[0].t - EPS || t > rows.at(-1).t + EPS) return null;
  let lo = 0, hi = rows.length - 1;
  while (hi - lo > 1) { const mid = (hi + lo) >> 1; if (rows[mid].t <= t) lo = mid; else hi = mid; }
  for (const index of new Set([lo, hi])) {
    if (Math.abs(rows[index].t - t) <= EPS) return rows[index].valid ? { ...rows[index], interpolated: false } : null;
  }
  const a = rows[lo], b = rows[hi];
  if (!a.valid || !b.valid || a.segment !== b.segment || b.t - a.t > series.effectiveMaxGap + EPS) return null;
  const f = (t - a.t) / (b.t - a.t);
  if (!(f >= 0 && f <= 1)) return null;
  const result = { t, valid: true, segment: a.segment, interpolated: true };
  KEYS.forEach(k => { result[k] = a[k] + f * (b[k] - a[k]); });
  return result;
}

/** Align on the union of timestamps, preserving holes in either trajectory. */
export function pairDivergence(a, b, { tau = 1, maxGap = 0.1 } = {}) {
  positive(tau, 'tau'); positive(maxGap, 'maxGap');
  const A = normalizeSeries(a, maxGap), B = normalizeSeries(b, maxGap);
  const result = { rows: [], t0: null, delta0: null, diagnostics: { validCount: 0, zeroDistanceCount: 0, interpolatedCount: 0, tau, maxGap }, warnings: [] };
  if (!A.rows.length || !B.rows.length) return result;
  const start = Math.max(A.rows[0].t, B.rows[0].t), end = Math.min(A.rows.at(-1).t, B.rows.at(-1).t);
  if (start > end) return result;
  const times = [...new Set([...A.rows, ...B.rows].map(r => r.t).filter(t => t >= start && t <= end))].sort((x, y) => x - y);
  let segment = -1, lastKey = null;
  for (const t of times) {
    const sa = stateAt(A, t), sb = stateAt(B, t);
    if (!sa || !sb) { result.rows.push({ t, delta: null, value: null, valid: false, segment: null }); lastKey = null; continue; }
    const delta = phaseDistance(sa, sb, { tau });
    if (result.t0 === null) { result.t0 = t; result.delta0 = delta; }
    if (delta === 0) result.diagnostics.zeroDistanceCount++;
    if (sa.interpolated || sb.interpolated) result.diagnostics.interpolatedCount++;
    const value = delta > 0 && result.delta0 > 0 ? Math.log(delta) - Math.log(result.delta0) : null;
    const key = `${sa.segment}:${sb.segment}`;
    if (value !== null && key !== lastKey) segment++;
    result.rows.push({ t, delta, value, valid: value !== null, segment: value !== null ? segment : null });
    lastKey = value !== null ? key : null;
    if (value !== null) result.diagnostics.validCount++;
  }
  if (result.delta0 === 0) result.warnings.push('De eerste gemeenschappelijke faseafstand is nul; ln(delta/delta0) is niet gedefinieerd. Er wordt geen epsilon toegevoegd.');
  result.warnings.push('Een helling van twee trajecten in een eindig venster is niet automatisch de maximale Lyapunov-exponent.');
  return result;
}

/** Ordinary least squares with a FREE intercept; no positivity constraint. */
export function fitDivergence(input, { start, end } = {}) {
  finite(start, 'Fitbegin'); finite(end, 'Fiteinde');
  if (!(end > start)) throw new Error('Het fiteinde moet na het fitbegin liggen.');
  const all = rowsOf(input, 'Divergentie'); validateTimes(all);
  // CSV timestamps may be rounded to microseconds. A tiny cadence-relative
  // tolerance includes nominal boundary samples without changing the window.
  const cadence = median(all.slice(1).map((r, i) => r.t - all[i].t));
  const boundaryTolerance = Math.max(EPS, (cadence || 0) * 1e-4);
  if (all.length && (start < all[0].t - boundaryTolerance || end > all.at(-1).t + boundaryTolerance)) {
    throw new Error('Het fitvenster valt buiten de beschikbare divergentiecurve.');
  }
  const rows = all.filter(r => r.t >= start - boundaryTolerance && r.t <= end + boundaryTolerance);
  if (rows.length < 3) throw new Error('Een fit vereist minimaal drie geldige punten.');
  if (rows.some(r => r.valid === false || typeof r.value !== 'number' || !Number.isFinite(r.value))) {
    throw new Error('Het fitvenster bevat een ontbrekend, nulafstand- of ongeldig punt; kies één ononderbroken venster.');
  }
  if (rows.some((r, i) => i > 0 && (r.breakBefore || (r.segment !== undefined && rows[i - 1].segment !== undefined && r.segment !== rows[i - 1].segment)))) {
    throw new Error('Het fitvenster kruist een meetgat of segmentgrens.');
  }
  const x0 = rows[0].t, mx = mean(rows.map(r => r.t - x0)), my = mean(rows.map(r => r.value));
  let xx = 0, xy = 0, yy = 0;
  for (const r of rows) { const dx = r.t - x0 - mx, dy = r.value - my; xx += dx * dx; xy += dx * dy; yy += dy * dy; }
  if (!(xx > 0)) throw new Error('Geen bruikbaar tijdsbereik voor de fit.');
  const slope = finite(xy / xx, 'Fithelling'), intercept = finite(my - slope * (x0 + mx), 'Fitintercept');
  const residual = rows.reduce((sum, r) => sum + (r.value - (my + slope * (r.t - x0 - mx))) ** 2, 0);
  const r2 = yy > 0 ? Math.max(0, Math.min(1, 1 - residual / yy)) : null;
  const warnings = ['Vensterafhankelijk resultaat; een positieve helling alleen bewijst geen chaos of asymptotische Lyapunov-exponent.'];
  if (r2 === null) warnings.push('R² is niet gedefinieerd voor een constante log-afstand.');
  if (rows.length < 10) warnings.push('Minder dan tien punten in het fitvenster.');
  return { slope, intercept, r2, count: rows.length, start: rows[0].t, end: rows.at(-1).t,
    requestedStart: start, requestedEnd: end, boundaryTolerance, warnings };
}

/**
 * Nearest resolvable neighbours outside a temporal Theiler window. Initial
 * distances alone select partners; future growth never selects or replaces them.
 * Every member must have uninterrupted coverage of the FULL horizon. Lags use
 * median sample spacing, with interpolation only inside a valid segment.
 */
export function singleSeriesDivergence(input, { tau = 1, theiler = 1, horizon = 2, maxPairs = 250, minPairs = 10,
  maxInitialDistance = 0.2, minInitialDistance = 0, maxGap = 0.1 } = {}) {
  positive(tau, 'tau'); positive(horizon, 'horizon'); positive(maxGap, 'maxGap');
  if (finite(theiler, 'theiler') < 0 || finite(minInitialDistance, 'minInitialDistance') < 0) throw new Error('Theiler-venster en minimale beginafstand mogen niet negatief zijn.');
  if (maxInitialDistance !== Infinity) positive(maxInitialDistance, 'maxInitialDistance');
  if (!(maxInitialDistance > minInitialDistance)) throw new Error('Maximale beginafstand moet groter zijn dan de minimale.');
  if (!Number.isInteger(maxPairs) || maxPairs < 1 || maxPairs > 5000 || !Number.isInteger(minPairs) || minPairs < 1 || minPairs > maxPairs) {
    throw new Error('Kies 1 ≤ minPairs ≤ maxPairs ≤ 5000, als gehele getallen.');
  }
  if (rowsOf(input, 'Fasereeks').length > 10000) throw new Error('Maximaal 10000 tijdpunten per nabuur-analyse; verklein het analysevenster.');
  const series = normalizeSeries(input, maxGap), rows = series.rows;
  const dt = series.medianDt;
  if (!(dt > 0)) throw new Error('Te weinig tijdpunten voor nabuurdivergentie.');
  const segmentEnds = new Map();
  rows.forEach(r => { if (r.valid) segmentEnds.set(r.segment, r.t); });
  const eligible = [];
  rows.forEach((r, i) => { if (r.valid && r.t + horizon <= segmentEnds.get(r.segment) + EPS) eligible.push(i); });
  const target = Math.min(maxPairs, eligible.length), order = [];
  for (let k = 0; k < target; k++) order.push(eligible[target > 1 ? Math.round(k * (eligible.length - 1) / (target - 1)) : 0]);
  const primaryAnchors = new Set(order);
  order.push(...eligible.filter(i => !primaryAnchors.has(i)));
  const pairs = [], used = new Set();
  let distanceEvaluations = 0;
  for (const i of order) {
    if (pairs.length >= maxPairs) break;
    let best = null, bestDistance = Infinity;
    for (const j of eligible) {
      if (j === i || Math.abs(rows[i].t - rows[j].t) <= theiler + EPS) continue;
      if (++distanceEvaluations > 5_000_000) throw new Error('Te veel nabuurvergelijkingen; verklein het analysevenster of verlaag maxPairs.');
      const d = phaseDistance(rows[i], rows[j], { tau });
      if (!(d > 0 && d >= minInitialDistance && d <= maxInitialDistance)) continue;
      if (d < bestDistance) { best = j; bestDistance = d; }
    }
    if (best === null) continue;
    const key = `${Math.min(i, best)}:${Math.max(i, best)}`;
    if (used.has(key)) continue;
    used.add(key);
    pairs.push({ i, j: best, t1: rows[i].t, t2: rows[best].t, delta0: bestDistance });
  }
  if (pairs.length < minPairs) throw new Error(`Slechts ${pairs.length} geldige nabuurparen; minimaal ${minPairs} nodig voor de volledige horizon zonder gaten.`);
  const steps = Math.floor(horizon / dt + EPS);
  if (steps > 10000 || (steps + 2) * pairs.length > 5_000_000) throw new Error('Te veel lagpunten; verkort de horizon of verminder maxPairs.');
  const lags = Array.from({ length: steps + 1 }, (_, k) => k * dt);
  const lagBoundaryTolerance = Math.max(EPS, dt * 1e-3);
  if (lags.length === 1 || horizon - lags.at(-1) > lagBoundaryTolerance) lags.push(horizon); else lags[lags.length - 1] = horizon;
  const d0 = pairs.map(p => p.delta0), logInitial = mean(d0.map(Math.log));
  let zeroLagCount = 0, interpolatedStateCount = 0, invalidLagCount = 0;
  const curve = lags.map(t => {
    const logs = [], ratios = [];
    let failed = false, zero = false;
    for (const pair of pairs) {
      const a = stateAt(series, pair.t1 + t), b = stateAt(series, pair.t2 + t);
      if (!a || !b) { failed = true; continue; }
      if (a.interpolated) interpolatedStateCount++;
      if (b.interpolated) interpolatedStateCount++;
      const distance = phaseDistance(a, b, { tau });
      if (distance === 0) { failed = true; zero = true; continue; }
      logs.push(Math.log(distance)); ratios.push(Math.log(distance) - Math.log(pair.delta0));
    }
    if (failed) { invalidLagCount++; if (zero) zeroLagCount++; }
    // NEVER average a changing subset: a single zero/missing pair nulls this lag.
    return { t, delta: failed ? (zero ? 0 : null) : Math.exp(mean(logs)), value: failed ? null : mean(ratios),
      valid: !failed, segment: failed ? null : 0, pairCount: pairs.length, contributingPairs: failed ? 0 : pairs.length };
  });
  return { rows: curve, pairs, pairCount: pairs.length, diagnostics: { tau, theiler, horizon, maxPairs, minPairs,
    minInitialDistance, maxInitialDistance, maxGap, sampleInterval: dt, lagBoundaryTolerance, effectiveMaxGap: series.effectiveMaxGap,
    eligibleAnchorCount: eligible.length, segments: series.segmentCount, fixedCohort: true, distanceEvaluations,
    initialDistance: { min: Math.min(...d0), median: median(d0), max: Math.max(...d0), geometricMean: Math.exp(logInitial) },
    interpolatedStateCount, zeroLagCount, invalidLagCount,
    neighbourRule: 'Nearest positive-distance eligible neighbour within the configured distance band; unordered duplicates removed; deterministic spread of anchors.' },
    warnings: ['Vaste cohorte van directe 4D-toestanden; geen automatische uitspraak over chaos of een asymptotische exponent.',
      'Meetruis, afgeleidenvenster, Theiler-uitsluiting, afstandsband en gekozen fitvenster beïnvloeden de uitkomst.',
      'Interpolatie gebeurt uitsluitend binnen ononderbroken segmenten; geïnterpoleerde punten zijn geen nieuwe onafhankelijke metingen.'] };
}
