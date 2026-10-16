import test from 'node:test';
import assert from 'node:assert/strict';
import { phaseDistance, preparePhaseSeries, pairDivergence, fitDivergence, singleSeriesDivergence } from '../lyapunov.js';

const near = (a, b, tolerance = 1e-11) => assert.ok(Math.abs(a - b) <= tolerance, `${a} != ${b}`);
const state = (t, extra = {}) => ({ t, theta1: 0, theta2: 0, omega1: 0, omega2: 0, ...extra });
const wrap = x => Math.atan2(Math.sin(x), Math.cos(x));
const exponentialRuns = (lambda = 0.7) => Array.from({ length: 3 }, (_, q) =>
  Array.from({ length: 11 }, (_, k) => state(q * 3 + k / 10, {
    theta1: k / 5, theta2: -k / 10, omega1: (1 + q / 100) * Math.exp(lambda * k / 10),
  }))).flat();
const neighbourOptions = { theiler: 2, horizon: 0.3, maxPairs: 10, minPairs: 3, maxInitialDistance: 0.08, maxGap: 0.11 };

test('phase metric wraps both angles and weights angular velocity by tau', () => {
  const a = state(0, { theta1: Math.PI - 0.01, theta2: -Math.PI + 0.02, omega1: 2, omega2: -1 });
  const b = state(0, { theta1: -Math.PI + 0.01, theta2: Math.PI - 0.02, omega1: 1, omega2: 1 });
  near(phaseDistance(a, b, { tau: 0.5 }), Math.hypot(0.02, 0.04, 0.5, 1));
  near(phaseDistance(a, { ...a, theta1: a.theta1 + 8 * Math.PI, theta2: a.theta2 - 6 * Math.PI }), 0);
  assert.equal(phaseDistance(a, a), 0);
  assert.throws(() => phaseDistance(a, { ...b, omega1: null }));
  assert.throws(() => phaseDistance(a, b, { tau: 0 }));
  assert.throws(() => phaseDistance(a, b, { tau: NaN }));
});

test('local regression unwraps angles and applies time factor to derived velocities', () => {
  const rows = Array.from({ length: 11 }, (_, i) => ({ t: 2 + i / 10, theta1: wrap(3 + 0.4 * i), theta2: wrap(-3 - 0.2 * i) }));
  const original = structuredClone(rows);
  const prepared = preparePhaseSeries(rows, { timeFactor: 8, timeOffset: 2, smoothingWindow: 5, maxGap: 0.02 });
  assert.deepEqual(rows, original);
  assert.equal(prepared.diagnostics.validCount, 7);
  assert.equal(prepared.diagnostics.derivedVelocityCount, 7);
  assert.equal(prepared.rows[0].omega1, null);
  assert.equal(prepared.rows[10].valid, false);
  for (const row of prepared.rows.filter(r => r.valid)) {
    near(row.omega1, 32); near(row.omega2, -16);
  }
  near(prepared.rows[5].t, 0.0625);
  near(prepared.rows[5].theta1, 5);
});

test('provided velocities scale with time and retain edges without artificial regression', () => {
  const rows = [state(10, { omega1: 2, omega2: -3 }), state(10.1, { omega1: 2, omega2: -3 })];
  const result = preparePhaseSeries(rows, { timeFactor: 4, timeOffset: 10 });
  assert.equal(result.diagnostics.providedVelocityCount, 2);
  assert.equal(result.diagnostics.edgeInvalidCount, 0);
  near(result.rows[1].omega1, 8); near(result.rows[0].omega2, -12);
  near(result.rows[1].t, 0.025);
});

test('derivative windows never cross invalid points and erode both segment edges', () => {
  const rows = Array.from({ length: 11 }, (_, i) => ({ t: i / 10, theta1: i / 10, theta2: 2 * i / 10, valid: i !== 5 }));
  const prepared = preparePhaseSeries(rows, { smoothingWindow: 5, maxGap: 0.11 });
  assert.deepEqual(prepared.rows.filter(r => r.valid).map(r => r.t), [0.2, 0.8]);
  assert.equal(prepared.diagnostics.segments, 2);
  assert.equal(prepared.rows[5].theta1, null);
  near(prepared.rows[2].omega1, 1); near(prepared.rows[8].omega2, 2);
});

