/**
 * Planar double pendulum, valid only while both ideal strings remain taut.
 * Coordinates: x right, y up; both absolute angles measured from vertically down.
 * Public parameters use degrees and degrees/s; states/samples use radians.
 * State: [theta1, theta2, omega1, omega2, dissipatedEnergy].
 *
 * Undamped equations checked against Erik Neumann's Newtonian derivation:
 * https://www.myphysicslab.com/pendulum/double-pendulum-en.html
 * Damping is an optional phenomenological generalized torque model, NOT a
 * calibrated aerodynamic or literal string-hinge friction model.
 */

export const DEFAULTS = Object.freeze({
  s1: 0.5, s2: 0.5, m1: 0.2, m2: 0.2, g: 9.81, c1: 0, c2: 0,
  theta1: 25, theta2: -15, omega1: 0, omega2: 0,
  duration: 20, dt: 0.001, perturbation: 0.1,
});

const RAD = Math.PI / 180;
const SAMPLE_INTERVAL = 0.01;
const MAX_STEPS = 2_000_000;

/** Validate configuration without throwing; reject non-finite or unsafe workloads. */
export function validateParams(input = {}) {
  const params = { ...DEFAULTS, ...input };
  const errors = [];
  for (const key of Object.keys(DEFAULTS)) {
    if (typeof params[key] !== 'number' || !Number.isFinite(params[key])) {
      errors.push(`${key}: geef een eindig getal op.`);
    }
  }
  if (errors.length) return { ok: false, errors, params };
  for (const key of ['s1', 's2', 'm1', 'm2']) {
    if (params[key] < 0.0001 || params[key] > 1000) errors.push(`${key}: kies 0,0001 t/m 1000.`);
  }
  if (params.g < 0 || params.g > 100) errors.push('g: kies 0 t/m 100 m/s².');
  for (const key of ['c1', 'c2']) {
    if (params[key] < 0 || params[key] > 1000) errors.push(`${key}: kies 0 t/m 1000 N m s/rad.`);
  }
  for (const key of ['theta1', 'theta2', 'omega1', 'omega2']) {
    if (Math.abs(params[key]) > 36000) errors.push(`${key}: absolute waarde maximaal 36000.`);
  }
  if (params.duration < 0.01 || params.duration > 120) errors.push('duration: kies 0,01 t/m 120 s.');
  if (params.dt < 0.00001 || params.dt > 0.01) errors.push('dt: kies 0,00001 t/m 0,01 s.');
  if (2 * params.duration / params.dt > MAX_STEPS) errors.push('Te veel rekenstappen: kies een kortere duur of grotere dt.');
  if (Math.abs(params.perturbation) > 180) errors.push('perturbation: absolute waarde maximaal 180 graden.');
  return { ok: errors.length === 0, errors, params };
}

/** Lagrange mass-matrix equations. Parameters must already be validated. */
export function derivative(state, p) {
  const [a, b, u, v] = state;
  const delta = a - b;
  const sd = Math.sin(delta), cd = Math.cos(delta);
  const total = p.m1 + p.m2;
  const coupling = p.m2 * p.s1 * p.s2;
  const A = total * p.s1 * p.s1;
  const B = coupling * cd;
  const C = p.m2 * p.s2 * p.s2;
  const relative = v - u;
  const torque1 = -p.c1 * u + p.c2 * relative;
  const torque2 = -p.c2 * relative;
  const f1 = -coupling * sd * v * v - total * p.g * p.s1 * Math.sin(a) + torque1;
  const f2 = coupling * sd * u * u - p.m2 * p.g * p.s2 * Math.sin(b) + torque2;
  // Algebraically A*C-B²; this form avoids cancellation for unequal masses.
  const determinant = p.m2 * p.s1 ** 2 * p.s2 ** 2 * (p.m1 + p.m2 * sd * sd);
  return [u, v, (C * f1 - B * f2) / determinant,
    (A * f2 - B * f1) / determinant, p.c1 * u * u + p.c2 * relative * relative];
}

