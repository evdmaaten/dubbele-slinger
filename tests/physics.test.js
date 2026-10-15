import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, derivative, energy, tensions, simulate, validateParams, compareConvergence } from '../physics.js';

const rad = Math.PI / 180;
const near = (actual, expected, tolerance = 1e-10) => assert.ok(
  Math.abs(actual - expected) <= tolerance,
  `${actual} differs from ${expected} by ${Math.abs(actual - expected)} > ${tolerance}`,
);

test('resting weights have exact static tension and remain motionless', () => {
  const p = { ...DEFAULTS, m1: 0.3, m2: 0.7, theta1: 0, theta2: 0, duration: 3 };
  const r = simulate(p);
  assert.equal(r.status, 'complete');
  assert.equal(r.samples.length, 301);
  for (const s of r.samples) {
    near(s.theta1, 0); near(s.theta2, 0);
    near(s.tension1, (p.m1 + p.m2) * p.g);
    near(s.tension2, p.m2 * p.g);
    near(s.energy, 0);
  }
});

test('mass-matrix accelerations agree with independent published closed-form equations', () => {
  // Independent Newtonian formulas from Erik Neumann/myPhysicsLab. No damping.
  for (let k = 0; k < 80; k++) {
    const p = { ...DEFAULTS, m1: 0.1 + k / 31, m2: 0.13 + k / 51, s1: 0.12 + k / 45, s2: 0.17 + k / 35 };
    const a = Math.sin(k * 1.1) * 2.8, b = Math.cos(k * 0.9) * 2.2;
    const u = Math.cos(k) * 4.7, v = Math.sin(k * 0.7) * 7.1;
    const delta = a - b;
    const denominator = 2 * p.m1 + p.m2 - p.m2 * Math.cos(2 * delta);
    const alpha1 = (-p.g * (2 * p.m1 + p.m2) * Math.sin(a)
      - p.m2 * p.g * Math.sin(a - 2 * b)
      - 2 * Math.sin(delta) * p.m2 * (v * v * p.s2 + u * u * p.s1 * Math.cos(delta))) / (p.s1 * denominator);
    const alpha2 = 2 * Math.sin(delta) * (u * u * p.s1 * (p.m1 + p.m2)
      + p.g * (p.m1 + p.m2) * Math.cos(a) + v * v * p.s2 * p.m2 * Math.cos(delta)) / (p.s2 * denominator);
    const d = derivative([a, b, u, v, 0], p);
    near(d[2], alpha1, 1e-10);
    near(d[3], alpha2, 1e-10);
  }
});

test('tensions satisfy both Cartesian Newton laws including the defined damping forces', () => {
  for (const c of [0, 0.013]) {
    const p = { ...DEFAULTS, s1: 0.63, s2: 0.27, m1: 0.19, m2: 0.41, c1: c, c2: 2 * c };
    const state = [0.67, -0.28, 1.33, -0.83, 0];
    const [a, b, u, v] = state;
    const [, , alpha1, alpha2] = derivative(state, p);
    const { tension1: T1, tension2: T2 } = tensions(state, p);
    const q1 = -p.c1 * u + p.c2 * (v - u), q2 = -p.c2 * (v - u);
    const ax1 = p.s1 * (alpha1 * Math.cos(a) - u * u * Math.sin(a));
    const ay1 = p.s1 * (alpha1 * Math.sin(a) + u * u * Math.cos(a));
    const ax2 = ax1 + p.s2 * (alpha2 * Math.cos(b) - v * v * Math.sin(b));
    const ay2 = ay1 + p.s2 * (alpha2 * Math.sin(b) + v * v * Math.cos(b));
    near(p.m1 * ax1, -T1 * Math.sin(a) + T2 * Math.sin(b) + q1 / p.s1 * Math.cos(a) - q2 / p.s2 * Math.cos(b));
    near(p.m1 * ay1, T1 * Math.cos(a) - T2 * Math.cos(b) - p.m1 * p.g + q1 / p.s1 * Math.sin(a) - q2 / p.s2 * Math.sin(b));
    near(p.m2 * ax2, -T2 * Math.sin(b) + q2 / p.s2 * Math.cos(b));
    near(p.m2 * ay2, T2 * Math.cos(b) - p.m2 * p.g + q2 / p.s2 * Math.sin(b));
  }
});

