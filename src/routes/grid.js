import { Router } from 'express';
import { randomUUID } from 'crypto';
import db from '../db/client.js';
import { requireAuth, loadAppContext } from '../middleware/auth.js';
import { buildMonthGrid, buildDayGrid, buildWeekRangeGrid } from '../services/gridBuilder.js';
import { imageUrl } from '../services/cloudinary.js';

const router = Router();

/**
 * Return YYYY-MM-DD of the Sunday on or before the given date.
 * @param {Date} date
 * @returns {string}
 */
function sundayOf(date) {
  const d   = new Date(date);
  const dow = d.getDay();
  d.setDate(d.getDate() - dow);
  const y   = d.getFullYear();
  const m   = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
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
 * @param {string | null} imageUrl
 * @returns {string}
 */
function cellHtml(id, medId, slotId, takenDate, medName, slotLabel, dayLabel, dayNum, taken, imageUrl) {
  const label  = `${esc(medName)}, ${esc(slotLabel)}, ${esc(dayLabel)} ${dayNum}${taken ? ', taken' : ', not taken'}`;
  const action = `$pendingToggleId='${id}';$pendingToggleNewState=${!taken};$saveStatus='idle';$toggleMedId='${esc(medId)}';$toggleSlotId='${esc(slotId)}';$toggleDate='${takenDate}';@post('/api/grid/toggle')`;
  if (imageUrl) {
    const imgDataShow = `$pendingToggleId === '${id}' ? !$pendingToggleNewState : ${!taken}`;
    return `<button id="${id}" class="grid-cell grid-cell--image-cell" data-on:click="${action}" data-class="{'grid-cell--pending': $pendingToggleId === '${id}'}" aria-label="${label}" aria-pressed="${taken ? 'true' : 'false'}"><img src="${esc(imageUrl)}" alt="" data-show="${imgDataShow}"></button>`;
  }
  const cls       = taken ? 'grid-cell grid-cell--taken' : 'grid-cell';
  const dataClass = `{'grid-cell--taken': $pendingToggleId === '${id}' ? $pendingToggleNewState : ${taken}, 'grid-cell--pending': $pendingToggleId === '${id}'}`;
  return `<button id="${id}" class="${cls}" data-on:click="${action}" data-class="${dataClass}" aria-label="${label}" aria-pressed="${taken ? 'true' : 'false'}"></button>`;
}

/**
 * Build the take/taken button for the bottles day view.
 *
 * @param {string} id
 * @param {string} medId
 * @param {string} slotId
 * @param {string} takenDate
 * @param {string} medName
 * @param {string} slotLabel
 * @param {boolean} taken
 * @returns {string}
 */
function bottlesCellHtml(id, medId, slotId, takenDate, medName, slotLabel, taken) {
  const cls    = taken ? 'dose-btn dose-btn--taken' : 'dose-btn';
  const label  = taken
    ? `Mark not taken: ${esc(medName)}, ${esc(slotLabel)}`
    : `Mark taken: ${esc(medName)}, ${esc(slotLabel)}`;
  const action = `$toggleMedId='${esc(medId)}';$toggleSlotId='${esc(slotId)}';$toggleDate='${takenDate}';@post('/api/grid/toggle')`;
  const text   = taken ? '&#x2713; Taken' : 'Take';
  return `<button id="${id}" class="${cls}" data-on:click="${action}" aria-label="${label}" aria-pressed="${taken ? 'true' : 'false'}">${text}</button>`;
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
  if (req.profile.organizerType === 'bottles') {
    const dateParam = String(req.query.date ?? '');
    let dateStr;
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
      dateStr = dateParam;
    } else {
      const now = new Date();
      const y   = now.getFullYear();
      const m   = String(now.getMonth() + 1).padStart(2, '0');
      const d   = String(now.getDate()).padStart(2, '0');
      dateStr   = `${y}-${m}-${d}`;
    }

    const grid = await buildDayGrid(req.profile.id, dateStr);

    return res.render('pages/grid-bottles', {
      title:    grid.dateLabel,
      path:     '/app/grid',
      profile:  req.profile,
      profiles: req.profiles,
      grid,
      extraCss: '/css/grid.css',
    });
  }

  const numWeeks   = req.profile.organizerCount ?? 1;
  const startParam = String(req.query.start ?? '');
  const monthParam = String(req.query.month ?? '');

  if (numWeeks > 1 || /^\d{4}-\d{2}-\d{2}$/.test(startParam)) {
    let startDate;
    if (/^\d{4}-\d{2}-\d{2}$/.test(startParam)) {
      startDate = startParam;
    } else if (/^\d{4}-\d{2}$/.test(monthParam)) {
      const [y, m] = monthParam.split('-').map(Number);
      startDate = sundayOf(new Date(y, m - 1, 1));
    } else {
      // Start one week back so the previous organizer tray is visible on the left.
      const d = new Date();
      d.setDate(d.getDate() - 7);
      startDate = sundayOf(d);
    }

    const grid = await buildWeekRangeGrid(req.profile.id, startDate, numWeeks);
    return res.render('pages/grid', {
      title:    grid.rangeLabel,
      path:     '/app/grid',
      profile:  req.profile,
      profiles: req.profiles,
      grid,
      extraCss: '/css/grid.css',
    });
  }

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
    res.write('event: datastar-patch-signals\ndata: signals {"toggleError":"invalid","saveStatus":"error"}\n\n');
    return res.end();
  }

  // Verify med belongs to this profile
  const medCheck = await db.execute({
    sql:  'SELECT name FROM medications WHERE id = ? AND profile_id = ?',
    args: [medId, req.profile.id],
  });
  if (!medCheck.rows.length) {
    res.write('event: datastar-patch-signals\ndata: signals {"toggleError":"forbidden","saveStatus":"error"}\n\n');
    return res.end();
  }

  // Verify slot belongs to this profile
  const slotCheck = await db.execute({
    sql:  'SELECT label FROM time_slots WHERE id = ? AND profile_id = ?',
    args: [slotId, req.profile.id],
  });
  if (!slotCheck.rows.length) {
    res.write('event: datastar-patch-signals\ndata: signals {"toggleError":"forbidden","saveStatus":"error"}\n\n');
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

  const scheduleRow = await db.execute({
    sql:  'SELECT dose_qty FROM schedules WHERE med_id = ? AND slot_id = ?',
    args: [medId, slotId],
  });
  const doseQty = scheduleRow.rows.length ? (Number(scheduleRow.rows[0].dose_qty) || 1) : 1;

  let taken;
  if (existing.rows.length) {
    await db.execute({ sql: 'DELETE FROM grid_entries WHERE id = ?', args: [String(existing.rows[0].id)] });
    await db.execute({
      sql:  'UPDATE medications SET total_quantity = total_quantity + ? WHERE id = ?',
      args: [doseQty, medId],
    });
    taken = false;
  } else {
    await db.execute({
      sql:  'INSERT INTO grid_entries (id, profile_id, med_id, slot_id, taken_date, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      args: [randomUUID(), req.profile.id, medId, slotId, takenDate, 'taken', new Date().toISOString()],
    });
    await db.execute({
      sql:  'UPDATE medications SET total_quantity = MAX(0, total_quantity - ?) WHERE id = ?',
      args: [doseQty, medId],
    });
    taken = true;
  }

  const isBottles = req.profile.organizerType === 'bottles';

  let cellImageUrl = null;
  if (!isBottles) {
    const todayStr = new Date().toISOString().slice(0, 10);
    if (takenDate === todayStr) {
      const imgRow = await db.execute({
        sql:  'SELECT source, url, crop_data FROM medication_images WHERE med_id = ? ORDER BY sort_order ASC LIMIT 1',
        args: [medId],
      });
      if (imgRow.rows.length) {
        const row      = imgRow.rows[0];
        const source   = String(row.source);
        const rawUrl   = String(row.url);
        const cropData = row.crop_data ? JSON.parse(String(row.crop_data)) : null;
        cellImageUrl   = source === 'cloudinary' ? imageUrl(rawUrl, cropData) : rawUrl;
      }
    }
  }

  const html = isBottles
    ? bottlesCellHtml(id, medId, slotId, takenDate, medName, slotLabel, taken)
    : cellHtml(id, medId, slotId, takenDate, medName, slotLabel, dayLabel, dayNum, taken, cellImageUrl);

  res.write('event: datastar-patch-elements\n');
  res.write('data: mode outer\n');
  res.write(`data: elements ${html}\n\n`);
  res.write('event: datastar-patch-signals\ndata: signals {"pendingToggleId":"","pendingToggleNewState":false,"saveStatus":"saved"}\n\n');
  res.end();
});

export default router;
