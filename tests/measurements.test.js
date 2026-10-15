import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMeasurementCSV, compareMeasurements, exportSimulationCSV } from '../measurements.js';

// All data below are synthetic numerical checks, not physical experiments.
const rad = (degrees) => degrees * Math.PI / 180;
const close = (actual, expected, tolerance = 1e-10) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);

test('CSV parses BOM, comments, CRLF, reordered columns and degrees', () => {
  const rows = parseMeasurementCSV('\uFEFF# Synthetic data\r\ntheta2_deg,t,theta1_deg,label\r\n-90,0,180,"synthetic, only"\r\n\r\n# comment\r\n0,0.2,-45,test\r\n');
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { t: 0, theta1: Math.PI, theta2: -Math.PI / 2 });
  close(rows[1].theta1, -Math.PI / 4);
});

test('semicolon CSV accepts Dutch decimal commas and quoted values', () => {
  const rows = parseMeasurementCSV('t;theta1_deg;theta2_deg\n"0,0";10,5;-2,5\n0,02;1,2e1;0');
  assert.equal(rows[1].t, 0.02);
  close(rows[0].theta1, rad(10.5));
  close(rows[1].theta1, rad(12));
});

test('CSV rejects invalid numeric values and ambiguous or non-increasing times', () => {
  for (const data of [
    '',
    't,theta1_deg\n0,1\n1,2',
    't,theta1_deg,theta1_deg,theta2_deg\n0,0,0,0\n1,0,0,0',
    't,theta1_deg,theta2_deg\n0,1,2',
    ...['', 'NaN', 'Infinity', '2rad', '0x10', '1e309'].map((value) => `t,theta1_deg,theta2_deg\n0,${value},0\n1,0,0`),
    't,theta1_deg,theta2_deg\n-1,0,0\n0,0,0',
    't,theta1_deg,theta2_deg\n0,0,0\n0,1,1',
    't,theta1_deg,theta2_deg\n1,0,0\n0,1,1',
    't,theta1_deg,theta2_deg\n0,0,0,0\n1,1,1',
    't,theta1_deg,theta2_deg\n0,"0,0\n1,1,1',
    't,theta1_deg,theta2_deg\n0,"0"x,0\n1,1,1',
  ]) assert.throws(() => parseMeasurementCSV(data), Error, data);
});

test('comparison interpolates unwrapped angles across a full rotation and wraps residuals', () => {
  const samples = [
    { t: 0, theta1: rad(170), theta2: rad(350) },
    { t: 1, theta1: rad(190), theta2: rad(370) },
  ];
  const measurements = [
    { t: 0.25, theta1: rad(177), theta2: rad(-8) },
    { t: 0.75, theta1: rad(-173), theta2: rad(2) },
  ];
  const comparison = compareMeasurements(measurements, samples);
  assert.equal(comparison.count, 2);
  close(comparison.rows[0].modelTheta1, rad(175));
  close(comparison.rows[1].modelTheta2, rad(365));
  close(comparison.rmse1Deg, 2);
  close(comparison.rmse2Deg, 3);
  close(comparison.rows[0].error2Deg, -3);
});

test('time offset aligns release; endpoints included; extrapolation and cutoff excluded', () => {
  const samples = [0, 1, 2].map((t) => ({ t, theta1: t, theta2: -t }));
  const measurements = [0, 1, 2, 3, 4].map((t) => ({ t, theta1: t - 1, theta2: 1 - t }));
  const shifted = compareMeasurements(measurements, samples, { timeOffset: 1 });
  assert.equal(shifted.count, 3);
  assert.equal(shifted.excluded, 2);
  close(shifted.rmse1Deg, 0);
  close(shifted.rmse2Deg, 0);
  const cutoff = compareMeasurements(measurements, samples, { timeOffset: 1, maxTime: 1 });
  assert.equal(cutoff.count, 2);
  assert.equal(cutoff.excluded, 3);
  assert.deepEqual(cutoff.rows.map((row) => row.t), [1, 2]);
});

test('no overlap does not report a misleading zero RMSE', () => {
  const measurements = [{ t: 2, theta1: 0, theta2: 0 }];
  const samples = [{ t: 0, theta1: 0, theta2: 0 }];
  assert.deepEqual(compareMeasurements(measurements, samples), { count: 0, rmse1Deg: null, rmse2Deg: null, rows: [], excluded: 1 });
  assert.equal(compareMeasurements(measurements, []).excluded, 1);
});

test('comparison validates finite input, monotonicity and offset/cutoff', () => {
  const sample = { t: 0, theta1: 0, theta2: 0 };
  assert.throws(() => compareMeasurements([sample], [{ ...sample, theta1: NaN }]));
  assert.throws(() => compareMeasurements([sample], [sample, sample]));
  assert.throws(() => compareMeasurements([sample], [sample], { timeOffset: Infinity }));
  assert.throws(() => compareMeasurements([sample], [sample], { maxTime: -1 }));
});

test('simulation export has explicit SI/degree units and round-trips angles', () => {
  const samples = [0, 1].map((t) => ({
    t, theta1: rad(30), theta2: rad(-90), omega1: rad(120), omega2: rad(-45),
    x1: 0.25, y1: -0.4, x2: -0.5, y2: -0.4, energy: 2.5,
    tension1: 3.2, tension2: 1.8, dissipated: 0.04,
  }));
  const csv = exportSimulationCSV({ samples });
  assert.match(csv, /^t,theta1_deg,theta2_deg,omega1_deg_s,omega2_deg_s,x1_m,y1_m,x2_m,y2_m,energy_J,tension1_N,tension2_N,dissipated_J\n/);
  const parsed = parseMeasurementCSV(csv);
  close(parsed[0].theta1, samples[0].theta1);
  close(parsed[0].theta2, samples[0].theta2);
  assert.equal(parsed[1].t, 1);
  const values = csv.split('\n')[1].split(',').map(Number);
  close(values[3], 120);
  assert.equal(values[6], -0.4);
  assert.equal(values[10], 3.2);
  assert.throws(() => exportSimulationCSV([{ ...samples[0], energy: NaN }]));
});
