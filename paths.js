/** Compare directly tracked image paths with model marker paths; never fits data. */
const HEADERS = ['t_video_s', 'frame', 'valid', 'x1_px', 'y1_px', 'x2_px', 'y2_px'];
const COORDS = ['x1', 'y1', 'x2', 'y2'];
const NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

function finite(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label}: geef een eindig getal op.`);
  return value;
}

function splitRecord(line, separator, number) {
  const fields = [];
  let field = '', quoted = false, closed = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') { quoted = false; closed = true; }
      else field += c;
    } else if (c === separator) {
      fields.push(field.trim()); field = ''; closed = false;
    } else if (c === '"') {
      if (field.trim() || closed) throw new Error(`Regel ${number}: ongeldige aanhalingstekens.`);
      field = ''; quoted = true;
    } else {
      if (closed && c.trim()) throw new Error(`Regel ${number}: tekst na afgesloten CSV-veld.`);
      field += c;
    }
  }
  if (quoted) throw new Error(`Regel ${number}: niet-afgesloten aanhalingsteken.`);
  fields.push(field.trim());
  return fields;
}

function validateMeasured(rows) {
  if (!Array.isArray(rows)) throw new Error('Meetpad moet een array zijn.');
  let count = 0;
  rows.forEach((r, i) => {
    if (!r || typeof r !== 'object') throw new Error(`Meetpad: ongeldige regel ${i + 1}.`);
    finite(r.t, 'Videotijd');
    if (r.t < 0 || (i && r.t <= rows[i - 1].t)) throw new Error('Videotijden moeten niet-negatief zijn en strikt toenemen.');
    if (!Number.isSafeInteger(r.frame) || r.frame < 0 || (i && r.frame <= rows[i - 1].frame)) {
      throw new Error('Framenummers moeten veilige niet-negatieve gehele getallen zijn en strikt toenemen.');
    }
    if (![true, false, 0, 1].includes(r.valid)) throw new Error('valid moet 0 of 1 zijn.');
    if (r.valid) {
      COORDS.forEach(key => finite(r[key], `Meetcoördinaat ${key}`)); count++;
    }
  });
  if (count < 2) throw new Error('Er zijn minimaal twee geldige positieparen nodig.');
}

/**
 * Pixels are relative to the tracked pivot, x right/y down. Retain invalid rows
 * as gaps; their returned coordinates are null, never zero or interpolations.
 * Comma CSV and semicolon CSV (including Dutch decimal commas) are supported.
 */
export function parsePathCSV(text) {
  if (typeof text !== 'string') throw new Error('De CSV-inhoud moet tekst zijn.');
  const records = text.replace(/^\uFEFF/, '').split(/\r\n|\n|\r/)
    .map((line, i) => ({ line: line.trim(), number: i + 1 }))
    .filter(r => r.line && !r.line.startsWith('#'));
  if (!records.length) throw new Error('Het padbestand is leeg.');
  const separator = records[0].line.includes(';') ? ';' : ',';
  const headers = splitRecord(records[0].line, separator, records[0].number).map(h => h.toLowerCase());
  if (headers.some(h => !h) || new Set(headers).size !== headers.length) throw new Error('Lege of dubbele CSV-kolomnaam.');
  for (const h of HEADERS) if (!headers.includes(h)) throw new Error(`Verplichte CSV-kolom ontbreekt: ${h}.`);
  const rows = records.slice(1).map(record => {
    const fields = splitRecord(record.line, separator, record.number);
    if (fields.length !== headers.length) throw new Error(`Regel ${record.number}: onjuist aantal CSV-velden.`);
    const read = (name, allowBlank = false) => {
      const raw = fields[headers.indexOf(name)];
      if (!raw && allowBlank) return null;
      const valueText = separator === ';' ? raw.replace(',', '.') : raw;
      if (!NUMBER.test(valueText) || !Number.isFinite(Number(valueText))) throw new Error(`Regel ${record.number}: ${name} is geen eindig getal.`);
      return Number(valueText);
    };
    const t = read('t_video_s'), frame = read('frame'), flag = read('valid');
    if (flag !== 0 && flag !== 1) throw new Error(`Regel ${record.number}: valid moet 0 of 1 zijn.`);
    const row = { t, frame, valid: flag === 1 };
    for (const key of COORDS) {
      const value = read(`${key}_px`, !row.valid);
      row[key] = row.valid ? value : null;
    }
    return row;
  });
  validateMeasured(rows);
  return rows;
}

function validateSimulation(samples) {
  if (!Array.isArray(samples)) throw new Error('Simulatiepad moet een array zijn.');
  samples.forEach((s, i) => {
    if (!s || typeof s !== 'object') throw new Error('Ongeldig simulatiemeetpunt.');
    finite(s.t, 'Simulatietijd'); finite(s.theta1, 'Simulatiehoek 1'); finite(s.theta2, 'Simulatiehoek 2');
    if (s.t < 0 || (i && s.t <= samples[i - 1].t)) throw new Error('Simulatietijden moeten niet-negatief zijn en strikt toenemen.');
  });
}

/**
 * modelTime = (videoTime-offsetVideo)/timeFactor. No physical time calibration
 * is inferred. Output t is model time for both panels.
 * Measured y is inverted to up. With pixelsPerMeter, rotate by cameraRollDeg
 * COUNTERCLOCKWISE in x-right/y-up, then divide by pixelsPerMeter. Without a
 * scale, retain the unrotated pixel image. This is not perspective correction.
 * Model path is always meters. Fractions select markers along the rods; marker
 * 2 starts at the true hinge, regardless of marker1Fraction.
 */
export function makePathComparison(measured, simulationSamples, options = {}) {
  validateMeasured(measured);
  validateSimulation(simulationSamples);
  const p = { timeFactor: 1, offsetVideo: 0, marker1Fraction: 1, marker2Fraction: 1,
    pixelsPerMeter: null, cameraRollDeg: 0, ...options };
  for (const key of ['timeFactor', 'maxTime', 's1', 's2']) {
    if (!(finite(p[key], key) > 0)) throw new Error(`${key} moet groter zijn dan nul.`);
  }
  if (finite(p.offsetVideo, 'offsetVideo') < 0) throw new Error('offsetVideo mag niet negatief zijn.');
  for (const key of ['marker1Fraction', 'marker2Fraction']) {
    if (finite(p[key], key) < 0 || p[key] > 1) throw new Error(`${key} moet tussen 0 en 1 liggen.`);
  }
  finite(p.cameraRollDeg, 'cameraRollDeg');
  const scaled = p.pixelsPerMeter !== null;
  if (scaled && !(finite(p.pixelsPerMeter, 'pixelsPerMeter') > 0)) throw new Error('pixelsPerMeter moet groter zijn dan nul.');
  const roll = p.cameraRollDeg % 360 * Math.PI / 180;
  const cosine = Math.cos(roll), sine = Math.sin(roll);
  const flags = { hasOverlap: false, scaled, rotationApplied: scaled && roll !== 0,
    hasGaps: false, measuredValidCount: 0, measuredInvalidCount: 0, excludedCount: measured.length };
  const result = { measuredPath: [], modelPath: [], unit: scaled ? 'm' : 'px', modelUnit: 'm',
    timeRange: null, flags, warnings: [] };
  if (!scaled && roll !== 0) result.warnings.push('De opgegeven rotatie is zonder pixels-per-meter niet toegepast; het meetpaneel toont beeldpixels.');
  if (!simulationSamples.length) return result;
  const simStart = simulationSamples[0].t;
  const simEnd = Math.min(simulationSamples.at(-1).t, p.maxTime);
  const candidates = measured.flatMap(row => {
    const t = finite((row.t - p.offsetVideo) / p.timeFactor, 'Omgerekende meettijd');
    // RK time accumulation can put an endpoint a few ulps below its requested
    // duration. Snap only sub-nanosecond roundoff; never extrapolate a path.
    if (t < simStart - 1e-10 || t > simEnd + 1e-10 || simStart > simEnd) return [];
    return [{ ...row, t: Math.max(simStart, Math.min(simEnd, t)), valid: Boolean(row.valid) }];
  });
  const firstValid = candidates.findIndex(r => r.valid);
  let lastValid = -1;
  for (let i = candidates.length - 1; i >= 0; i--) if (candidates[i].valid) { lastValid = i; break; }
  if (firstValid < 0) return result;
  // Never fabricate measurements at an arbitrary window boundary. Trim both
  // panels to the first and last actual valid pair in the requested overlap.
  const rows = candidates.slice(firstValid, lastValid + 1);
  const start = rows[0].t, end = rows.at(-1).t;
  const transform = (x, yDown) => {
    const y = -yDown;
    if (!scaled) return [x, y];
    return [finite((cosine * x - sine * y) / p.pixelsPerMeter, 'Getransformeerde x'),
      finite((sine * x + cosine * y) / p.pixelsPerMeter, 'Getransformeerde y')];
  };
  result.measuredPath = rows.map((row, i) => {
    const breakBefore = i > 0 && (!rows[i - 1].valid || row.frame !== rows[i - 1].frame + 1);
    if (!row.valid) return { t: row.t, frame: row.frame, valid: false,
      x1: null, y1: null, x2: null, y2: null, breakBefore };
    const [x1, y1] = transform(row.x1, row.y1), [x2, y2] = transform(row.x2, row.y2);
    return { t: row.t, frame: row.frame, valid: true, x1, y1, x2, y2, breakBefore };
  });
  const modelPoint = (t, a, b) => {
    const x1 = p.marker1Fraction * p.s1 * Math.sin(a);
    const y1 = -p.marker1Fraction * p.s1 * Math.cos(a);
    const x2 = p.s1 * Math.sin(a) + p.marker2Fraction * p.s2 * Math.sin(b);
    const y2 = -p.s1 * Math.cos(a) - p.marker2Fraction * p.s2 * Math.cos(b);
    [x1, y1, x2, y2].forEach(v => finite(v, 'Modelpositie'));
    return { t, valid: true, x1, y1, x2, y2 };
  };
  const pointAt = t => {
    let low = 0, high = simulationSamples.length - 1;
    while (high - low > 1) {
      const mid = (low + high) >> 1;
      if (simulationSamples[mid].t <= t) low = mid; else high = mid;
    }
    const a = simulationSamples[low], b = simulationSamples[high];
    const f = b.t > a.t ? (t - a.t) / (b.t - a.t) : 0;
    return modelPoint(t, a.theta1 + f * (b.theta1 - a.theta1), a.theta2 + f * (b.theta2 - a.theta2));
  };
  result.modelPath = [pointAt(start), ...simulationSamples
    .filter(s => s.t > start && s.t < end).map(s => modelPoint(s.t, s.theta1, s.theta2))];
  if (end > start) result.modelPath.push(pointAt(end));
  result.timeRange = { start, end };
  flags.hasOverlap = true;
  flags.hasGaps = result.measuredPath.some(r => !r.valid || r.breakBefore);
  flags.measuredValidCount = rows.filter(r => r.valid).length;
  flags.measuredInvalidCount = rows.length - flags.measuredValidCount;
  flags.excludedCount = measured.length - rows.length;
  if (flags.measuredValidCount === 1) result.warnings.push('In het gedeelde tijdvenster ligt slechts één geldig positiepaar; er is geen gemeten padsegment.');
  return result;
}