test('20-second undamped run conserves energy and both geometric lengths', () => {
  const r = simulate({ theta1: 60, theta2: 25 });
  assert.equal(r.status, 'complete');
  assert.ok(r.diagnostics.relativeEnergyError < 1e-9);
  assert.ok(r.diagnostics.maxStep <= r.params.dt / 2 + 1e-14);
  for (const s of r.samples) {
    near(Math.hypot(s.x1, s.y1), r.params.s1, 1e-14);
    near(Math.hypot(s.x2 - s.x1, s.y2 - s.y1), r.params.s2, 1e-14);
    near(s.dissipated, 0);
    assert.ok(s.tension1 >= 0 && s.tension2 >= 0);
  }
  near(r.samples.at(-1).t, 20, 1e-10);
});

test('damping decreases mechanical energy while E plus dissipated energy is conserved', () => {
  const r = simulate({ c1: 0.005, c2: 0.009, duration: 10 });
  assert.equal(r.status, 'complete');
  assert.ok(r.diagnostics.relativeEnergyError < 1e-9);
  assert.ok(r.diagnostics.finalEnergy < r.diagnostics.initialEnergy / 2);
  assert.ok(r.diagnostics.dissipatedEnergy > 0);
  for (let i = 1; i < r.samples.length; i++) {
    assert.ok(r.samples[i].energy <= r.samples[i - 1].energy + 1e-10);
    assert.ok(r.samples[i].dissipated >= r.samples[i - 1].dissipated);
  }
});

test('instantaneous energy identity equals negative Rayleigh dissipation', () => {
  const p = { ...DEFAULTS, c1: 0.012, c2: 0.007 };
  const state = [0.5, -0.2, 0.8, -1.1, 0];
  const d = derivative(state, p);
  const epsilon = 1e-6;
  const plus = state.map((x, i) => x + epsilon * d[i]);
  const minus = state.map((x, i) => x - epsilon * d[i]);
  near((energy(plus, p) - energy(minus, p)) / (2 * epsilon), -d[4], 1e-9);
});

test('small-angle equal-mass normal modes have analytical frequencies', () => {
  // For equal masses and lengths: omega² = (g/l)(2 ± sqrt(2)).
  for (const sign of [-1, 1]) {
    const theta1 = 0.005, theta2 = -sign * Math.SQRT2 * theta1;
    const frequency = Math.sqrt(DEFAULTS.g / DEFAULTS.s1 * (2 + sign * Math.SQRT2));
    const period = 2 * Math.PI / frequency;
    const r = simulate({ theta1, theta2, duration: period });
    assert.equal(r.status, 'complete');
    near(r.samples.at(-1).theta1, theta1 * rad, 1e-10);
    near(r.samples.at(-1).theta2, theta2 * rad, 1e-10);
    const quarter = r.samples.reduce((a, b) => Math.abs(a.t - period / 4) < Math.abs(b.t - period / 4) ? a : b);
    assert.ok(Math.abs(quarter.theta1) < theta1 * rad * 0.06);
  }
});

test('impossible release above the pivot stops at t=0 without a rod trajectory', () => {
  const r = simulate({ theta1: 120, theta2: -10 });
  assert.equal(r.status, 'slack');
  assert.equal(r.event.t, 0);
  assert.equal(r.event.string, 1);
  assert.equal(r.event.initial, true);
  assert.ok(r.event.tension < 0);
  assert.equal(r.samples.length, 1);
  assert.equal(r.diagnostics.steps, 0);
});

test('first interior slack event is refined, preserved and terminates output', () => {
  const r = simulate({ theta1: 80, theta2: 20, duration: 4 });
  assert.equal(r.status, 'slack');
  assert.equal(r.event.string, 2);
  assert.ok(r.event.t > 0.9 && r.event.t < 1);
  near(r.event.tension, 0, 1e-8);
  near(r.samples.at(-1).t, r.event.t);
  for (const s of r.samples.slice(0, -1)) assert.ok(s.tension1 >= 0 && s.tension2 >= 0);
  const finer = simulate({ theta1: 80, theta2: 20, duration: 4, dt: 0.0005 });
  near(finer.event.t, r.event.t, 1e-8);
});

