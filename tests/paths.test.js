import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePathCSV, makePathComparison } from '../paths.js';

const header = 't_video_s,frame,valid,x1_px,y1_px,x2_px,y2_px';
const near = (a, b, tolerance = 1e-12) => assert.ok(Math.abs(a - b) <= tolerance, `${a} != ${b}`);
const options = { s1: 0.2, s2: 0.1, maxTime: 5, timeFactor: 1, offsetVideo: 0 };
const row = (t, frame, extra = {}) => ({ t, frame, valid: true, x1: 100, y1: 200, x2: 150, y2: 250, ...extra });
const sim = [0, 1, 2, 3, 4].map(t => ({ t, theta1: t / 10, theta2: -t / 20 }));

test('path CSV parses actual pixel positions, BOM, comments, quoted fields and extra columns', () => {
  const parsed = parsePathCSV('\uFEFF# Local tracked positions\r\nframe,valid,t_video_s,y2_px,x2_px,y1_px,x1_px,note\r\n'
    + '3,1,0,250,150,200,100,"first, recorded"\r\n4,1,0.1,249,151,199,101,"quote ""ok"""\r\n');
  assert.deepEqual(parsed, [row(0, 3), row(0.1, 4, { x1: 101, y1: 199, x2: 151, y2: 249 })]);
});

test('semicolon path CSV accepts decimal commas and retains invalid blank rows as gaps', () => {
  const parsed = parsePathCSV('t_video_s;frame;valid;x1_px;y1_px;x2_px;y2_px\n'
    + '0;10;1;1,5;2,5;3,5;4,5\n0,1;11;0;;;;\n0,2;12;1;2,5;3,5;4,5;5,5');
  assert.equal(parsed[0].x1, 1.5);
  assert.deepEqual(parsed[1], { t: 0.1, frame: 11, valid: false, x1: null, y1: null, x2: null, y2: null });
  assert.equal(parsed[2].y2, 5.5);
});

test('malformed path CSV cannot silently create zero coordinates or invalid frame identities', () => {
  const good = '0,0,1,1,2,3,4\n1,1,1,5,6,7,8';
  for (const text of [
    '', header + '\n0,0,1,1,2,3,4',
    header + '\n0,0,1,1,2,3,4\n1,1,0,,,,',
    header + '\n0,0,1,,2,3,4\n1,1,1,5,6,7,8',
    header + '\n0,0,1,NaN,2,3,4\n1,1,1,5,6,7,8',
    header + '\n0,0,1,1e999,2,3,4\n1,1,1,5,6,7,8',
    header + '\n0,0,2,1,2,3,4\n1,1,1,5,6,7,8',
    header + '\n0,0,1,1,2,3,4\n0,1,1,5,6,7,8',
    header + '\n0,0,1,1,2,3,4\n1,0,1,5,6,7,8',
    header + '\n0,0.5,1,1,2,3,4\n1,1,1,5,6,7,8',
    header + '\n0,9007199254740992,1,1,2,3,4\n1,9007199254740994,1,5,6,7,8',
    header + '\n-1,0,1,1,2,3,4\n1,1,1,5,6,7,8',
    header + '\n0,0,1,1,2,3\n1,1,1,5,6,7,8',
    header + '\n0,0,1,"1"oops,2,3,4\n1,1,1,5,6,7,8',
    header + '\n0,0,1,"1,2,3,4\n1,1,1,5,6,7,8',
    header.replace('y2_px', 'x2_px') + '\n' + good,
    header.replace('t_video_s', 't') + '\n' + good,
  ]) assert.throws(() => parsePathCSV(text), undefined, text);
});

test('unscaled measured panel retains pixels and flips image y; model always retains meters', () => {
  const measured = [row(0, 0), row(1, 1)];
  const result = makePathComparison(measured, sim, options);
  assert.equal(result.unit, 'px');
  assert.equal(result.modelUnit, 'm');
  assert.equal(result.flags.scaled, false);
  assert.equal(result.measuredPath[0].x1, 100);
  assert.equal(result.measuredPath[0].y1, -200);
  near(result.modelPath[0].y1, -0.2);
  near(result.modelPath[0].y2, -0.3);
  assert.equal(measured[0].y1, 200);
});

test('explicit pixel scale and positive CCW roll transform measured x-right/y-up coordinates', () => {
  const measured = [0, 1].map(t => row(t, t, { x1: 100, y1: 0, x2: 0, y2: 100 }));
  const result = makePathComparison(measured, sim, { ...options, pixelsPerMeter: 100, cameraRollDeg: 90 });
  assert.equal(result.unit, 'm');
  assert.equal(result.flags.rotationApplied, true);
  near(result.measuredPath[0].x1, 0); near(result.measuredPath[0].y1, 1);
  near(result.measuredPath[0].x2, 1); near(result.measuredPath[0].y2, 0);
  const unscaled = makePathComparison(measured, sim, { ...options, cameraRollDeg: 90 });
  assert.equal(unscaled.flags.rotationApplied, false);
  assert.equal(unscaled.measuredPath[0].x1, 100);
  assert.ok(unscaled.warnings.length);
});