test('missing timestamps, frame jumps and explicit segments each prevent interpolation', () => {
  const rows = Array.from({ length: 15 }, (_, i) => ({ t: i / 10, theta1: i / 10, theta2: 0, frame: i })).filter(r => r.frame !== 7);
  const prepared = preparePhaseSeries(rows, { smoothingWindow: 3, maxGap: 1 });
  assert.equal(prepared.diagnostics.segments, 2);
  assert.equal(prepared.diagnostics.validCount, 10);
  const provided = [state(0, { frame: 0 }), state(0.1, { frame: 2 }), state(0.2, { frame: 3, segment: 1 }), state(0.3, { frame: 4, segment: 2 })];
  const result = preparePhaseSeries(provided, { maxGap: 0.2 });
  assert.equal(result.rows[0].segment, 0);
  assert.equal(result.rows[1].segment, 1);
  assert.notEqual(result.rows[2].segment, result.rows[3].segment);
});

test('preparation rejects malformed times and settings instead of inventing zero states', () => {
  for (const options of [{ timeFactor: 0 }, { maxGap: 0 }, { smoothingWindow: 4 }, { smoothingWindow: 1 }, { timeOffset: Infinity }]) {
    assert.throws(() => preparePhaseSeries([state(0)], options));
  }
  assert.throws(() => preparePhaseSeries([state(0), state(0)]));
  assert.throws(() => preparePhaseSeries([state(NaN)]));
  const rows = preparePhaseSeries([state(0, { theta1: null }), state(0.1, { omega2: Infinity })]).rows;
  assert.equal(rows[0].valid, false);
  assert.equal(rows[1].valid, false);
});

test('paired exponential phase separation recovers slope and free intercept in absolute time', () => {
  const lambda = 1.7;
  const a = Array.from({ length: 101 }, (_, i) => state(2 + i / 100));
  const b = a.map(r => ({ ...r, omega1: 0.01 * Math.exp(lambda * (r.t - 2)) }));
  const curve = pairDivergence(a, b);
  assert.equal(curve.t0, 2); near(curve.delta0, 0.01);
  assert.equal(curve.rows[0].value, 0);
  const fit = fitDivergence(curve, { start: 2.2, end: 2.8 });
  near(fit.slope, lambda); near(fit.intercept, -2 * lambda); near(fit.r2, 1);
  assert.equal(fit.count, 61);
});

test('pair alignment interpolates inside valid segments and preserves holes', () => {
  const a = [0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4].map(t => state(t));
  const b = [0, 0.1, 0.2, 0.3, 0.4].map(t => state(t, { omega1: 1 + t, valid: t !== 0.2 }));
  const curve = pairDivergence(a, b, { maxGap: 0.11 });
  near(curve.rows.find(r => r.t === 0.05).delta, 1.05);
  for (const t of [0.15, 0.2, 0.25]) assert.equal(curve.rows.find(r => r.t === t).value, null);
  assert.notEqual(curve.rows[0].segment, curve.rows.at(-1).segment);
  assert.throws(() => fitDivergence(curve, { start: 0, end: 0.4 }), /ontbrekend|meetgat/);
});

test('zero initial separation remains undefined instead of replacing its normalizer', () => {
  const a = [0, 0.1, 0.2].map(t => state(t));
  const b = a.map(r => ({ ...r, omega1: r.t }));
  const curve = pairDivergence(a, b, { maxGap: 0.11 });
  assert.equal(curve.delta0, 0);
  assert.equal(curve.t0, 0);
  assert.ok(curve.rows.every(r => r.value === null));
  assert.throws(() => fitDivergence(curve, { start: 0, end: 0.2 }));
});

