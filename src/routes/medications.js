import { Router } from 'express';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { unlinkSync } from 'fs';
import multer from 'multer';
import db from '../db/client.js';
import { requireAuth, loadAppContext } from '../middleware/auth.js';
import { requirePro } from '../middleware/plan.js';
import { searchMeds, getMedDetails } from '../services/rxnorm.js';
import { uploadImage, signImageUrl, destroyImage } from '../services/cloudinary.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir  = join(__dirname, '..', '..', 'public');

const imageFileFilter = (_req, file, cb) => {
  if (file.mimetype.startsWith('image/')) return cb(null, true);
  cb(new Error('Only image files are allowed'));
};

/** Memory-buffered multer for detail-page single upload */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: imageFileFilter,
});

/** Memory-buffered multer for new-medication multi-upload */
const uploadFlat = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: imageFileFilter,
});

const router = Router();

/**
 * Set SSE headers on a response.
 *
 * @param {import('express').Response} res
 */
function sseHeaders(res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
}

/**
 * Escape HTML special characters to prevent XSS in inline fragments.
 *
 * @param {string} str
 * @returns {string}
 */
function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Calculate days remaining and refill flag for a medication given its
 * schedule_raw string from GROUP_CONCAT.
 *
 * schedule_raw format: "slot_id:dose_qty:days_json,slot_id:dose_qty:days_json,..."
 *
 * @param {number} totalQuantity
 * @param {number} refillThreshold
 * @param {string | null} scheduleRaw
 * @returns {{ daysRemaining: number | null, needsRefill: boolean }}
 */
/**
 * @param {string} s
 * @returns {string}
 */