/** Energy [J], with gravitational potential zero in the bottom configuration. */
export function energy(state, p) {
  const [a, b, u, v] = state;
  const kinetic = 0.5 * (p.m1 + p.m2) * p.s1 ** 2 * u * u
    + 0.5 * p.m2 * p.s2 ** 2 * v * v
    + p.m2 * p.s1 * p.s2 * u * v * Math.cos(a - b);
  // 2 sin²(theta/2) is more accurate than 1-cos(theta) for small angles.
  const potential = 2 * (p.m1 + p.m2) * p.g * p.s1 * Math.sin(a / 2) ** 2
    + 2 * p.m2 * p.g * p.s2 * Math.sin(b / 2) ** 2;
  return kinetic + potential;
}

/** Positive is tension. A negative reaction would require an impossible push. */
export function tensions(state, p) {
  const [a, b, u, v] = state;
  const [, , alpha1, alpha2] = derivative(state, p);
  const sd = Math.sin(a - b), cd = Math.cos(a - b);
  const tension1 = (p.m1 + p.m2) * (p.g * Math.cos(a) + p.s1 * u * u)
    - p.m2 * p.s2 * alpha2 * sd + p.m2 * p.s2 * v * v * cd;
  const tension2 = p.m2 * (p.g * Math.cos(b) + p.s1 * alpha1 * sd
    + p.s1 * u * u * cd + p.s2 * v * v);
  return { tension1, tension2 };
}

function rk4(state, h, p) {
  const k1 = derivative(state, p);
  const k2 = derivative(state.map((v, i) => v + h * k1[i] / 2), p);
  const k3 = derivative(state.map((v, i) => v + h * k2[i] / 2), p);
  const k4 = derivative(state.map((v, i) => v + h * k3[i]), p);
  return state.map((v, i) => v + h * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]) / 6);
}

function sample(t, state, p) {
  const [theta1, theta2, omega1, omega2, dissipated] = state;
  const x1 = p.s1 * Math.sin(theta1), y1 = -p.s1 * Math.cos(theta1);
  return { t, theta1, theta2, omega1, omega2, x1, y1,
    x2: x1 + p.s2 * Math.sin(theta2), y2: y1 - p.s2 * Math.cos(theta2),
    energy: energy(state, p), dissipated, ...tensions(state, p) };
}

// Resolve the earliest bracketed zero. Each bisection evaluates a genuine RK4
// trajectory from the bracket's start; it does not linearly interpolate angles.
function slackEvent(t, state, h, p, endTensions) {
  const candidates = [];
  for (const string of [1, 2]) {
    const key = `tension${string}`;
    if (endTensions[key] >= 0) continue;
    let lo = 0, hi = h;
    for (let n = 0; n < 48 && hi - lo > 1e-11; n++) {
      const mid = (lo + hi) / 2;
      if (tensions(rk4(state, mid, p), p)[key] < 0) hi = mid;
      else lo = mid;
    }
    const offset = (lo + hi) / 2;
    const eventState = rk4(state, offset, p);
    candidates.push({ t: t + offset, string, tension: tensions(eventState, p)[key], state: eventState });
  }
  candidates.sort((a, b) => a.t - b.t);
  return candidates[0];
}

function numericalStepLimit(state, p) {
  // Keep RK4 stable for short strings, high velocities and strong damping.
  // lambda_min(M) >= det(M)/trace(M), using the global minimum determinant.
  const inertiaLowerBound = p.m2 * p.s1 ** 2 * p.s2 ** 2 * p.m1
    / ((p.m1 + p.m2) * p.s1 ** 2 + p.m2 * p.s2 ** 2);
  const dampingRateBound = (p.c1 + 2 * p.c2) / inertiaLowerBound;
  const frequencyBound = Math.sqrt(p.g / Math.min(p.s1, p.s2) * (1 + p.m2 / p.m1));
  return 0.08 / Math.max(1, dampingRateBound, frequencyBound, Math.abs(state[2]), Math.abs(state[3]));
}