test('later zero separation is a visible gap and negative log ratios remain negative', () => {
  const a = [0, 0.1, 0.2, 0.3].map(t => state(t));
  const b = a.map((r, i) => ({ ...r, omega1: [1, 0.5, 0, 0.25][i] }));
  const curve = pairDivergence(a, b, { maxGap: 0.11 });
  near(curve.rows[1].value, Math.log(0.5));
  assert.equal(curve.rows[2].value, null);
  near(curve.rows[3].value, Math.log(0.25));
  assert.throws(() => fitDivergence(curve, { start: 0, end: 0.3 }));
});

test('free-intercept OLS preserves negative slopes and handles constant curves honestly', () => {
  const rows = [0, 1, 2, 3, 4].map(t => ({ t, value: 3 - 0.4 * t, valid: true }));
  const fit = fitDivergence(rows, { start: 0, end: 4 });
  near(fit.slope, -0.4); near(fit.intercept, 3); near(fit.r2, 1);
  const flat = fitDivergence(rows.map(r => ({ ...r, value: 2 })), { start: 0, end: 4 });
  assert.equal(flat.slope, 0); assert.equal(flat.r2, null);
  assert.throws(() => fitDivergence(rows, { start: 0, end: 1 }), /drie/);
  assert.throws(() => fitDivergence(rows, { start: 0, end: 5 }), /buiten/);
  assert.throws(() => fitDivergence(rows, { start: -0.1, end: 4 }), /buiten/);
  assert.throws(() => fitDivergence(rows.map((r, i) => ({ ...r, segment: i < 2 ? 0 : 1 })), { start: 0, end: 4 }), /segmentgrens/);
});

test('fit boundary tolerance includes a nominal 0.1-second sample rounded in CSV', () => {
  const rows = Array.from({ length: 16 }, (_, i) => ({ t: i * 0.033333, value: 2 * i * 0.033333, valid: true }));
  const fit = fitDivergence(rows, { start: 0.1, end: 0.4 });
  assert.equal(fit.count, 10);
  near(fit.start, 0.099999); near(fit.end, 0.399996); near(fit.slope, 2);
  assert.equal(fit.requestedStart, 0.1);
  assert.ok(fit.boundaryTolerance < 1e-5);
});

test('single-record exponential recurrences yield known growth with a fixed deterministic cohort', () => {
  const input = exponentialRuns(), original = structuredClone(input);
  const curve = singleSeriesDivergence(input, neighbourOptions);
  assert.deepEqual(input, original);
  assert.deepEqual(curve, singleSeriesDivergence(input, neighbourOptions));
  assert.equal(curve.diagnostics.fixedCohort, true);
  assert.equal(curve.pairCount, 10);
  assert.ok(curve.rows.every(r => r.valid && r.pairCount === 10 && r.contributingPairs === 10));
  assert.equal(curve.rows[0].value, 0);
  for (const row of curve.rows) near(row.value, 0.7 * row.t);
  const fit = fitDivergence(curve, { start: 0, end: 0.3 });
  near(fit.slope, 0.7); near(fit.intercept, 0);
  for (const pair of curve.pairs) {
    assert.ok(Math.abs(pair.t2 - pair.t1) > neighbourOptions.theiler);
    assert.ok(pair.delta0 > 0 && pair.delta0 <= neighbourOptions.maxInitialDistance);
  }
  const unordered = new Set(curve.pairs.map(p => [p.i, p.j].sort((a, b) => a - b).join(':')));
  assert.equal(unordered.size, curve.pairCount);
});

test('single-record anchors must cover the entire horizon without crossing an invalid frame', () => {
  const input = exponentialRuns(); input[4].valid = false;
  const curve = singleSeriesDivergence(input, { ...neighbourOptions, maxPairs: 5 });
  for (const pair of curve.pairs) for (const t0 of [pair.t1, pair.t2]) {
    assert.ok(!(t0 < 0.4 && t0 + neighbourOptions.horizon >= 0.4 - 1e-10));
  }
  assert.equal(curve.diagnostics.segments, 4);
  assert.ok(curve.rows.every(r => r.valid));
});