test('mirror initial conditions produce mirror motion and identical tensions', () => {
  const a = simulate({ theta1: 37, theta2: -22, omega1: 10, omega2: -5, duration: 2 });
  const b = simulate({ theta1: -37, theta2: 22, omega1: -10, omega2: 5, duration: 2 });
  assert.equal(a.status, b.status);
  assert.equal(a.samples.length, b.samples.length);
  a.samples.forEach((s, i) => {
    const q = b.samples[i];
    near(s.x1, -q.x1); near(s.x2, -q.x2); near(s.y2, q.y2);
    near(s.tension1, q.tension1); near(s.tension2, q.tension2);
  });
});

test('global mass scaling leaves undamped motion unchanged and scales tension and energy', () => {
  const a = simulate({ duration: 2 });
  const b = simulate({ m1: DEFAULTS.m1 * 3, m2: DEFAULTS.m2 * 3, duration: 2 });
  a.samples.forEach((s, i) => {
    near(s.theta1, b.samples[i].theta1, 1e-10);
    near(s.theta2, b.samples[i].theta2, 1e-10);
    near(s.energy * 3, b.samples[i].energy, 1e-10);
    near(s.tension2 * 3, b.samples[i].tension2, 1e-9);
  });
});

test('halving the RK4 step improves a nonlinear solution at approximately fourth order', () => {
  const p = { theta1: 60, theta2: 25, duration: 4 };
  const coarse = compareConvergence({ ...p, dt: 0.01 });
  const finer = compareConvergence({ ...p, dt: 0.005 });
  assert.equal(coarse.coarseStatus, 'complete');
  assert.equal(coarse.fineStatus, 'complete');
  assert.equal(coarse.comparedSamples, 401);
  assert.ok(coarse.maxPositionDifference < 1e-6);
  assert.ok(coarse.maxPositionDifference / finer.maxPositionDifference > 10);
  near(coarse.commonDuration, 4, 1e-10);
});

test('convergence genuinely halves internal steps when a stability limit dominates dt', () => {
  const r = compareConvergence({ s1: 0.05, s2: 0.05, m1: 0.01, m2: 0.01,
    c1: 0.05, c2: 0.05, theta1: 0.1, theta2: 0.05, duration: 0.02 });
  assert.equal(r.valid, true);
  assert.equal(r.coarseStatus, 'complete');
  assert.equal(r.fineStatus, 'complete');
  assert.ok(r.coarse.diagnostics.stabilityLimitedSteps > 0);
  assert.ok(r.fineMaxStep <= r.coarseMaxStep / 2 + 1e-14);
  assert.ok(r.fine.diagnostics.steps >= r.coarse.diagnostics.steps * 1.99);
  assert.equal(r.fine.diagnostics.stabilityRefinement, 2);
  assert.ok(r.maxPositionDifference > 0);
});

test('invalid input produces explicit diagnostics without throwing or running', () => {
  for (const input of [{ s1: 0 }, { m2: -1 }, { theta1: NaN }, { dt: 0 }, { c1: -0.1 }, { duration: Infinity }, { m1: '1' }]) {
    const validation = validateParams(input);
    assert.equal(validation.ok, false);
    const result = simulate(input);
    assert.equal(result.status, 'error');
    assert.ok(result.diagnostics.errors.length);
    assert.equal(result.samples.length, 0);
  }
});

test('string mode ignores rod masses and preserves the original trajectory and slack stop', () => {
  const p = { theta1: 80, theta2: 20, duration: 2 };
  const original = simulate(p);
  const ignored = simulate({ ...p, model: 'string', rodMass1: 5, rodMass2: 9 });
  assert.equal(ignored.status, 'slack');
  assert.deepEqual(ignored.samples, original.samples);
  assert.deepEqual(ignored.event, original.event);
  assert.equal(ignored.diagnostics.forceSemantics, 'string-tension');
});

test('massless rigid rods reproduce the ideal taut double pendulum with and without damping', () => {
  for (const damping of [0, 0.003]) {
    const p = { c1: damping, c2: damping * 2, duration: 3 };
    const strings = simulate(p), rods = simulate({ ...p, model: 'rigid' });
    assert.equal(strings.status, 'complete');
    assert.equal(rods.status, 'complete');
    assert.equal(strings.samples.length, rods.samples.length);
    strings.samples.forEach((s, i) => {
      const r = rods.samples[i];
      near(s.theta1, r.theta1, 1e-11); near(s.theta2, r.theta2, 1e-11);
      near(s.energy, r.energy, 1e-11);
      near(s.tension1, r.tension1, 1e-10); near(s.tension2, r.tension2, 1e-10);
    });
  }
});