/**
 * Integrate until duration or the first loss of string tension. RK4 steps never
 * exceed dt/2; tensions are checked on this finer grid. Event accuracy still
 * depends on dt, so use compareConvergence before quantitative experiments.
 */
export function simulate(input = {}, integrationOptions = {}) {
  const validation = validateParams(input);
  const p = validation.params;
  // Convergence must also refine steps limited by stiffness/velocity, otherwise
  // two nominal dt values can secretly use identical internal steps.
  const stabilityRefinement = integrationOptions.stabilityRefinement ?? 1;
  if (!Number.isFinite(stabilityRefinement) || stabilityRefinement < 1 || stabilityRefinement > 16) {
    validation.errors.push('stabilityRefinement: kies een factor van 1 t/m 16.');
  }
  const diagnostics = {
    steps: 0, sampleInterval: SAMPLE_INTERVAL, maxStep: 0,
    stabilityRefinement, stabilityLimitedSteps: 0,
    initialEnergy: 0, finalEnergy: 0, dissipatedEnergy: 0, energyScale: 1,
    maxEnergyBalanceError: 0, relativeEnergyError: 0,
    minTension1: Infinity, minTension2: Infinity,
    maxTension1: -Infinity, maxTension2: -Infinity,
    maxSpeed1: 0, maxSpeed2: 0, elapsed: 0,
    warnings: [], errors: validation.errors,
  };
  const result = { params: p, samples: [], status: 'complete', event: null, diagnostics };
  if (validation.errors.length) { result.status = 'error'; return result; }
  let state = [p.theta1 * RAD, p.theta2 * RAD, p.omega1 * RAD, p.omega2 * RAD, 0];
  let t = 0, nextOutput = SAMPLE_INTERVAL;
  const first = sample(0, state, p);
  diagnostics.initialEnergy = first.energy;
  diagnostics.energyScale = Math.max(first.energy, (p.m1 + p.m2) * p.g * p.s1 + p.m2 * p.g * p.s2, 1e-12);

  function observe(s) {
    diagnostics.finalEnergy = s.energy;
    diagnostics.dissipatedEnergy = s.dissipated;
    diagnostics.elapsed = s.t;
    diagnostics.minTension1 = Math.min(diagnostics.minTension1, s.tension1);
    diagnostics.minTension2 = Math.min(diagnostics.minTension2, s.tension2);
    diagnostics.maxTension1 = Math.max(diagnostics.maxTension1, s.tension1);
    diagnostics.maxTension2 = Math.max(diagnostics.maxTension2, s.tension2);
    diagnostics.maxSpeed1 = Math.max(diagnostics.maxSpeed1, Math.abs(s.omega1));
    diagnostics.maxSpeed2 = Math.max(diagnostics.maxSpeed2, Math.abs(s.omega2));
    diagnostics.maxEnergyBalanceError = Math.max(diagnostics.maxEnergyBalanceError,
      Math.abs(s.energy + s.dissipated - diagnostics.initialEnergy));
    diagnostics.relativeEnergyError = diagnostics.maxEnergyBalanceError / diagnostics.energyScale;
  }
  function push(s) {
    observe(s);
    if (result.samples.length && Math.abs(result.samples.at(-1).t - s.t) < 1e-12) result.samples[result.samples.length - 1] = s;
    else result.samples.push(s);
  }
  push(first);
  if (first.tension1 < -1e-12 * Math.max(1, (p.m1 + p.m2) * p.g)
      || first.tension2 < -1e-12 * Math.max(1, p.m2 * p.g)) {
    const string = first.tension1 < 0 ? 1 : 2;
    result.status = 'slack';
    result.event = { t: 0, string, tension: first[`tension${string}`], initial: true };
    diagnostics.warnings.push('De beginstand vereist een duwkracht in een touw. Er is geen geldige gespannen beginbeweging.');
    return result;
  }
  try {
    while (t < p.duration - 1e-12) {
      if (diagnostics.steps >= MAX_STEPS) throw new Error('Rekenlimiet bereikt. Verkort de duur of verminder extreme massa-, lengte- of dempingsverhoudingen.');
      const stabilityLimit = numericalStepLimit(state, p) / stabilityRefinement;
      const h = Math.min(p.dt / 2, stabilityLimit, p.duration - t, nextOutput - t);
      if (!(h > 0) || t + h === t) throw new Error('De benodigde tijdstap is numeriek te klein.');
      const nextState = rk4(state, h, p);
      if (!nextState.every(Number.isFinite)) throw new Error('Numerieke instabiliteit: kies een kleinere tijdstap.');
      const next = sample(t + h, nextState, p);
      if (![next.energy, next.tension1, next.tension2].every(Number.isFinite)) throw new Error('Niet-eindige energie of touwspanning.');
      diagnostics.steps++;
      if (stabilityLimit < p.dt / 2) diagnostics.stabilityLimitedSteps++;
      diagnostics.maxStep = Math.max(diagnostics.maxStep, h);
      if (next.tension1 < 0 || next.tension2 < 0) {
        const event = slackEvent(t, state, h, p, next);
        push(sample(event.t, event.state, p));
        result.status = 'slack';
        result.event = { t: event.t, string: event.string, tension: event.tension, initial: false };
        diagnostics.warnings.push('Touwspanning bereikt nul. Vrije vlucht en opnieuw strak trekken vallen buiten dit model.');
        break;
      }
      state = nextState;
      t += h;
      observe(next);
      if (t >= nextOutput - 1e-12 || t >= p.duration - 1e-12) {
        push(next);
        nextOutput += SAMPLE_INTERVAL;
      }
    }
  } catch (error) {
    result.status = 'error';
    diagnostics.errors.push(error.message);
    push(sample(t, state, p));
  }
  if (diagnostics.relativeEnergyError > 1e-5) diagnostics.warnings.push('De energiebalans wijkt meer dan 0,001% van de energieschaal af. Verklein dt en controleer convergentie.');
  return result;
}