test('one collapsing pair invalidates a whole lag rather than averaging a changing subset', () => {
  const input = Array.from({ length: 3 }, (_, q) => Array.from({ length: 6 }, (_, k) => state(q * 2 + k / 10, {
    theta1: k / 10, omega1: q === 0 ? 0 : q === 1 ? 0.05 - k / 100 : 0.15,
  }))).flat();
  const curve = singleSeriesDivergence(input, { theiler: 1, horizon: 0.5, minPairs: 2, maxPairs: 2, maxGap: 0.11, maxInitialDistance: 0.2 });
  assert.equal(curve.pairCount, 2);
  assert.ok(curve.rows.slice(0, -1).every(r => r.valid && r.contributingPairs === 2));
  assert.equal(curve.rows.at(-1).value, null);
  assert.equal(curve.rows.at(-1).contributingPairs, 0);
  assert.equal(curve.rows.at(-1).pairCount, 2);
  assert.equal(curve.diagnostics.zeroLagCount, 1);
  assert.throws(() => fitDivergence(curve, { start: 0, end: 0.5 }));
});

test('time rescaling preserves neighbours and metric only when tau rescales too', () => {
  const input = exponentialRuns();
  const reference = singleSeriesDivergence(input, neighbourOptions);
  const factor = 8;
  const physical = preparePhaseSeries(input, { timeFactor: factor, maxGap: 0.11 / factor });
  const result = singleSeriesDivergence(physical, { ...neighbourOptions, tau: 1 / factor,
    theiler: neighbourOptions.theiler / factor, horizon: neighbourOptions.horizon / factor, maxGap: 0.11 / factor });
  assert.deepEqual(result.pairs.map(p => [p.i, p.j]), reference.pairs.map(p => [p.i, p.j]));
  for (let i = 0; i < result.rows.length; i++) {
    near(result.rows[i].value, reference.rows[i].value); near(result.rows[i].t, reference.rows[i].t / factor);
  }
  near(fitDivergence(result, { start: 0, end: 0.3 / factor }).slope, 0.7 * factor);
});

test('rounded cadence does not generate a near-duplicate lag at the exact horizon', () => {
  const input = Array.from({ length: 2 }, (_, q) => Array.from({ length: 31 }, (_, k) => state(q * 3 + Number((k / 30).toFixed(6)), {
    theta1: k / 100, omega1: q / 100,
  }))).flat();
  const curve = singleSeriesDivergence(input, { theiler: 2, horizon: 0.5, minPairs: 2, maxPairs: 3, maxGap: 0.04 });
  assert.equal(curve.rows.length, 16);
  assert.equal(curve.rows.at(-1).t, 0.5);
  assert.ok(curve.rows.at(-1).t - curve.rows.at(-2).t > 0.03);
});

test('neighbour analysis enforces distance band, positive distance and temporal exclusion', () => {
  const input = exponentialRuns();
  const curve = singleSeriesDivergence(input, { ...neighbourOptions, minInitialDistance: 0.015, minPairs: 2, maxPairs: 4 });
  assert.ok(curve.pairs.every(p => p.delta0 >= 0.015));
  assert.throws(() => singleSeriesDivergence(input, { ...neighbourOptions, maxInitialDistance: 0.001 }), /nabuurparen/);
  assert.throws(() => singleSeriesDivergence(input, { ...neighbourOptions, theiler: 99 }), /nabuurparen/);
  assert.throws(() => singleSeriesDivergence([state(0), state(0.1), state(0.2)], { horizon: 0.1, theiler: 0, minPairs: 1 }), /nabuurparen/);
});

test('neighbour analysis rejects invalid settings and bounds CPU work before large inputs', () => {
  for (const options of [{ horizon: 0 }, { theiler: -1 }, { minInitialDistance: -1 }, { minInitialDistance: 0.3 }, { minPairs: 20, maxPairs: 10 }, { maxPairs: 2.5 }]) {
    assert.throws(() => singleSeriesDivergence(exponentialRuns(), { ...neighbourOptions, ...options }));
  }
  assert.throws(() => singleSeriesDivergence(Array.from({ length: 10001 }, (_, i) => state(i / 100))), /10000/);
});