test('uniform rods at rest have reaction forces equal to their supported weights', () => {
  const p = { ...DEFAULTS, model: 'rigid', m1: 0.3, m2: 0.7, rodMass1: 0.15, rodMass2: 0.25 };
  const r = tensions([0, 0, 0, 0, 0], p);
  near(r.reaction1X, 0); near(r.reaction2X, 0);
  near(r.reaction1Y, (p.m1 + p.m2 + p.rodMass1 + p.rodMass2) * p.g);
  near(r.reaction2Y, (p.m2 + p.rodMass2) * p.g);
  near(r.tension1, r.reaction1Y); near(r.tension2, r.reaction2Y);
});

test('massive-rod reactions satisfy independent COM force and torque balances with pure damping couples', () => {
  const cross = (x, y, fx, fy) => x * fy - y * fx;
  for (const c of [0, 0.007]) {
    const p = { ...DEFAULTS, model: 'rigid', s1: 0.63, s2: 0.38,
      m1: 0.19, m2: 0.27, rodMass1: 0.15, rodMass2: 0.23, c1: c, c2: c * 1.3 };
    const state = [0.73, -0.37, 1.8, -2.3, 0];
    const [a, b, u, v] = state;
    const [, , aa, ab] = derivative(state, p);
    const R = tensions(state, p);
    const M1 = p.m1 + p.rodMass1, M2 = p.m2 + p.rodMass2;
    const h1 = p.s1 * (p.m1 + p.rodMass1 / 2) / M1;
    const h2 = p.s2 * (p.m2 + p.rodMass2 / 2) / M2;
    const I1 = p.rodMass1 * p.s1 ** 2 / 12 + p.rodMass1 * (p.s1 / 2 - h1) ** 2 + p.m1 * (p.s1 - h1) ** 2;
    const I2 = p.rodMass2 * p.s2 ** 2 / 12 + p.rodMass2 * (p.s2 / 2 - h2) ** 2 + p.m2 * (p.s2 - h2) ** 2;
    const ax1 = h1 * (aa * Math.cos(a) - u * u * Math.sin(a));
    const ay1 = h1 * (aa * Math.sin(a) + u * u * Math.cos(a));
    const jointAX = p.s1 * (aa * Math.cos(a) - u * u * Math.sin(a));
    const jointAY = p.s1 * (aa * Math.sin(a) + u * u * Math.cos(a));
    const ax2 = jointAX + h2 * (ab * Math.cos(b) - v * v * Math.sin(b));
    const ay2 = jointAY + h2 * (ab * Math.sin(b) + v * v * Math.cos(b));
    near(M1 * ax1, R.reaction1X - R.reaction2X);
    near(M1 * ay1, R.reaction1Y - R.reaction2Y - M1 * p.g);
    near(M2 * ax2, R.reaction2X);
    near(M2 * ay2, R.reaction2Y - M2 * p.g);
    const q1 = -p.c1 * u + p.c2 * (v - u), q2 = -p.c2 * (v - u);
    const torque1 = cross(-h1 * Math.sin(a), h1 * Math.cos(a), R.reaction1X, R.reaction1Y)
      + cross((p.s1 - h1) * Math.sin(a), -(p.s1 - h1) * Math.cos(a), -R.reaction2X, -R.reaction2Y) + q1;
    const torque2 = cross(-h2 * Math.sin(b), h2 * Math.cos(b), R.reaction2X, R.reaction2Y) + q2;
    near(I1 * aa, torque1); near(I2 * ab, torque2);
  }
});

