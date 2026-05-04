import { Router } from 'express';
import { randomUUID } from 'crypto';
import db from '../db/client.js';
import { requireAuth, loadAppContext } from '../middleware/auth.js';
import { searchMeds, getMedDetails } from '../services/rxnorm.js';

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
function calcDaysRemaining(totalQuantity, refillThreshold, scheduleRaw) {
  if (!scheduleRaw || totalQuantity <= 0) {
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

  const daysRemaining = Math.floor(totalQuantity / dailyDose);
  const needsRefill = daysRemaining <= refillThreshold;
  return { daysRemaining, needsRefill };
}


/* ────────────────────────────────────────────────────────────
   RxNorm search autocomplete
   GET /api/meds/search?q=<term>
   ──────────────────────────────────────────────────────────── */

router.get('/api/meds/search', requireAuth, loadAppContext, async (req, res) => {
  sseHeaders(res);

  const q = String(req.query.q ?? '').trim();

  if (q.length < 2) {
    res.write('event: datastar-merge-fragments\n');
    res.write('data: merge morph\n');
    res.write('data: selector #med-results\n');
    res.write('data: fragments <div id="med-results" class="med-results"></div>\n');
    res.write('\n');
    return res.end();
  }

  const results = await searchMeds(q);

  const buttons = results
    .map(
      (r) =>
        `<button type="button" data-on-click="@get('/api/meds/details/${esc(r.rxcui)}')" aria-label="Select ${esc(r.name)}">${esc(r.name)}</button>`
    )
    .join('');

  res.write('event: datastar-merge-fragments\n');
  res.write('data: merge morph\n');
  res.write('data: selector #med-results\n');
  res.write(`data: fragments <div id="med-results" class="med-results" role="listbox" aria-label="Medication suggestions">${buttons}</div>\n`);
  res.write('\n');
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
    res.write('event: datastar-merge-signals\n');
    res.write('data: signals {"medName":"","medRxcui":"","medStrength":"","medForm":""}\n');
    res.write('\n');
    return res.end();
  }

  const signals = JSON.stringify({
    medName: details.name,
    medRxcui: details.rxcui,
    medStrength: details.strength,
    medForm: details.form,
  });

  res.write('event: datastar-merge-signals\n');
  res.write(`data: signals ${signals}\n`);
  res.write('\n');

  res.write('event: datastar-merge-fragments\n');
  res.write('data: merge morph\n');
  res.write('data: selector #med-results\n');
  res.write('data: fragments <div id="med-results" class="med-results"></div>\n');
  res.write('\n');

  res.end();
});


/* ────────────────────────────────────────────────────────────
   Medications list page
   GET /app/medications
   ──────────────────────────────────────────────────────────── */

router.get('/app/medications', requireAuth, loadAppContext, async (req, res) => {
  const { rows } = await db.execute({
    sql: `SELECT m.id, m.name, m.rxcui, m.strength, m.form, m.instructions,
                 m.total_quantity, m.refill_threshold, m.active, m.created_at,
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
      Number(row.refill_threshold ?? 7),
      row.schedule_raw ? String(row.schedule_raw) : null
    );
    return {
      id: String(row.id),
      name: String(row.name),
      rxcui: row.rxcui ? String(row.rxcui) : null,
      strength: row.strength ? String(row.strength) : '',
      form: row.form ? String(row.form) : '',
      instructions: row.instructions ? String(row.instructions) : '',
      totalQuantity: Number(row.total_quantity ?? 0),
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
  });
});


/* ────────────────────────────────────────────────────────────
   Create a medication
   POST /api/medications
   ──────────────────────────────────────────────────────────── */

router.post('/api/medications', requireAuth, loadAppContext, async (req, res) => {
  const body = req.body;

  const name = String(body.name ?? '').trim();
  if (!name) {
    return res.redirect('/app/medications/new?error=name-required');
  }

  const rxcui = String(body.rxcui ?? '').trim() || null;
  const strength = String(body.strength ?? '').trim() || null;
  const form = String(body.form ?? '').trim() || null;
  const instructions = String(body.instructions ?? '').trim() || null;
  const totalQuantity = Math.max(0, parseInt(body.total_quantity, 10) || 0);
  const refillThreshold = Math.max(1, parseInt(body.refill_threshold, 10) || 7);

  const medId = randomUUID();
  const now = new Date().toISOString();

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

  /** @type {Array<{sql: string, args: Array<string|number>}>} */
  const statements = [
    {
      sql: `INSERT INTO medications
              (id, profile_id, rxcui, name, strength, form, instructions,
               total_quantity, refill_threshold, active, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      args: [medId, req.profile.id, rxcui, name, strength, form, instructions, totalQuantity, refillThreshold, now],
    },
    ...scheduleEntries.map(({ slotId, doseQty }) => ({
      sql: 'INSERT INTO schedules (id, med_id, slot_id, days, dose_qty) VALUES (?, ?, ?, ?, ?)',
      args: [randomUUID(), medId, slotId, '[0,1,2,3,4,5,6]', doseQty],
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
    strength: row.strength ? String(row.strength) : '',
    form: row.form ? String(row.form) : '',
    instructions: row.instructions ? String(row.instructions) : '',
    totalQuantity: Number(row.total_quantity ?? 0),
    refillThreshold: Number(row.refill_threshold ?? 7),
    active: Number(row.active),
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
    med.refillThreshold,
    scheduleRaw
  );

  res.render('pages/medications-detail', {
    title: med.name,
    path: '/app/medications',
    profile: req.profile,
    profiles: req.profiles,
    med,
    slots,
    schedules,
    scheduleMap,
    daysRemaining,
    needsRefill,
    extraCss: '/css/medications.css',
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
    res.write('event: datastar-merge-signals\n');
    res.write('data: signals {"saveStatus":"error"}\n');
    res.write('\n');
    return res.end();
  }

  const body = req.body;

  const name = String(body.name ?? '').trim();
  if (!name) {
    res.write('event: datastar-merge-signals\n');
    res.write('data: signals {"saveStatus":"error"}\n');
    res.write('\n');
    return res.end();
  }

  const strength = String(body.strength ?? '').trim() || null;
  const form = String(body.form ?? '').trim() || null;
  const instructions = String(body.instructions ?? '').trim() || null;
  const totalQuantity = Math.max(0, parseInt(body.total_quantity, 10) || 0);
  const refillThreshold = Math.max(1, parseInt(body.refill_threshold, 10) || 7);

  await db.execute({
    sql: `UPDATE medications
          SET name = ?, strength = ?, form = ?, instructions = ?,
              total_quantity = ?, refill_threshold = ?
          WHERE id = ?`,
    args: [name, strength, form, instructions, totalQuantity, refillThreshold, id],
  });

  res.write('event: datastar-merge-signals\n');
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
    sql: 'UPDATE medications SET total_quantity = total_quantity + ? WHERE id = ?',
    args: [qtyAdd, id],
  });

  res.redirect(`/app/medications/${id}`);
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