test('time factor and video offset produce the same bounded temporal interval in both panels', () => {
  const measured = [1, 3, 5, 7, 9].map((t, i) => row(t, i));
  const result = makePathComparison(measured, sim, { ...options, timeFactor: 2, offsetVideo: 2, maxTime: 3 });
  assert.deepEqual(result.measuredPath.map(r => r.t), [0.5, 1.5, 2.5]);
  assert.deepEqual(result.modelPath.map(r => r.t), [0.5, 1, 2, 2.5]);
  assert.deepEqual(result.timeRange, { start: 0.5, end: 2.5 });
  assert.equal(result.flags.excludedCount, 2);
  near(result.modelPath[0].x1, options.s1 * Math.sin(0.05));
});

test('model path never extends beyond actual accepted measured coverage or simulation validity', () => {
  const measured = [row(0, 0, { valid: false }), row(1, 1), row(2, 2), row(3, 3, { valid: false })];
  const result = makePathComparison(measured, [{ t: 0.5, theta1: 0, theta2: 0 }, { t: 2.5, theta1: 1, theta2: 2 }], options);
  assert.deepEqual(result.timeRange, { start: 1, end: 2 });
  assert.deepEqual(result.modelPath.map(r => r.t), [1, 2]);
  assert.deepEqual(result.measuredPath.map(r => r.frame), [1, 2]);
});

test('floating-point simulation endpoint roundoff does not discard the final measured frame', () => {
  const end = 1 - 1e-13;
  const result = makePathComparison([row(0, 0), row(1, 1)],
    [{ t: 0, theta1: 0, theta2: 0 }, { t: end, theta1: 1, theta2: 2 }], options);
  assert.equal(result.flags.measuredValidCount, 2);
  assert.equal(result.timeRange.end, end);
  assert.equal(result.modelPath.at(-1).t, end);
  near(result.modelPath.at(-1).x1, options.s1 * Math.sin(1));
});

test('invalid rows and skipped original frame numbers explicitly break measured paths', () => {
  const measured = [row(0, 10), row(1, 11, { valid: false }), row(2, 12), row(3, 15), row(4, 16)];
  const result = makePathComparison(measured, sim, options);
  assert.equal(result.flags.hasGaps, true);
  assert.equal(result.flags.measuredValidCount, 4);
  assert.equal(result.flags.measuredInvalidCount, 1);
  assert.equal(result.measuredPath[1].valid, false);
  assert.equal(result.measuredPath[1].x1, null);
  assert.deepEqual(result.measuredPath.map(r => r.breakBefore), [false, false, true, true, false]);
  assert.equal(result.modelPath.length, 5);
  assert.ok(result.modelPath.every(r => r.valid));
});

test('model marker fractions do not incorrectly move the actual lower hinge', () => {
  const simulation = [0, 1].map(t => ({ t, theta1: Math.PI / 2, theta2: 0 }));
  const result = makePathComparison([row(0, 0), row(1, 1)], simulation,
    { ...options, marker1Fraction: 0.5, marker2Fraction: 0.25 });
  const p = result.modelPath[0];
  near(p.x1, 0.1); near(p.y1, 0);
  near(p.x2, 0.2); near(p.y2, -0.025);
  const ends = makePathComparison([row(0, 0), row(1, 1)], simulation,
    { ...options, marker1Fraction: 0, marker2Fraction: 0 }).modelPath[0];
  near(ends.x1, 0); near(ends.y1, 0); near(ends.x2, 0.2); near(ends.y2, 0);
});

test('empty overlap is explicit and one remaining position does not invent a path', () => {
  const measured = [row(0, 0), row(2, 2)];
  const empty = makePathComparison(measured, [{ t: 3, theta1: 0, theta2: 0 }, { t: 4, theta1: 0, theta2: 0 }], options);
  assert.equal(empty.flags.hasOverlap, false);
  assert.equal(empty.timeRange, null);
  assert.deepEqual(empty.measuredPath, []); assert.deepEqual(empty.modelPath, []);
  const one = makePathComparison(measured, sim, { ...options, maxTime: 1 });
  assert.equal(one.measuredPath.length, 1);
  assert.equal(one.modelPath.length, 1);
  assert.deepEqual(one.timeRange, { start: 0, end: 0 });
  assert.ok(one.warnings.length);
});

test('comparison refuses invalid settings, unsorted samples and malformed direct data', () => {
  const measured = [row(0, 0), row(1, 1)];
  for (const bad of [{ timeFactor: 0 }, { offsetVideo: -1 }, { maxTime: Infinity },
    { marker1Fraction: -0.1 }, { marker2Fraction: 1.01 }, { s1: 0 }, { s2: NaN },
    { pixelsPerMeter: 0 }, { cameraRollDeg: NaN }, { timeFactor: '8' }]) {
    assert.throws(() => makePathComparison(measured, sim, { ...options, ...bad }));
  }
  assert.throws(() => makePathComparison(measured, [sim[1], sim[0]], options));
  assert.throws(() => makePathComparison([measured[0], { ...measured[1], x1: NaN }], sim, options));
  assert.throws(() => makePathComparison([measured[0], { ...measured[1], frame: 0 }], sim, options));
  assert.throws(() => makePathComparison(measured, [{ ...sim[0], theta1: Infinity }], options));
});