test('two equal uniform rods without point weights have the analytical small-angle normal frequencies', () => {
  // Direct determinant of [[3/2,0],[0,1/2]]-lambda*[[4/3,1/2],[1/2,1/3]]:
  // 7 lambda² - 42 lambda + 27 = 0, lambda=omega² L/g.
  for (const sign of [-1, 1]) {
    const lambda = 3 + sign * 6 / Math.sqrt(7);
    const theta1 = 0.005, theta2 = theta1 * (3 / lambda - 8 / 3);
    const period = 2 * Math.PI / Math.sqrt(DEFAULTS.g / DEFAULTS.s1 * lambda);
    const r = simulate({ model: 'rigid', m1: 0, m2: 0, rodMass1: 0.2, rodMass2: 0.2, theta1, theta2, duration: period });
    assert.equal(r.status, 'complete');
    near(r.samples.at(-1).theta1, theta1 * rad, 2e-10);
    near(r.samples.at(-1).theta2, theta2 * rad, 2e-10);
    const quarter = r.samples.reduce((a, b) => Math.abs(a.t - period / 4) < Math.abs(b.t - period / 4) ? a : b);
    assert.ok(Math.abs(quarter.theta1) < theta1 * rad * 0.07);
  }
});

test('vanishing lower-rod mass approaches the exact single uniform physical-pendulum equation', () => {
  const p = { ...DEFAULTS, model: 'rigid', m1: 0, m2: 0, rodMass1: 0.3, rodMass2: 1e-10, s1: 0.6, s2: 0.4 };
  assert.equal(validateParams(p).ok, true);
  const a = 0.6;
  const d = derivative([a, 0.2, 0, 0, 0], p);
  near(d[2], -3 * p.g / (2 * p.s1) * Math.sin(a), 1e-7);
});

test('rigid rods continue through compression and complete multiple rotations', () => {
  const r = simulate({ model: 'rigid', rodMass1: 0.05, rodMass2: 0.05,
    theta1: 120, theta2: -10, omega1: 720, duration: 3 });
  assert.equal(r.status, 'complete');
  assert.equal(r.event, null);
  assert.equal(r.diagnostics.forceSemantics, 'axial-support-and-joint-reaction');
  assert.ok(r.diagnostics.minTension1 < 0);
  assert.ok(Math.max(...r.samples.map(s => Math.abs(s.theta1))) > 2 * Math.PI);
  assert.ok(r.diagnostics.relativeEnergyError < 1e-7);
  for (const s of r.samples) {
    near(Math.hypot(s.x1, s.y1), r.params.s1, 1e-14);
    near(Math.hypot(s.x2 - s.x1, s.y2 - s.y1), r.params.s2, 1e-14);
  }
});

test('massive rods dissipate mechanical energy while preserving E+D', () => {
  const r = simulate({ model: 'rigid', m1: 0, m2: 0, rodMass1: 0.2, rodMass2: 0.2,
    c1: 0.002, c2: 0.002, duration: 10 });
  assert.equal(r.status, 'complete');
  assert.ok(r.diagnostics.relativeEnergyError < 1e-9);
  assert.ok(r.diagnostics.finalEnergy < r.diagnostics.initialEnergy / 2);
  assert.ok(r.diagnostics.dissipatedEnergy > 0);
  for (let i = 1; i < r.samples.length; i++) {
    assert.ok(r.samples[i].energy <= r.samples[i - 1].energy + 1e-10);
    assert.ok(r.samples[i].dissipated >= r.samples[i - 1].dissipated);
  }
});

test('rigid validation accepts independent rod inertias and rejects singular or unphysical configurations', () => {
  for (const p of [
    { model: 'rigid', m1: 0, m2: 0, rodMass1: 0.1, rodMass2: 0.1 },
    { model: 'rigid', m1: 0, m2: 0, rodMass1: 0, rodMass2: 0.1 },
    { model: 'rigid', m1: 0, m2: 0.2, rodMass1: 0.1, rodMass2: 0 },
  ]) assert.equal(validateParams(p).ok, true);
  for (const p of [
    { model: 'rigid', m1: 0, m2: 0 },
    { model: 'rigid', m1: 0, m2: 0.2 },
    { model: 'rigid', m1: 0, m2: 0, rodMass1: 0.1 },
    { model: 'rigid', m1: -0.1 }, { rodMass1: -0.1 },
    { model: 'unsupported' }, { model: 1 }, { model: 'string', m1: 0 },
  ]) {
    assert.equal(validateParams(p).ok, false);
    const r = simulate(p);
    assert.equal(r.status, 'error');
    assert.equal(r.samples.length, 0);
    assert.ok(r.diagnostics.errors.length);
  }
});