/** Compare dt against dt/2 on the shared output grid; chaos can amplify errors. */
export function compareConvergence(params = {}) {
  const coarse = simulate(params);
  const fine = simulate({ ...params, dt: coarse.params.dt / 2 }, { stabilityRefinement: 2 });
  let maxPositionDifference = 0, finalPositionDifference = 0, commonDuration = 0, comparedSamples = 0;
  let i = 0, j = 0;
  while (i < coarse.samples.length && j < fine.samples.length) {
    const a = coarse.samples[i], b = fine.samples[j];
    if (Math.abs(a.t - b.t) < 1e-9) {
      finalPositionDifference = Math.max(Math.hypot(a.x1 - b.x1, a.y1 - b.y1), Math.hypot(a.x2 - b.x2, a.y2 - b.y2));
      maxPositionDifference = Math.max(maxPositionDifference, finalPositionDifference);
      commonDuration = Math.min(a.t, b.t);
      comparedSamples++;
      i++; j++;
    } else if (a.t < b.t) i++;
    else j++;
  }
  return { valid: coarse.status !== 'error' && fine.status !== 'error',
    errors: [...coarse.diagnostics.errors, ...fine.diagnostics.errors],
    coarseStatus: coarse.status, fineStatus: fine.status, commonDuration,
    comparedSamples, maxPositionDifference, finalPositionDifference,
    coarseMaxStep: coarse.diagnostics.maxStep, fineMaxStep: fine.diagnostics.maxStep,
    eventTimeDifference: coarse.event && fine.event ? Math.abs(coarse.event.t - fine.event.t) : null,
    coarse, fine };
}
