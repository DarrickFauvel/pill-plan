import { Router } from 'express';
import { randomUUID } from 'crypto';
import db from '../db/client.js';
import { requireAuth, loadAppContext } from '../middleware/auth.js';
import { buildMonthGrid } from '../services/gridBuilder.js';

const router = Router();

/**
 * @param {import('express').Response} res
 */
function sseHeaders(res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
}

/**
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
 * Build a stable cell element ID from UUIDs and a date string.
 *
 * @param {string} medId
 * @param {string} slotId
 * @param {string} takenDate  YYYY-MM-DD
 * @returns {string}
 */
function cellId(medId, slotId, takenDate) {
  return `gc-${medId.replace(/-/g, '')}-${slotId.replace(/-/g, '')}-${takenDate.replace(/-/g, '')}`;
}

/**
 * Build the button HTML for a grid cell.
 *
 * @param {string} id
 * @param {string} medId
 * @param {string} slotId
 * @param {string} takenDate
 * @param {string} medName
 * @param {string} slotLabel
 * @param {string} dayLabel
 * @param {number} dayNum
 * @param {boolean} taken
 * @returns {string}
 */
function cellHtml(id, medId, slotId, takenDate, medName, slotLabel, dayLabel, dayNum, taken) {
  const cls    = taken ? 'grid-cell grid-cell--taken' : 'grid-cell';
  const label  = `${esc(medName)}, ${esc(slotLabel)}, ${esc(dayLabel)} ${dayNum}${taken ? ', taken' : ', not taken'}`;
  const action = `$toggleMedId='${esc(medId)}';$toggleSlotId='${esc(slotId)}';$toggleDate='${takenDate}';@post('/api/grid/toggle')`;
  return `<button id="${id}" class="${cls}" data-on:click="${action}" aria-label="${label}" aria-pressed="${taken ? 'true' : 'false'}"></button>`;
}


/* ─────────────────────────────────────────────────────────────
   Print page  GET /app/grid/print
   (registered before /app/grid to avoid path ambiguity)
   ───────────────────────────────────────────────────────────── */

router.get('/app/grid/print', requireAuth, loadAppContext, async (req, res) => {
  const monthParam = String(req.query.month ?? '');

  let year, month;
  if (/^\d{4}-\d{2}$/.test(monthParam)) {
    const [y, m] = monthParam.split('-').map(Number);
    year  = y;
    month = m - 1;
  } else {
    const now = new Date();
    year  = now.getFullYear();
    month = now.getMonth();
  }

  const grid = await buildMonthGrid(req.profile.id, year, month);

  res.render('pages/grid-print', {
    title:   `${grid.monthLabel} — ${req.profile.name}`,
    profile: req.profile,
    grid,
  });
});


/* ─────────────────────────────────────────────────────────────
   Grid page  GET /app/grid
   ───────────────────────────────────────────────────────────── */

router.get('/app/grid', requireAuth, loadAppContext, async (req, res) => {
  const monthParam = String(req.query.month ?? '');

  let year, month;
  if (/^\d{4}-\d{2}$/.test(monthParam)) {
    const [y, m] = monthParam.split('-').map(Number);
    year  = y;
    month = m - 1; // 0-based
  } else {
    const now = new Date();
    year  = now.getFullYear();
    month = now.getMonth();
  }

  const grid = await buildMonthGrid(req.profile.id, year, month);

  res.render('pages/grid', {
    title:    grid.monthLabel,
    path:     '/app/grid',
    profile:  req.profile,
    profiles: req.profiles,
    grid,
    extraCss: '/css/grid.css',
  });
});


/* ─────────────────────────────────────────────────────────────
   Toggle dose entry  POST /api/grid/toggle
   Body (signals): { toggleMedId, toggleSlotId, toggleDate }
   ───────────────────────────────────────────────────────────── */

router.post('/api/grid/toggle', requireAuth, loadAppContext, async (req, res) => {
  sseHeaders(res);

  const medId     = String(req.body.toggleMedId  ?? '').trim();
  const slotId    = String(req.body.toggleSlotId ?? '').trim();
  const takenDate = String(req.body.toggleDate   ?? '').trim();

  if (!medId || !slotId || !/^\d{4}-\d{2}-\d{2}$/.test(takenDate)) {
    res.write('event: datastar-patch-signals\ndata: signals {"toggleError":"invalid"}\n\n');
    return res.end();
  }

  // Verify med belongs to this profile
  const medCheck = await db.execute({
    sql:  'SELECT name FROM medications WHERE id = ? AND profile_id = ?',
    args: [medId, req.profile.id],
  });
  if (!medCheck.rows.length) {
    res.write('event: datastar-patch-signals\ndata: signals {"toggleError":"forbidden"}\n\n');
    return res.end();
  }

  // Verify slot belongs to this profile
  const slotCheck = await db.execute({
    sql:  'SELECT label FROM time_slots WHERE id = ? AND profile_id = ?',
    args: [slotId, req.profile.id],
  });
  if (!slotCheck.rows.length) {
    res.write('event: datastar-patch-signals\ndata: signals {"toggleError":"forbidden"}\n\n');
    return res.end();
  }

  const medName   = String(medCheck.rows[0].name);
  const slotLabel = String(slotCheck.rows[0].label);

  const existing = await db.execute({
    sql:  'SELECT id FROM grid_entries WHERE med_id = ? AND slot_id = ? AND taken_date = ?',
    args: [medId, slotId, takenDate],
  });

  const id = cellId(medId, slotId, takenDate);

  // Parse day info for the aria-label
  const dateObj  = new Date(takenDate + 'T12:00:00');
  const dayLabel = dateObj.toLocaleDateString('en-US', { weekday: 'short' });
  const dayNum   = dateObj.getDate();

  let taken;
  if (existing.rows.length) {
    await db.execute({ sql: 'DELETE FROM grid_entries WHERE id = ?', args: [String(existing.rows[0].id)] });
    taken = false;
  } else {
    await db.execute({
      sql:  'INSERT INTO grid_entries (id, profile_id, med_id, slot_id, taken_date, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      args: [randomUUID(), req.profile.id, medId, slotId, takenDate, 'taken', new Date().toISOString()],
    });
    taken = true;
  }

  const html = cellHtml(id, medId, slotId, takenDate, medName, slotLabel, dayLabel, dayNum, taken);

  res.write('event: datastar-patch-elements\n');
  res.write('data: mode outer\n');
  res.write(`data: elements ${html}\n\n`);
  res.end();
});

export default router;
