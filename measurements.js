/**
 * Local-only measurement comparison. Angles in this module are radians;
 * CSV inputs/outputs explicitly use degrees. Nothing is uploaded.
 */
const RAD_TO_DEG = 180 / Math.PI;
const DEG_TO_RAD = Math.PI / 180;
const REQUIRED_HEADERS = ['t', 'theta1_deg', 'theta2_deg'];

function finiteNumber(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${label} moet een eindig getal zijn.`);
  }
  return value;
}

/** Parse one CSV record, including ordinary quoted fields and escaped quotes. */
function splitRecord(line, separator, lineNumber) {
  const fields = [];
  let field = '';
  let quoted = false;
  let closedQuote = false;
  for (let i = 0; i < line.length; i += 1) {
    const character = line[i];
    if (quoted) {
      if (character === '"' && line[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (character === '"') {
        quoted = false;
        closedQuote = true;
      } else {
        field += character;
      }
    } else if (character === separator) {
      fields.push(field.trim());
      field = '';
      closedQuote = false;
    } else if (character === '"') {
      if (field.trim() || closedQuote) {
        throw new Error(`Regel ${lineNumber}: ongeldige aanhalingstekens.`);
      }
      field = '';
      quoted = true;
    } else {
      if (closedQuote && character.trim()) {
        throw new Error(`Regel ${lineNumber}: tekst na een afgesloten CSV-veld.`);
      }
      field += character;
    }
  }
  if (quoted) {
    throw new Error(`Regel ${lineNumber}: niet-afgesloten aanhalingsteken.`);
  }
  fields.push(field.trim());
  return fields;
}

/**
 * Accept t,theta1_deg,theta2_deg (seconds, degrees from downward vertical).
 * Extra named columns are allowed. Semicolon files also accept decimal commas.
 * Empty lines and full-line # comments are ignored. Requires at least two rows.
 */
export function parseMeasurementCSV(text) {
  if (typeof text !== 'string') throw new Error('De CSV-inhoud moet tekst zijn.');
  const records = text.replace(/^\uFEFF/, '').split(/\r\n|\n|\r/)
    .map((line, index) => ({ line: line.trim(), number: index + 1 }))
    .filter(({ line }) => line && !line.startsWith('#'));
  if (!records.length) throw new Error('Het CSV-bestand is leeg.');

  const separator = records[0].line.includes(';') ? ';' : ',';
  const headers = splitRecord(records[0].line, separator, records[0].number)
    .map((header) => header.toLowerCase());
  if (headers.some((header) => !header) || new Set(headers).size !== headers.length) {
    throw new Error('De CSV-kop bevat lege of dubbele kolomnamen.');
  }
  for (const name of REQUIRED_HEADERS) {
    if (!headers.includes(name)) throw new Error(`Verplichte CSV-kolom ontbreekt: ${name}.`);
  }

  const indexes = REQUIRED_HEADERS.map((name) => headers.indexOf(name));
  const numberPattern = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
  const rows = [];
  for (const record of records.slice(1)) {
    const fields = splitRecord(record.line, separator, record.number);
    if (fields.length !== headers.length) {
      throw new Error(`Regel ${record.number}: verwacht ${headers.length} velden, kreeg ${fields.length}.`);
    }
    const values = indexes.map((index, valueIndex) => {
      const valueText = separator === ';' ? fields[index].replace(',', '.') : fields[index];
      const value = Number(valueText);
      if (!numberPattern.test(valueText) || !Number.isFinite(value)) {
        throw new Error(`Regel ${record.number}: ${REQUIRED_HEADERS[valueIndex]} is geen eindig getal.`);
      }
      return value;
    });
    const [t, theta1Deg, theta2Deg] = values;
    if (t < 0 || (rows.length && t <= rows[rows.length - 1].t)) {
      throw new Error(`Regel ${record.number}: tijd moet niet-negatief zijn en strikt toenemen.`);
    }
    const theta1 = theta1Deg * DEG_TO_RAD;
    const theta2 = theta2Deg * DEG_TO_RAD;
    if (!Number.isFinite(theta1) || !Number.isFinite(theta2)) {
      throw new Error(`Regel ${record.number}: de hoek valt buiten het numerieke bereik.`);
    }
    rows.push({ t, theta1, theta2 });
  }
  if (rows.length < 2) throw new Error('Er zijn minimaal twee meetregels nodig.');
  return rows;
}

function validateSeries(series, label) {
  if (!Array.isArray(series)) throw new Error(`${label} moet een array zijn.`);
  series.forEach((sample, index) => {
    if (!sample || typeof sample !== 'object') throw new Error(`${label}: ongeldige regel ${index + 1}.`);
    finiteNumber(sample.t, `${label}: tijd`);
    finiteNumber(sample.theta1, `${label}: hoek 1`);
    finiteNumber(sample.theta2, `${label}: hoek 2`);
    if (sample.t < 0 || (index > 0 && sample.t <= series[index - 1].t)) {
      throw new Error(`${label}: tijden moeten niet-negatief zijn en strikt toenemen.`);
    }
  });
}

/** Signed measured-minus-model residual, on [-pi, pi]. */
function wrappedDifference(measured, modeled) {
  return Math.atan2(Math.sin(measured - modeled), Math.cos(measured - modeled));
}

/**
 * samples.theta1/theta2 must be continuous, unwrapped simulation angles.
 * A positive timeOffset means the experimental release happened at that CSV time:
 * model time = measurement time - timeOffset. maxTime is a model-time cutoff.
 * Linear interpolation uses unwrapped model angles; residuals are then wrapped.
 * Never extrapolates. No matched rows yields null RMSE values, never a false zero.
 */
export function compareMeasurements(measurements, samples, { timeOffset = 0, maxTime = Infinity } = {}) {
  validateSeries(measurements, 'Metingen');
  validateSeries(samples, 'Simulatie');
  finiteNumber(timeOffset, 'Tijdverschuiving');
  if ((maxTime !== Infinity && !Number.isFinite(maxTime)) || maxTime < 0) {
    throw new Error('De vergelijkingsduur moet niet-negatief en eindig zijn, of Infinity.');
  }
  const rows = [];
  let excluded = 0;
  let lowerIndex = 0;
  let sum1 = 0;
  let sum2 = 0;
  for (const measurement of measurements) {
    const modelTime = measurement.t - timeOffset;
    if (!samples.length || modelTime < samples[0].t || modelTime > samples[samples.length - 1].t || modelTime > maxTime) {
      excluded += 1;
      continue;
    }
    while (lowerIndex + 1 < samples.length && samples[lowerIndex + 1].t <= modelTime) lowerIndex += 1;
    const lower = samples[lowerIndex];
    const upper = samples[Math.min(lowerIndex + 1, samples.length - 1)];
    const fraction = lower === upper ? 0 : (modelTime - lower.t) / (upper.t - lower.t);
    const modelTheta1 = lower.theta1 + fraction * (upper.theta1 - lower.theta1);
    const modelTheta2 = lower.theta2 + fraction * (upper.theta2 - lower.theta2);
    const error1Deg = wrappedDifference(measurement.theta1, modelTheta1) * RAD_TO_DEG;
    const error2Deg = wrappedDifference(measurement.theta2, modelTheta2) * RAD_TO_DEG;
    sum1 += error1Deg ** 2;
    sum2 += error2Deg ** 2;
    rows.push({ t: measurement.t, theta1: measurement.theta1, theta2: measurement.theta2, modelTheta1, modelTheta2, error1Deg, error2Deg });
  }
  return {
    count: rows.length,
    rmse1Deg: rows.length ? Math.sqrt(sum1 / rows.length) : null,
    rmse2Deg: rows.length ? Math.sqrt(sum2 / rows.length) : null,
    rows,
    excluded,
  };
}

/**
 * Export simulation samples. Positions are meters: x right, y up.
 * Pass the full simulation result for rigid mode so params.model identifies the
 * force semantics. Bare sample arrays retain the original string-model format.
 * Rigid axial reactions are signed projections at the rod's upper attachment;
 * they are not uniform rod stresses. Cartesian reactions use x right, y up.
 */
export function exportSimulationCSV(result) {
  const samples = Array.isArray(result) ? result : result?.samples;
  if (!Array.isArray(samples)) throw new Error('Er zijn geen simulatieregels om te exporteren.');
  const rigid = result?.params?.model === 'rigid';
  const forceColumns = rigid ? [
    ['axial_reaction1_N', 'tension1', 1], ['axial_reaction2_N', 'tension2', 1],
    ['reaction1_x_N', 'reaction1X', 1], ['reaction1_y_N', 'reaction1Y', 1],
    ['reaction2_x_N', 'reaction2X', 1], ['reaction2_y_N', 'reaction2Y', 1],
  ] : [
    ['tension1_N', 'tension1', 1], ['tension2_N', 'tension2', 1],
  ];
  const columns = [
    ['t', 't', 1],
    ['theta1_deg', 'theta1', RAD_TO_DEG],
    ['theta2_deg', 'theta2', RAD_TO_DEG],
    ['omega1_deg_s', 'omega1', RAD_TO_DEG],
    ['omega2_deg_s', 'omega2', RAD_TO_DEG],
    ['x1_m', 'x1', 1], ['y1_m', 'y1', 1],
    ['x2_m', 'x2', 1], ['y2_m', 'y2', 1],
    ['energy_J', 'energy', 1],
    ...forceColumns,
    ['dissipated_J', 'dissipated', 1],
  ];
  return [
    columns.map(([header]) => header).join(','),
    ...samples.map((sample, index) => columns.map(([, key, scale]) => {
      const value = finiteNumber(sample[key], `Simulatieregel ${index + 1}: ${key}`) * scale;
      finiteNumber(value, `CSV-waarde ${key}`);
      return String(Object.is(value, -0) ? 0 : value);
    }).join(',')),
  ].join('\n') + '\n';
}