function capFirst(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

const STRENGTH_UNITS = ['MG', 'MCG', 'G', 'IU', 'MEQ', 'MG/ML', 'MCG/ML', '%'];

/**
 * Parse a strength string (e.g. "5 MG") into its numeric value and unit.
 *
 * @param {string} s
 * @returns {{value: string, unit: string, unitCustom: string}}
 */
function parseStrength(s) {
  const str = String(s ?? '').trim();
  if (!str) return { value: '', unit: '', unitCustom: '' };
  const match = str.match(/^([0-9]*\.?[0-9]+)\s*(.*)$/);
  const raw = match ? match[1] : '';
  const val = raw.startsWith('.') ? '0' + raw : raw;
  const rawUnit = (match ? match[2] : str).trim().toUpperCase();
  if (!rawUnit) return { value: val, unit: '', unitCustom: '' };
  if (STRENGTH_UNITS.includes(rawUnit)) return { value: val, unit: rawUnit, unitCustom: '' };
  return { value: val, unit: 'other', unitCustom: rawUnit };
}

/**
 * Combine split strength value and unit back into a single string for storage.
 *
 * @param {string} value
 * @param {string} unit
 * @param {string} unitCustom
 * @returns {string | null}
 */
function combineStrength(value, unit, unitCustom) {
  const v = String(value ?? '').trim();
  const u = unit === 'other' ? String(unitCustom ?? '').trim() : String(unit ?? '').trim();
  if (!v) return null;
  return u ? `${v} ${u}` : v;
}

const NOT_IN_ORGANIZER_FORMS = new Set(['inhaler', 'liquid', 'drops', 'patch', 'spray', 'cream', 'ointment', 'suppository', 'injection', 'powder']);

/**
 * @param {string | null} form
 * @returns {boolean}
 */
function isNotInOrganizer(form) {
  return !!form && NOT_IN_ORGANIZER_FORMS.has(String(form).toLowerCase());
}

/**
 * @param {string} medId
 * @returns {Promise<Array<{id:string, source:string, url:string}>>}
 */
async function loadMedImages(medId) {
  const { rows } = await db.execute({
    sql: 'SELECT id, source, url FROM medication_images WHERE med_id = ? ORDER BY sort_order ASC, created_at ASC',
    args: [medId],
  });
  return rows.map((r) => {
    const source = String(r.source);
    const rawUrl = String(r.url);
    return {
      id:     String(r.id),
      source,
      url:    source === 'cloudinary' ? signImageUrl(rawUrl) : rawUrl,
    };
  });
}

function calcDaysRemaining(organizerQty, bottleQty, refillThreshold, scheduleRaw) {
  const totalQty = (organizerQty ?? 0) + (bottleQty ?? 0);
  if (!scheduleRaw || totalQty <= 0) {
    return { daysRemaining: null, needsRefill: false };
  }

  let dailyDose = 0;

  for (const part of scheduleRaw.split(',')) {
    const segments = part.split(':');
    if (segments.length < 3) continue;
    const doseQty = Number(segments[1]) || 1;
    let days;
    try {
      days = JSON.parse(segments.slice(2).join(':'));
    } catch {
      days = [0, 1, 2, 3, 4, 5, 6];
    }
    const daysPerWeek = Array.isArray(days) ? days.length : 7;
    dailyDose += doseQty * (daysPerWeek / 7);
  }

  if (dailyDose <= 0) return { daysRemaining: null, needsRefill: false };

  const daysRemaining = Math.floor(totalQty / dailyDose);
  const needsRefill = daysRemaining <= refillThreshold;
  return { daysRemaining, needsRefill };
}


/* ────────────────────────────────────────────────────────────
   RxNorm search autocomplete
   POST /api/meds/search  (body: Datastar signals JSON)
   ──────────────────────────────────────────────────────────── */

router.post('/api/meds/search', requireAuth, loadAppContext, async (req, res) => {
  sseHeaders(res);

  const q = String(req.body.medQuery ?? '').trim();

  let html = '<div id="med-results" class="med-results"></div>';

  if (q.length >= 2) {
    const results = await searchMeds(q);
    if (results.length) {
      const items = results
        .map((r) => `<button type="button" data-on:click="@get('/api/meds/details/${esc(r.rxcui)}')" aria-label="Select ${esc(r.name)}">${esc(r.name)}</button>`)
        .join('');
      html = `<div id="med-results" class="med-results" role="listbox" aria-label="Medication suggestions">${items}</div>`;
    }
  }

  res.write(`event: datastar-patch-elements\ndata: mode outer\ndata: elements ${html}\n\n`);
  res.end();
});


/* ────────────────────────────────────────────────────────────
   RxNorm details for a selected medication
   GET /api/meds/details/:rxcui
   ──────────────────────────────────────────────────────────── */

router.get('/api/meds/details/:rxcui', requireAuth, loadAppContext, async (req, res) => {
  sseHeaders(res);

  const { rxcui } = req.params;
  const details = await getMedDetails(rxcui);

  if (!details) {
    res.write('event: datastar-patch-signals\ndata: signals {"medName":"","medRxcui":"","medStrengthValue":"","medStrengthUnit":"","medStrengthUnitCustom":"","medForm":""}\n\n');
    return res.end();
  }

  const { value: sv, unit: su, unitCustom: suc } = parseStrength(details.strength);
  const signals = JSON.stringify({
    medName:               capFirst(details.name),
    medRxcui:              details.rxcui,
    medStrengthValue:      sv,
    medStrengthUnit:       su,
    medStrengthUnitCustom: suc,
    medForm:               details.form,
  });

  res.write(`event: datastar-patch-signals\ndata: signals ${signals}\n\n`);
  res.write('event: datastar-patch-elements\ndata: mode outer\ndata: elements <div id="med-results" class="med-results"></div>\n\n');
  res.end();
});


/* ────────────────────────────────────────────────────────────
   Saved images for a medication (JSON)
   GET /api/medications/:id/images
   ──────────────────────────────────────────────────────────── */

router.get('/api/medications/:id/images', requireAuth, loadAppContext, async (req, res) => {
  const { id } = req.params;
  const ownerCheck = await db.execute({
    sql: 'SELECT id FROM medications WHERE id = ? AND profile_id = ?',
    args: [id, req.profile.id],
  });
  if (!ownerCheck.rows.length) return res.json([]);
  res.json(await loadMedImages(id));
});



/* ────────────────────────────────────────────────────────────
   Medications list page
   GET /app/medications
   ──────────────────────────────────────────────────────────── */

router.get('/app/medications', requireAuth, loadAppContext, async (req, res) => {
  const { rows } = await db.execute({
    sql: `SELECT m.id, m.name, m.rxcui, m.strength, m.form, m.instructions,
                 m.total_quantity, m.bottle_quantity, m.refill_threshold, m.active, m.created_at,
                 GROUP_CONCAT(s.slot_id || ':' || s.dose_qty || ':' || s.days) AS schedule_raw
          FROM medications m
          LEFT JOIN schedules s ON s.med_id = m.id
          WHERE m.profile_id = ? AND m.active = 1
          GROUP BY m.id
          ORDER BY m.created_at ASC`,
    args: [req.profile.id],
  });

  const meds = rows.map((row) => {
    const { daysRemaining, needsRefill } = calcDaysRemaining(
      Number(row.total_quantity ?? 0),
      Number(row.bottle_quantity ?? 0),
      Number(row.refill_threshold ?? 7),
      row.schedule_raw ? String(row.schedule_raw) : null
    );
    return {
      id: String(row.id),
      name: String(row.name),
      rxcui: row.rxcui ? String(row.rxcui) : null,
      strength: row.strength ? String(row.strength).replace(/^\./, '0.') : '',
      form: row.form ? String(row.form) : '',
      instructions: row.instructions ? String(row.instructions) : '',
      totalQuantity: Number(row.total_quantity ?? 0),
      bottleQuantity: Number(row.bottle_quantity ?? 0),
      refillThreshold: Number(row.refill_threshold ?? 7),
      daysRemaining,
      needsRefill,
    };
  });

  res.render('pages/medications', {
    title: 'Medications',
    path: '/app/medications',
    profile: req.profile,
    profiles: req.profiles,
    meds,
    extraCss: '/css/medications.css',
  });
});


/* ────────────────────────────────────────────────────────────
   Medication list print page
   GET /app/medications/print
   (registered before /:id to avoid path collision)
   ──────────────────────────────────────────────────────────── */

router.get('/app/medications/print', requireAuth, loadAppContext, async (req, res) => {
  const { rows } = await db.execute({
    sql: `SELECT m.id, m.name, m.strength, m.form,
                 m.total_quantity, m.bottle_quantity, m.refill_threshold,
                 s.slot_id, s.dose_qty, s.days, t.label AS slot_label, t.sort_order
          FROM medications m
          LEFT JOIN schedules s ON s.med_id = m.id
          LEFT JOIN time_slots t ON t.id = s.slot_id
          WHERE m.profile_id = ? AND m.active = 1
          ORDER BY m.created_at ASC, t.sort_order ASC`,
    args: [req.profile.id],
  });

  /** @type {Map<string, {id:string,name:string,strength:string,form:string,totalQuantity:number,bottleQuantity:number,refillThreshold:number,schedules:Array<{slotLabel:string,doseQty:number,days:number[]}>}>} */
  const medsMap = new Map();
  for (const row of rows) {
    const id = String(row.id);
    if (!medsMap.has(id)) {
      medsMap.set(id, {
        id,
        name:           String(row.name),
        strength:       row.strength ? String(row.strength).replace(/^\./, '0.') : '',
        form:           row.form ? String(row.form) : '',
        totalQuantity:  Number(row.total_quantity ?? 0),
        bottleQuantity: Number(row.bottle_quantity ?? 0),
        refillThreshold: Number(row.refill_threshold ?? 7),
        schedules:      [],
      });
    }
    if (row.slot_id) {
      let days;
      try { days = JSON.parse(String(row.days)); } catch { days = [0, 1, 2, 3, 4, 5, 6]; }
      medsMap.get(id).schedules.push({
        slotLabel: String(row.slot_label),
        doseQty:   Number(row.dose_qty ?? 1),
        days,
      });
    }
  }

  const DAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

  const meds = Array.from(medsMap.values()).map((med) => {
    const scheduleRaw = med.schedules.length
      ? med.schedules.map((s) => `x:${s.doseQty}:${JSON.stringify(s.days)}`).join(',')
      : null;
    const { daysRemaining, needsRefill } = calcDaysRemaining(
      med.totalQuantity, med.bottleQuantity, med.refillThreshold, scheduleRaw
    );
    return {
      ...med,
      daysRemaining,
      needsRefill,
      schedules: med.schedules.map((s) => ({
        ...s,
        daysLabel: s.days.length === 7 ? 'Daily' : s.days.map((d) => DAY_LABELS[d]).join(', '),
      })),
    };
  });

  res.render('pages/medications-print', {
    title:   `Medications — ${req.profile.name}`,
    profile: req.profile,
    meds,
  });
});


/* ────────────────────────────────────────────────────────────
   Add medication page
   GET /app/medications/new
   ──────────────────────────────────────────────────────────── */

router.get('/app/medications/new', requireAuth, loadAppContext, async (req, res) => {
  const { rows } = await db.execute({
    sql: 'SELECT id, label, sort_order FROM time_slots WHERE profile_id = ? ORDER BY sort_order ASC',
    args: [req.profile.id],
  });

  const slots = rows.map((r) => ({
    id: String(r.id),
    label: String(r.label),
    sortOrder: Number(r.sort_order),
  }));

  res.render('pages/medications-new', {
    title: 'Add Medication',
    path: '/app/medications',
    profile: req.profile,
    profiles: req.profiles,
    slots,
    extraCss: '/css/medications.css',
    scripts: '<script type="module" src="/js/medications-new.js"></script>',
  });
});


/* ────────────────────────────────────────────────────────────
   Create a medication
   POST /api/medications
   ──────────────────────────────────────────────────────────── */

router.post('/api/medications', requireAuth, loadAppContext, uploadFlat.array('photos', 10), async (req, res) => {
  const body = req.body;

  const name = capFirst(String(body.name ?? '').trim());
  if (!name) {
    for (const f of req.files ?? []) try { unlinkSync(f.path); } catch {}
    return res.redirect('/app/medications/new?error=name-required');
  }

  const rxcui = String(body.rxcui ?? '').trim() || null;
  const strength = combineStrength(body.strengthValue, body.strengthUnit, body.strengthUnitCustom);
  const form = String(body.form ?? '').trim() || null;
  const instructions = String(body.instructions ?? '').trim() || null;
  const totalQuantity = Math.max(0, parseInt(body.totalQuantity, 10) || 0);
  const bottleQuantity = Math.max(0, parseInt(body.bottleQuantity, 10) || 0);
  const refillThreshold = Math.max(1, parseInt(body.refillThreshold, 10) || 7);

  const medId = randomUUID();
  const now = new Date().toISOString();
  const notInOrganizer = isNotInOrganizer(form) ? 1 : 0;

  const slotRows = await db.execute({
    sql: 'SELECT id FROM time_slots WHERE profile_id = ?',
    args: [req.profile.id],
  });

  const validSlotIds = new Set(slotRows.rows.map((r) => String(r.id)));

  /** @type {Array<{slotId: string, doseQty: number}>} */
  const scheduleEntries = [];

  for (const [key, val] of Object.entries(body)) {
    if (!key.startsWith('slot_')) continue;
    if (val !== '1') continue;
    const slotId = key.slice(5);
    if (!validSlotIds.has(slotId)) continue;
    const doseQty = Math.max(1, parseInt(body[`dose_${slotId}`], 10) || 1);
    scheduleEntries.push({ slotId, doseQty });
  }

  /** @type {Array<string>} */
  let imageUrls = [];
  try { imageUrls = JSON.parse(body.imageUrls || '[]'); } catch {}
  imageUrls = imageUrls.filter((u) => typeof u === 'string' && /^https?:\/\/.+/.test(u));

  const uploadedPublicIds = await Promise.all(
    (req.files ?? []).map(async (f) => {
      try {
        const { publicId } = await uploadImage(f.buffer, `pill-plan/${medId}`);
        return publicId;
      } catch {
        return null;
      }
    })
  );

  /** @type {Array<{sql: string, args: Array<string|number>}>} */
  const statements = [
    {
      sql: `INSERT INTO medications
              (id, profile_id, rxcui, name, strength, form, instructions,
               total_quantity, bottle_quantity, refill_threshold, not_in_organizer, active, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      args: [medId, req.profile.id, rxcui, name, strength, form, instructions, totalQuantity, bottleQuantity, refillThreshold, notInOrganizer, now],
    },
    ...scheduleEntries.map(({ slotId, doseQty }) => ({
      sql: 'INSERT INTO schedules (id, med_id, slot_id, days, dose_qty) VALUES (?, ?, ?, ?, ?)',
      args: [randomUUID(), medId, slotId, '[0,1,2,3,4,5,6]', doseQty],
    })),
    ...uploadedPublicIds.filter(Boolean).map((publicId) => ({
      sql: 'INSERT INTO medication_images (id, med_id, source, url, sort_order, created_at) VALUES (?, ?, ?, ?, 0, ?)',
      args: [randomUUID(), medId, 'cloudinary', publicId, now],
    })),
    ...imageUrls.map((url) => ({
      sql: 'INSERT INTO medication_images (id, med_id, source, url, sort_order, created_at) VALUES (?, ?, ?, ?, 0, ?)',
      args: [randomUUID(), medId, 'url', url, now],
    })),
  ];

  await db.batch(statements, 'write');

  res.redirect('/app/medications');
});


/* ────────────────────────────────────────────────────────────
   Medication detail / edit page
   GET /app/medications/:id
   ──────────────────────────────────────────────────────────── */

router.get('/app/medications/:id', requireAuth, loadAppContext, async (req, res) => {
  const { id } = req.params;

  const medResult = await db.execute({
    sql: 'SELECT * FROM medications WHERE id = ? AND profile_id = ?',
    args: [id, req.profile.id],
  });

  if (!medResult.rows.length) {
    return res.redirect('/app/medications');
  }

  const row = medResult.rows[0];
  const med = {
    id: String(row.id),
    name: String(row.name),
    rxcui: row.rxcui ? String(row.rxcui) : null,
    strength: row.strength ? String(row.strength).replace(/^\./, '0.') : '',
    form: row.form ? String(row.form) : '',
    instructions: row.instructions ? String(row.instructions) : '',
    totalQuantity: Number(row.total_quantity ?? 0),
    bottleQuantity: Number(row.bottle_quantity ?? 0),
    refillThreshold: Number(row.refill_threshold ?? 7),
    active: Number(row.active),
    notInOrganizer: Number(row.not_in_organizer ?? 0) === 1,
  };

  const schedulesResult = await db.execute({
    sql: `SELECT s.id, s.slot_id, s.dose_qty, s.days, t.label, t.sort_order
          FROM schedules s
          JOIN time_slots t ON t.id = s.slot_id
          WHERE s.med_id = ?
          ORDER BY t.sort_order`,
    args: [id],
  });

  const schedules = schedulesResult.rows.map((r) => ({
    id: String(r.id),
    slotId: String(r.slot_id),
    doseQty: Number(r.dose_qty ?? 1),
    days: r.days ? String(r.days) : '[0,1,2,3,4,5,6]',
    label: String(r.label),
    sortOrder: Number(r.sort_order),
  }));

  const slotsResult = await db.execute({
    sql: 'SELECT id, label, sort_order FROM time_slots WHERE profile_id = ? ORDER BY sort_order ASC',
    args: [req.profile.id],
  });

  const slots = slotsResult.rows.map((r) => ({
    id: String(r.id),
    label: String(r.label),
    sortOrder: Number(r.sort_order),
  }));

  /** @type {Record<string, {doseQty: number, days: number[]}>} */
  const scheduleMap = {};
  for (const s of schedules) {
    let days;
    try { days = JSON.parse(s.days); } catch { days = [0,1,2,3,4,5,6]; }
    scheduleMap[s.slotId] = { doseQty: s.doseQty, days };
  }

  const scheduleRaw = schedules.length
    ? schedules.map((s) => `${s.slotId}:${s.doseQty}:${s.days}`).join(',')
    : null;

  const { daysRemaining, needsRefill } = calcDaysRemaining(
    med.totalQuantity,
    med.bottleQuantity,
    med.refillThreshold,
    scheduleRaw
  );

  const organizerCount = req.profile.organizerCount ?? 1;
  let pillsNeeded = 0;
  for (const s of schedules) {
    let days;
    try { days = JSON.parse(s.days); } catch { days = [0,1,2,3,4,5,6]; }
    const daysCount = Array.isArray(days) ? days.length : 7;
    pillsNeeded += s.doseQty * daysCount * organizerCount;
  }

  const { value: strengthValue, unit: strengthUnit, unitCustom: strengthUnitCustom } = parseStrength(med.strength);
  const images = await loadMedImages(id);

  res.render('pages/medications-detail', {
    title: med.name,
    path: '/app/medications',
    profile: req.profile,
    profiles: req.profiles,
    user: req.user,
    med,
    strengthValue,
    strengthUnit,
    strengthUnitCustom,
    slots,
    schedules,
    scheduleMap,
    daysRemaining,
    needsRefill,
    pillsNeeded,
    organizerCount,
    images,
    extraCss: '/css/medications.css',
    scripts: '<script type="module" src="/js/medications-detail.js"></script>',
  });
});


/* ────────────────────────────────────────────────────────────
   Autosave medication details
   POST /api/medications/:id
   ──────────────────────────────────────────────────────────── */

router.post('/api/medications/:id', requireAuth, loadAppContext, async (req, res) => {
  const { id } = req.params;

  const ownerCheck = await db.execute({
    sql: 'SELECT id FROM medications WHERE id = ? AND profile_id = ?',
    args: [id, req.profile.id],
  });

  sseHeaders(res);

  if (!ownerCheck.rows.length) {
    res.write('event: datastar-patch-signals\n');
    res.write('data: signals {"saveStatus":"error"}\n');
    res.write('\n');
    return res.end();
  }

  const body = req.body;

  const name = capFirst(String(body.name ?? '').trim());
  if (!name) {
    res.write('event: datastar-patch-signals\n');
    res.write('data: signals {"saveStatus":"error"}\n');
    res.write('\n');
    return res.end();
  }

  const strength = combineStrength(body.strengthValue, body.strengthUnit, body.strengthUnitCustom);
  const form = String(body.form ?? '').trim() || null;
  const instructions = String(body.instructions ?? '').trim() || null;
  const totalQuantity = Math.max(0, parseInt(body.totalQuantity, 10) || 0);
  const bottleQuantity = Math.max(0, parseInt(body.bottleQuantity, 10) || 0);
  const refillThreshold = Math.max(1, parseInt(body.refillThreshold, 10) || 7);
  const notInOrganizer = body.notInOrganizer ? 1 : 0;

  await db.execute({
    sql: `UPDATE medications
          SET name = ?, strength = ?, form = ?, instructions = ?,
              total_quantity = ?, bottle_quantity = ?, refill_threshold = ?,
              not_in_organizer = ?
          WHERE id = ?`,
    args: [name, strength, form, instructions, totalQuantity, bottleQuantity, refillThreshold, notInOrganizer, id],
  });

  res.write('event: datastar-patch-signals\n');
  res.write('data: signals {"saveStatus":"saved"}\n');
  res.write('\n');
  res.end();
});


/* ────────────────────────────────────────────────────────────
   Update schedule for a medication
   POST /api/medications/:id/schedule
   ──────────────────────────────────────────────────────────── */

router.post('/api/medications/:id/schedule', requireAuth, loadAppContext, async (req, res) => {
  const { id } = req.params;

  const ownerCheck = await db.execute({
    sql: 'SELECT id FROM medications WHERE id = ? AND profile_id = ?',
    args: [id, req.profile.id],
  });

  if (!ownerCheck.rows.length) {
    return res.redirect('/app/medications');
  }

  const body = req.body;

  const slotRows = await db.execute({
    sql: 'SELECT id FROM time_slots WHERE profile_id = ?',
    args: [req.profile.id],
  });

  const validSlotIds = new Set(slotRows.rows.map((r) => String(r.id)));

  /** @type {Array<{slotId: string, doseQty: number, days: number[]}>} */
  const scheduleEntries = [];

  for (const [key, val] of Object.entries(body)) {
    if (!key.startsWith('slot_')) continue;
    if (val !== '1') continue;
    const slotId = key.slice(5);
    if (!validSlotIds.has(slotId)) continue;
    const doseQty = Math.max(1, parseInt(body[`dose_${slotId}`], 10) || 1);
    const days = [0,1,2,3,4,5,6].filter((d) => body[`day_${slotId}_${d}`] === '1');
    scheduleEntries.push({ slotId, doseQty, days: days.length ? days : [0,1,2,3,4,5,6] });
  }

  /** @type {Array<{sql: string, args: Array<string|number>}>} */
  const statements = [
    {
      sql: 'DELETE FROM schedules WHERE med_id = ?',
      args: [id],
    },
    ...scheduleEntries.map(({ slotId, doseQty, days }) => ({
      sql: 'INSERT INTO schedules (id, med_id, slot_id, days, dose_qty) VALUES (?, ?, ?, ?, ?)',
      args: [randomUUID(), id, slotId, JSON.stringify(days), doseQty],
    })),
  ];

  await db.batch(statements, 'write');

  if (req.headers['x-fetch'] === '1') return res.status(204).end();
  res.redirect(`/app/medications/${id}`);
});


/* ────────────────────────────────────────────────────────────
   Log a refill (add to supply)
   POST /api/medications/:id/refill
   ──────────────────────────────────────────────────────────── */

router.post('/api/medications/:id/refill', requireAuth, loadAppContext, async (req, res) => {
  const { id } = req.params;

  const ownerCheck = await db.execute({
    sql: 'SELECT id FROM medications WHERE id = ? AND profile_id = ?',
    args: [id, req.profile.id],
  });

  if (!ownerCheck.rows.length) {
    return res.redirect('/app/medications');
  }

  const qtyAdd = Math.max(1, parseInt(req.body.qty_add, 10) || 1);

  await db.execute({
    sql: 'UPDATE medications SET bottle_quantity = bottle_quantity + ? WHERE id = ?',
    args: [qtyAdd, id],
  });

  res.redirect(`/app/medications/${id}`);
});


/* ────────────────────────────────────────────────────────────
   Fill organizer from bottle
   POST /api/medications/:id/fill-organizer
   ──────────────────────────────────────────────────────────── */

router.post('/api/medications/:id/fill-organizer', requireAuth, loadAppContext, async (req, res) => {
  const { id } = req.params;

  const medResult = await db.execute({
    sql: 'SELECT id, total_quantity, bottle_quantity FROM medications WHERE id = ? AND profile_id = ?',
    args: [id, req.profile.id],
  });

  if (!medResult.rows.length) return res.redirect('/app/medications');

  const schedulesResult = await db.execute({
    sql: 'SELECT dose_qty, days FROM schedules WHERE med_id = ?',
    args: [id],
  });

  const organizerCount = req.profile.organizerCount ?? 1;
  let pillsNeeded = 0;
  for (const r of schedulesResult.rows) {
    let days;
    try { days = JSON.parse(String(r.days)); } catch { days = [0,1,2,3,4,5,6]; }
    const daysCount = Array.isArray(days) ? days.length : 7;
    pillsNeeded += (Number(r.dose_qty) || 1) * daysCount * organizerCount;
  }

  const med = medResult.rows[0];
  const totalOnHand = Number(med.total_quantity ?? 0) + Number(med.bottle_quantity ?? 0);
  const newOrganizer = Math.min(pillsNeeded, totalOnHand);
  const newBottle = Math.max(0, totalOnHand - pillsNeeded);

  await db.execute({
    sql: 'UPDATE medications SET total_quantity = ?, bottle_quantity = ? WHERE id = ?',
    args: [newOrganizer, newBottle, id],
  });

  res.redirect(`/app/medications/${id}`);
});



/* ────────────────────────────────────────────────────────────
   Save an image by URL
   POST /api/medications/:id/images/url
   ──────────────────────────────────────────────────────────── */

router.post('/api/medications/:id/images/url', requireAuth, loadAppContext, requirePro('images'), async (req, res) => {
  const { id } = req.params;

  const ownerCheck = await db.execute({
    sql: 'SELECT id FROM medications WHERE id = ? AND profile_id = ?',
    args: [id, req.profile.id],
  });
  if (!ownerCheck.rows.length) return res.status(403).json({ error: 'Not found' });

  const url = String(req.body.url ?? '').trim();
  if (!/^https?:\/\/.+/.test(url)) return res.status(400).json({ error: 'Invalid URL' });

  const imageId = randomUUID();
  await db.execute({
    sql: 'INSERT INTO medication_images (id, med_id, source, url, sort_order, created_at) VALUES (?, ?, ?, ?, 0, ?)',
    args: [imageId, id, 'url', url, new Date().toISOString()],
  });

  res.json({ id: imageId, url, source: 'url' });
});


/* ────────────────────────────────────────────────────────────
   Upload a camera / gallery photo
   POST /api/medications/:id/images/upload
   ──────────────────────────────────────────────────────────── */

router.post('/api/medications/:id/images/upload',
  requireAuth,
  loadAppContext,
  requirePro('images'),
  upload.single('photo'),
  async (req, res) => {
    const { id } = req.params;

    const ownerCheck = await db.execute({
      sql: 'SELECT id FROM medications WHERE id = ? AND profile_id = ?',
      args: [id, req.profile.id],
    });
    if (!ownerCheck.rows.length) return res.status(403).json({ error: 'Not found' });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const { publicId } = await uploadImage(req.file.buffer, `pill-plan/${id}`);
    const signedUrl = signImageUrl(publicId);
    const imageId = randomUUID();
    await db.execute({
      sql: 'INSERT INTO medication_images (id, med_id, source, url, sort_order, created_at) VALUES (?, ?, ?, ?, 0, ?)',
      args: [imageId, id, 'cloudinary', publicId, new Date().toISOString()],
    });

    res.json({ id: imageId, url: signedUrl, source: 'cloudinary' });
  }
);


/* ────────────────────────────────────────────────────────────
   Delete a medication image
   POST /api/medications/:id/images/:imageId/delete
   ──────────────────────────────────────────────────────────── */

router.post('/api/medications/:id/images/:imageId/delete', requireAuth, loadAppContext, requirePro('images'), async (req, res) => {
  const { id, imageId } = req.params;

  const { rows } = await db.execute({
    sql: `SELECT mi.id, mi.source, mi.url
          FROM medication_images mi
          JOIN medications m ON m.id = mi.med_id
          WHERE mi.id = ? AND m.id = ? AND m.profile_id = ?`,
    args: [imageId, id, req.profile.id],
  });

  if (!rows.length) return res.status(404).json({ error: 'Not found' });

  const src = String(rows[0].source);
  if (src === 'upload') {
    const filePath = join(publicDir, String(rows[0].url));
    try { unlinkSync(filePath); } catch {}
  } else if (src === 'cloudinary') {
    try { await destroyImage(String(rows[0].url)); } catch {}
  }

  await db.execute({ sql: 'DELETE FROM medication_images WHERE id = ?', args: [imageId] });

  res.status(204).end();
});


/* ────────────────────────────────────────────────────────────
   Deactivate (soft-delete) a medication
   POST /api/medications/:id/deactivate
   ──────────────────────────────────────────────────────────── */

router.post('/api/medications/:id/deactivate', requireAuth, async (req, res) => {
  const { id } = req.params;

  const { rows } = await db.execute({
    sql: `SELECT m.id
          FROM medications m
          JOIN profiles p ON p.id = m.profile_id
          WHERE m.id = ? AND p.user_id = ?`,
    args: [id, req.user.id],
  });

  if (!rows.length) {
    return res.redirect('/app/medications');
  }

  await db.execute({
    sql: 'UPDATE medications SET active = 0 WHERE id = ?',
    args: [id],
  });

  res.redirect('/app/medications');
});

export default router;
