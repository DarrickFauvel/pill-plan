import { Router } from 'express';
import { randomUUID } from 'crypto';
import db from '../db/client.js';
import { requireAuth, loadAppContext } from '../middleware/auth.js';
import { buildMonthGrid, buildDayGrid, buildWeekRangeGrid, buildFillGrid } from '../services/gridBuilder.js';
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
function cellHtml(id, medId, slotId, takenDate, medName, slotLabel, dayLabel, dayNum, taken, imageUrl, filled = false) {
  const label  = `${esc(medName)}, ${esc(slotLabel)}, ${esc(dayLabel)} ${dayNum}${taken ? ', taken' : ', not taken'}`;
  const action = `$pendingToggleId='${id}';$pendingToggleNewState=${!taken};$saveStatus='idle';$toggleMedId='${esc(medId)}';$toggleSlotId='${esc(slotId)}';$toggleDate='${takenDate}';@post('/api/grid/toggle')`;
  if (imageUrl) {
    const takenExpr = `$pendingToggleId === '${id}' ? $pendingToggleNewState : ${taken}`;
    const dataClass = `{'grid-cell--pending': $pendingToggleId === '${id}', 'grid-cell--taken': ${takenExpr}}`;
    const initClass = `grid-cell grid-cell--image-cell${taken ? ' grid-cell--taken' : ''}`;
    return `<button id="${id}" class="${initClass}" data-on:click="${action}" data-class="${dataClass}" aria-label="${label}" aria-pressed="${taken ? 'true' : 'false'}"><img src="${esc(imageUrl)}" alt=""></button>`;
  }
  const initClass = taken ? 'grid-cell grid-cell--taken'
    : filled       ? 'grid-cell grid-cell--filled'
    : 'grid-cell';
  const dataClass = `{'grid-cell--taken': $pendingToggleId === '${id}' ? $pendingToggleNewState : ${taken}, 'grid-cell--filled': !($pendingToggleId === '${id}' ? $pendingToggleNewState : ${taken}) && ${filled}, 'grid-cell--pending': $pendingToggleId === '${id}'}`;
  return `<button id="${id}" class="${initClass}" data-on:click="${action}" data-class="${dataClass}" aria-label="${label}" aria-pressed="${taken ? 'true' : 'false'}"></button>`;
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
    const [ly, lm] = req.localDate.split('-').map(Number);
    year  = ly;
    month = lm - 1;
  }

  const grid = await buildMonthGrid(req.profile.id, year, month, req.localDate);

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
  const todayParam = String(req.query.today ?? '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(todayParam)) req.localDate = todayParam;

  if (req.profile.organizerType === 'bottles') {
    const dateParam = String(req.query.date ?? '');
    let dateStr;
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
      dateStr = dateParam;
    } else {
      dateStr = req.localDate;
    }

    const grid = await buildDayGrid(req.profile.id, dateStr, req.localDate);

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

  const medsRes = await db.execute({
    sql:  'SELECT id, name FROM medications WHERE profile_id = ? AND active = 1 ORDER BY name ASC',
    args: [req.profile.id],
  });
  const meds = medsRes.rows.map((r) => ({ id: String(r.id), name: String(r.name) }));

  if (numWeeks > 1 || /^\d{4}-\d{2}-\d{2}$/.test(startParam)) {
    let startDate;
    if (/^\d{4}-\d{2}-\d{2}$/.test(startParam)) {
      startDate = startParam;
    } else if (/^\d{4}-\d{2}$/.test(monthParam)) {
      const [y, m] = monthParam.split('-').map(Number);
      startDate = sundayOf(new Date(y, m - 1, 1));
    } else {
      // Start one week back so the previous organizer tray is visible on the left.
      const d = new Date(req.localDate + 'T12:00:00');
      d.setDate(d.getDate() - 7);
      startDate = sundayOf(d);
    }

    const grid = await buildWeekRangeGrid(req.profile.id, startDate, numWeeks, req.localDate);
    return res.render('pages/grid', {
      title:    grid.rangeLabel,
      path:     '/app/grid',
      profile:  req.profile,
      profiles: req.profiles,
      grid,
      meds,
      extraCss: '/css/grid.css',
    });
  }

  let year, month;
  if (/^\d{4}-\d{2}$/.test(monthParam)) {
    const [y, m] = monthParam.split('-').map(Number);
    year  = y;
    month = m - 1; // 0-based
  } else {
    const [ly, lm] = req.localDate.split('-').map(Number);
    year  = ly;
    month = lm - 1;
  }

  const grid = await buildMonthGrid(req.profile.id, year, month, req.localDate);

  res.render('pages/grid', {
    title:    grid.monthLabel,
    path:     '/app/grid',
    profile:  req.profile,
    profiles: req.profiles,
    grid,
    meds,
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

  let cellFilled = false;
  if (!isBottles) {
    const fillCheck = await db.execute({
      sql:  'SELECT id FROM fill_entries WHERE med_id = ? AND slot_id = ? AND fill_date = ?',
      args: [medId, slotId, takenDate],
    });
    cellFilled = fillCheck.rows.length > 0;
  }

  const localDateBody = String(req.body.localDate ?? '');
  const todayStr = /^\d{4}-\d{2}-\d{2}$/.test(localDateBody) ? localDateBody : req.localDate;
  let cellImageUrl = null;
  if (!isBottles && (takenDate === todayStr || cellFilled)) {
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

  const html = isBottles
    ? bottlesCellHtml(id, medId, slotId, takenDate, medName, slotLabel, taken)
    : cellHtml(id, medId, slotId, takenDate, medName, slotLabel, dayLabel, dayNum, taken, cellImageUrl, cellFilled);

  res.write('event: datastar-patch-elements\n');
  res.write('data: mode outer\n');
  res.write(`data: elements ${html}\n\n`);
  res.write('event: datastar-patch-signals\ndata: signals {"pendingToggleId":"","pendingToggleNewState":false,"saveStatus":"saved"}\n\n');
  res.end();
});

/* ─────────────────────────────────────────────────────────────
   Fill mode helpers
   ───────────────────────────────────────────────────────────── */

/**
 * @param {string} slotId
 * @param {string} date  YYYY-MM-DD
 * @returns {string}
 */
function fillCellId(slotId, date) {
  return `fc-${slotId.replace(/-/g, '')}-${date.replace(/-/g, '')}`;
}

/**
 * @param {string} id
 * @param {string} slotId
 * @param {string} date
 * @param {string} slotLabel
 * @param {string} dayLabel
 * @param {number} dayNum
 * @param {boolean} isFilled
 * @param {boolean} isPast
 * @param {boolean} isToday
 * @returns {string}
 */
function fillCellHtml(id, slotId, date, slotLabel, dayLabel, dayNum, isFilled, isPast, isToday, medImageUrl = null) {
  const label   = `${esc(slotLabel)}, ${esc(dayLabel)} ${dayNum}${isFilled ? ', filled' : ', not filled'}`;
  const action  = `$fillSlotId='${esc(slotId)}';$fillDate='${date}';@post('/api/grid/fill-range-tap')`;
  const baseCls = [
    'fill-cell',
    isFilled ? 'fill-cell--filled' : '',
    isPast   ? 'fill-cell--past'   : '',
    isToday  ? 'fill-cell--today'  : '',
  ].filter(Boolean).join(' ');

  const slot    = esc(slotId);
  const isStart = `$fillRangeStart === '${date}' && $fillRangeSlotId === '${slot}' && $fillRangeEnd === ''`;
  const rMin    = `($fillRangeStart < $fillRangeEnd ? $fillRangeStart : $fillRangeEnd)`;
  const rMax    = `($fillRangeStart < $fillRangeEnd ? $fillRangeEnd : $fillRangeStart)`;
  const inRange = `$fillRangeSlotId === '${slot}' && $fillRangeStart !== '' && $fillRangeEnd !== '' && '${date}' >= ${rMin} && '${date}' <= ${rMax}`;
  const dataClass = `{'fill-cell--range-start': ${isStart}, 'fill-cell--range-preview': ${inRange}}`;

  const inner = (isFilled && medImageUrl) ? `<img src="${esc(medImageUrl)}" alt="">` : '';
  return `<button id="${id}" class="${baseCls}" data-class="${dataClass}" data-on:click="${action}" aria-label="${label}" aria-pressed="${isFilled ? 'true' : 'false'}">${inner}</button>`;
}

/**
 * @param {import('../services/gridBuilder.js').FillGrid} fillGrid
 * @returns {string}
 */
function buildFillGridHtml(fillGrid) {
  const { days, slots, organizers, imageUrl: medImageUrl } = fillGrid;
  const numWeeks = organizers.length;

  let h = '<div id="fill-grid-container" class="fill-grid-wrap" aria-live="polite">';

  for (let w = 0; w < numWeeks; w++) {
    const weekDays = days.slice(w * 7, w * 7 + 7);
    const ws  = weekDays[0];
    const we  = weekDays[6];
    const lbl = `${organizers[w]} · ${ws.dayLabel} ${ws.dayNum} – ${we.dayLabel} ${we.dayNum}`;

    h += `<section class="fill-week">`;
    h += `<h2 class="fill-week__header">${esc(lbl)}</h2>`;
    h += `<table class="fill-week-table" role="grid" aria-label="${esc(lbl)}"><thead><tr>`;
    h += `<td class="fill-th fill-th--slot-corner"></td>`;

    for (const day of weekDays) {
      const cls = ['fill-th fill-th--day',
        day.isToday ? 'fill-th--today' : '',
        day.isPast  ? 'fill-th--past'  : '',
      ].filter(Boolean).join(' ');
      const inner = day.isToday
        ? `<span class="grid-today-badge"><span class="fill-day-num">${day.dayNum}</span><span class="fill-day-name">${esc(day.dayLabel)}</span></span>`
        : `<span class="fill-day-num">${day.dayNum}</span><span class="fill-day-name">${esc(day.dayLabel)}</span>`;
      h += `<th scope="col" class="${cls}">${inner}</th>`;
    }
    h += `</tr></thead><tbody>`;

    for (const slot of slots) {
      h += `<tr><th scope="row" class="fill-th fill-th--slot">${esc(slot.label)}</th>`;
      for (const day of weekDays) {
        const dow       = new Date(day.date + 'T12:00:00').getDay();
        const scheduled = slot.scheduledDays.includes(dow);
        h += `<td class="fill-td" role="gridcell">`;
        if (scheduled) {
          const filled = !!slot.fillEntries[day.date];
          const id     = fillCellId(slot.id, day.date);
          h += fillCellHtml(id, slot.id, day.date, slot.label, day.dayLabel, day.dayNum, filled, day.isPast, day.isToday, medImageUrl);
        } else {
          h += '<span class="fill-cell fill-cell--empty" aria-hidden="true"></span>';
        }
        h += `</td>`;
      }
      h += `</tr>`;
    }

    h += `</tbody></table></section>`;
  }

  h += '</div>';
  return h;
}

/**
 * Rebuild and stream the fill grid for a given med.
 * @param {import('express').Response} res
 * @param {string} profileId
 * @param {string} medId
 * @param {number} numWeeks
 */
async function streamFillGrid(res, profileId, medId, numWeeks, todayStr) {
  const fillGrid = await buildFillGrid(profileId, medId, sundayOf(new Date(todayStr + 'T12:00:00')), numWeeks, todayStr, numWeeks * 2);
  const html     = buildFillGridHtml(fillGrid);
  res.write('event: datastar-patch-elements\n');
  res.write('data: mode outer\n');
  res.write(`data: elements ${html}\n\n`);

  let defaultStart  = '';
  let defaultSlotId = '';
  outer: for (const day of fillGrid.days) {
    for (const slot of fillGrid.slots) {
      const dow = new Date(day.date + 'T12:00:00').getDay();
      if (slot.scheduledDays.includes(dow) && !slot.fillEntries[day.date]) {
        defaultStart  = day.date;
        defaultSlotId = slot.id;
        break outer;
      }
    }
  }
  res.write(`event: datastar-patch-signals\ndata: signals {"fillRangeStart":"${defaultStart}","fillRangeSlotId":"${defaultSlotId}","fillRangeEnd":""}\n\n`);
}


/* ─────────────────────────────────────────────────────────────
   Fill grid  POST /api/grid/fill-grid
   Body (signals): { fillMedId }
   ───────────────────────────────────────────────────────────── */

router.post('/api/grid/fill-grid', requireAuth, loadAppContext, async (req, res) => {
  sseHeaders(res);

  const fillMedId = String(req.body.fillMedId ?? '').trim();

  if (!fillMedId) {
    res.write('event: datastar-patch-elements\n');
    res.write('data: mode outer\n');
    res.write('data: elements <div id="fill-grid-container" class="fill-grid-wrap" aria-live="polite"></div>\n\n');
    return res.end();
  }

  const medCheck = await db.execute({
    sql:  'SELECT name FROM medications WHERE id = ? AND profile_id = ?',
    args: [fillMedId, req.profile.id],
  });
  if (!medCheck.rows.length) {
    res.write('event: datastar-patch-elements\n');
    res.write('data: mode outer\n');
    res.write('data: elements <div id="fill-grid-container" class="fill-grid-wrap" aria-live="polite"></div>\n\n');
    return res.end();
  }

  await streamFillGrid(res, req.profile.id, fillMedId, req.profile.organizerCount ?? 1, req.localDate);
  res.end();
});


/* ─────────────────────────────────────────────────────────────
   Fill toggle  POST /api/grid/fill-toggle
   Body (signals): { fillMedId, fillSlotId, fillDate }
   ───────────────────────────────────────────────────────────── */

router.post('/api/grid/fill-toggle', requireAuth, loadAppContext, async (req, res) => {
  sseHeaders(res);

  const fillMedId  = String(req.body.fillMedId  ?? '').trim();
  const fillSlotId = String(req.body.fillSlotId ?? '').trim();
  const fillDate   = String(req.body.fillDate   ?? '').trim();

  if (!fillMedId || !fillSlotId || !/^\d{4}-\d{2}-\d{2}$/.test(fillDate)) return res.end();

  const medCheck = await db.execute({
    sql:  'SELECT name FROM medications WHERE id = ? AND profile_id = ?',
    args: [fillMedId, req.profile.id],
  });
  if (!medCheck.rows.length) return res.end();

  const slotCheck = await db.execute({
    sql:  'SELECT label FROM time_slots WHERE id = ? AND profile_id = ?',
    args: [fillSlotId, req.profile.id],
  });
  if (!slotCheck.rows.length) return res.end();

  const slotLabel = String(slotCheck.rows[0].label);
  const dateObj   = new Date(fillDate + 'T12:00:00');
  const dayLabel  = dateObj.toLocaleDateString('en-US', { weekday: 'short' });
  const dayNum    = dateObj.getDate();
  const todayStr  = req.localDate;

  const existing = await db.execute({
    sql:  'SELECT id FROM fill_entries WHERE med_id = ? AND slot_id = ? AND fill_date = ?',
    args: [fillMedId, fillSlotId, fillDate],
  });

  let isFilled;
  if (existing.rows.length) {
    await db.execute({ sql: 'DELETE FROM fill_entries WHERE id = ?', args: [String(existing.rows[0].id)] });
    isFilled = false;
  } else {
    await db.execute({
      sql:  'INSERT INTO fill_entries (id, profile_id, med_id, slot_id, fill_date, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      args: [randomUUID(), req.profile.id, fillMedId, fillSlotId, fillDate, new Date().toISOString()],
    });
    isFilled = true;
  }

  let fillImageUrl = null;
  if (isFilled) {
    const imgRow = await db.execute({
      sql:  'SELECT source, url, crop_data FROM medication_images WHERE med_id = ? ORDER BY sort_order ASC LIMIT 1',
      args: [fillMedId],
    });
    if (imgRow.rows.length) {
      const row      = imgRow.rows[0];
      const src      = String(row.source);
      const rawUrl   = String(row.url);
      const cropData = row.crop_data ? JSON.parse(String(row.crop_data)) : null;
      fillImageUrl   = src === 'cloudinary' ? imageUrl(rawUrl, cropData) : rawUrl;
    }
  }

  const id   = fillCellId(fillSlotId, fillDate);
  const html = fillCellHtml(id, fillSlotId, fillDate, slotLabel, dayLabel, dayNum, isFilled, fillDate < todayStr, fillDate === todayStr, fillImageUrl);

  const takenCheck = await db.execute({
    sql:  'SELECT id FROM grid_entries WHERE med_id = ? AND slot_id = ? AND taken_date = ?',
    args: [fillMedId, fillSlotId, fillDate],
  });
  const isTaken = takenCheck.rows.length > 0;

  let takeImageUrl = fillImageUrl;
  if (!takeImageUrl && fillDate === todayStr) {
    const imgRow = await db.execute({
      sql:  'SELECT source, url, crop_data FROM medication_images WHERE med_id = ? ORDER BY sort_order ASC LIMIT 1',
      args: [fillMedId],
    });
    if (imgRow.rows.length) {
      const row      = imgRow.rows[0];
      const src      = String(row.source);
      const rawUrl   = String(row.url);
      const cropData = row.crop_data ? JSON.parse(String(row.crop_data)) : null;
      takeImageUrl   = src === 'cloudinary' ? imageUrl(rawUrl, cropData) : rawUrl;
    }
  }

  const medName      = String(medCheck.rows[0].name);
  const takeCid      = cellId(fillMedId, fillSlotId, fillDate);
  const takeCellHtml = cellHtml(takeCid, fillMedId, fillSlotId, fillDate, medName, slotLabel, dayLabel, dayNum, isTaken, takeImageUrl, isFilled);

  res.write('event: datastar-patch-elements\n');
  res.write('data: mode outer\n');
  res.write(`data: elements ${html}\n\n`);
  res.write('event: datastar-patch-elements\n');
  res.write('data: mode outer\n');
  res.write(`data: elements ${takeCellHtml}\n\n`);
  res.end();
});


/* ─────────────────────────────────────────────────────────────
   Fill auto  POST /api/grid/fill-auto
   Body (signals): { fillMedId, fillCount }
   ───────────────────────────────────────────────────────────── */

router.post('/api/grid/fill-auto', requireAuth, loadAppContext, async (req, res) => {
  sseHeaders(res);

  const fillMedId = String(req.body.fillMedId ?? '').trim();
  const fillCount = Math.max(1, Math.min(366, parseInt(String(req.body.fillCount ?? '1'), 10) || 1));

  if (!fillMedId) return res.end();

  const medCheck = await db.execute({
    sql:  'SELECT name FROM medications WHERE id = ? AND profile_id = ?',
    args: [fillMedId, req.profile.id],
  });
  if (!medCheck.rows.length) return res.end();

  const numWeeks = req.profile.organizerCount ?? 1;
  const fillGrid = await buildFillGrid(req.profile.id, fillMedId, sundayOf(new Date(req.localDate + 'T12:00:00')), numWeeks, req.localDate);

  const toFill = [];
  outer: for (const day of fillGrid.days) {
    for (const slot of fillGrid.slots) {
      const dow = new Date(day.date + 'T12:00:00').getDay();
      if (slot.scheduledDays.includes(dow) && !slot.fillEntries[day.date]) {
        toFill.push({ slotId: slot.id, date: day.date });
        if (toFill.length >= fillCount) break outer;
      }
    }
  }

  for (const { slotId, date } of toFill) {
    try {
      await db.execute({
        sql:  'INSERT INTO fill_entries (id, profile_id, med_id, slot_id, fill_date, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        args: [randomUUID(), req.profile.id, fillMedId, slotId, date, new Date().toISOString()],
      });
    } catch { /* ignore duplicate */ }
  }

  await streamFillGrid(res, req.profile.id, fillMedId, numWeeks, req.localDate);
  res.end();
});


/* ─────────────────────────────────────────────────────────────
   Fill catch-up  POST /api/grid/fill-catchup
   Body (signals): { fillMedId }
   ───────────────────────────────────────────────────────────── */

router.post('/api/grid/fill-catchup', requireAuth, loadAppContext, async (req, res) => {
  sseHeaders(res);

  const fillMedId = String(req.body.fillMedId ?? '').trim();
  if (!fillMedId) return res.end();

  const medCheck = await db.execute({
    sql:  'SELECT name FROM medications WHERE id = ? AND profile_id = ?',
    args: [fillMedId, req.profile.id],
  });
  if (!medCheck.rows.length) return res.end();

  const numWeeks = req.profile.organizerCount ?? 1;
  const fillGrid = await buildFillGrid(req.profile.id, fillMedId, sundayOf(new Date(req.localDate + 'T12:00:00')), numWeeks, req.localDate);
  const todayStr = fillGrid.todayStr;

  for (const day of fillGrid.days) {
    if (day.date >= todayStr) continue;
    for (const slot of fillGrid.slots) {
      const dow = new Date(day.date + 'T12:00:00').getDay();
      if (slot.scheduledDays.includes(dow) && !slot.fillEntries[day.date]) {
        try {
          await db.execute({
            sql:  'INSERT INTO fill_entries (id, profile_id, med_id, slot_id, fill_date, created_at) VALUES (?, ?, ?, ?, ?, ?)',
            args: [randomUUID(), req.profile.id, fillMedId, slot.id, day.date, new Date().toISOString()],
          });
        } catch { /* ignore duplicate */ }
      }
    }
  }

  await streamFillGrid(res, req.profile.id, fillMedId, numWeeks, req.localDate);
  res.end();
});


/* ─────────────────────────────────────────────────────────────
   Fill all cells for one slot  POST /api/grid/fill-slot
   Body (signals): { fillMedId, fillSlotId }
   ───────────────────────────────────────────────────────────── */
router.post('/api/grid/fill-slot', requireAuth, loadAppContext, async (req, res) => {
  sseHeaders(res);

  const fillMedId  = String(req.body.fillMedId  ?? '').trim();
  const fillSlotId = String(req.body.fillSlotId ?? '').trim();
  if (!fillMedId || !fillSlotId) return res.end();

  const medCheck = await db.execute({
    sql:  'SELECT name FROM medications WHERE id = ? AND profile_id = ?',
    args: [fillMedId, req.profile.id],
  });
  if (!medCheck.rows.length) return res.end();

  const slotCheck = await db.execute({
    sql:  'SELECT id FROM time_slots WHERE id = ? AND profile_id = ?',
    args: [fillSlotId, req.profile.id],
  });
  if (!slotCheck.rows.length) return res.end();

  const numWeeks = req.profile.organizerCount ?? 1;
  const fillGrid = await buildFillGrid(
    req.profile.id, fillMedId,
    sundayOf(new Date(req.localDate + 'T12:00:00')),
    numWeeks, req.localDate, numWeeks * 2,
  );

  const slot = fillGrid.slots.find(s => s.id === fillSlotId);
  if (!slot) return res.end();

  for (const day of fillGrid.days) {
    const dow = new Date(day.date + 'T12:00:00').getDay();
    if (!slot.scheduledDays.includes(dow)) continue;
    if (slot.fillEntries[day.date]) continue;
    try {
      await db.execute({
        sql:  'INSERT INTO fill_entries (id, profile_id, med_id, slot_id, fill_date, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        args: [randomUUID(), req.profile.id, fillMedId, fillSlotId, day.date, new Date().toISOString()],
      });
    } catch { /* ignore duplicate */ }
  }

  await streamFillGrid(res, req.profile.id, fillMedId, numWeeks, req.localDate);
  res.end();
});


/* ─────────────────────────────────────────────────────────────
   Fill range tap  POST /api/grid/fill-range-tap
   Body (signals): { fillMedId, fillSlotId, fillDate, fillRangeStart, fillRangeSlotId, fillRangeEnd }
   Never writes to DB — only updates selection signals.
   Tap 1: set range start. Tap 2: set range end. Tap on new slot: restart.
   ───────────────────────────────────────────────────────────── */

router.post('/api/grid/fill-range-tap', requireAuth, loadAppContext, async (req, res) => {
  sseHeaders(res);

  const fillMedId       = String(req.body.fillMedId       ?? '').trim();
  const fillSlotId      = String(req.body.fillSlotId      ?? '').trim();
  const fillDate        = String(req.body.fillDate        ?? '').trim();
  const fillRangeStart  = String(req.body.fillRangeStart  ?? '').trim();
  const fillRangeEnd    = String(req.body.fillRangeEnd    ?? '').trim();
  const fillRangeSlotId = String(req.body.fillRangeSlotId ?? '').trim();

  if (!fillMedId || !fillSlotId || !/^\d{4}-\d{2}-\d{2}$/.test(fillDate)) return res.end();

  const [medCheck, slotCheck] = await Promise.all([
    db.execute({ sql: 'SELECT id FROM medications WHERE id = ? AND profile_id = ?', args: [fillMedId, req.profile.id] }),
    db.execute({ sql: 'SELECT id FROM time_slots WHERE id = ? AND profile_id = ?',  args: [fillSlotId, req.profile.id] }),
  ]);
  if (!medCheck.rows.length || !slotCheck.rows.length) return res.end();

  let patch;
  if (!fillRangeStart || fillRangeSlotId !== fillSlotId || fillRangeEnd !== '') {
    // First tap, different slot, or restarting after a confirmed range
    patch = `{"fillRangeStart":"${fillDate}","fillRangeSlotId":"${fillSlotId}","fillRangeEnd":""}`;
  } else {
    // Second tap on the same slot — set the end
    patch = `{"fillRangeEnd":"${fillDate}"}`;
  }
  res.write(`event: datastar-patch-signals\ndata: signals ${patch}\n\n`);
  res.end();
});


/* ─────────────────────────────────────────────────────────────
   Fill range confirm  POST /api/grid/fill-range-confirm
   Body (signals): { fillMedId, fillRangeSlotId, fillRangeStart, fillRangeEnd, fillAction }
   Writes to DB: inserts or deletes fill_entries for the selected range.
   ───────────────────────────────────────────────────────────── */

router.post('/api/grid/fill-range-confirm', requireAuth, loadAppContext, async (req, res) => {
  sseHeaders(res);

  const fillMedId       = String(req.body.fillMedId       ?? '').trim();
  const fillRangeSlotId = String(req.body.fillRangeSlotId ?? '').trim();
  const fillRangeStart  = String(req.body.fillRangeStart  ?? '').trim();
  const fillRangeEnd    = String(req.body.fillRangeEnd    ?? '').trim();
  const fillAction      = String(req.body.fillAction      ?? 'fill').trim();

  if (!fillMedId || !fillRangeSlotId ||
      !/^\d{4}-\d{2}-\d{2}$/.test(fillRangeStart) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(fillRangeEnd)) return res.end();

  const [medCheck, slotCheck] = await Promise.all([
    db.execute({ sql: 'SELECT name FROM medications WHERE id = ? AND profile_id = ?', args: [fillMedId, req.profile.id] }),
    db.execute({ sql: 'SELECT label FROM time_slots WHERE id = ? AND profile_id = ?', args: [fillRangeSlotId, req.profile.id] }),
  ]);
  if (!medCheck.rows.length || !slotCheck.rows.length) return res.end();

  const rangeStart = fillRangeStart < fillRangeEnd ? fillRangeStart : fillRangeEnd;
  const rangeEnd   = fillRangeStart < fillRangeEnd ? fillRangeEnd   : fillRangeStart;

  // Enumerate every date in the range
  const rangeDates = [];
  const cursor = new Date(rangeStart + 'T12:00:00');
  const end    = new Date(rangeEnd   + 'T12:00:00');
  while (cursor <= end) {
    const y = cursor.getFullYear();
    const m = String(cursor.getMonth() + 1).padStart(2, '0');
    const d = String(cursor.getDate()).padStart(2, '0');
    rangeDates.push(`${y}-${m}-${d}`);
    cursor.setDate(cursor.getDate() + 1);
  }

  const [scheduleRes, existingFillRes] = await Promise.all([
    db.execute({
      sql:  'SELECT days FROM schedules WHERE med_id = ? AND slot_id = ?',
      args: [fillMedId, fillRangeSlotId],
    }),
    db.execute({
      sql:  'SELECT fill_date FROM fill_entries WHERE profile_id = ? AND med_id = ? AND slot_id = ? AND fill_date >= ? AND fill_date <= ?',
      args: [req.profile.id, fillMedId, fillRangeSlotId, rangeStart, rangeEnd],
    }),
  ]);

  let scheduledDays;
  try { scheduledDays = JSON.parse(String(scheduleRes.rows[0]?.days ?? '[0,1,2,3,4,5,6]')); }
  catch { scheduledDays = [0, 1, 2, 3, 4, 5, 6]; }

  const filledSet = new Set(existingFillRes.rows.map(r => String(r.fill_date)));

  const scheduledDates = rangeDates.filter(date => {
    const dow = new Date(date + 'T12:00:00').getDay();
    return scheduledDays.includes(dow);
  });

  const affected = [];

  if (fillAction === 'remove') {
    for (const date of scheduledDates) {
      if (!filledSet.has(date)) continue;
      await db.execute({
        sql:  'DELETE FROM fill_entries WHERE profile_id = ? AND med_id = ? AND slot_id = ? AND fill_date = ?',
        args: [req.profile.id, fillMedId, fillRangeSlotId, date],
      });
      affected.push(date);
    }
  } else {
    for (const date of scheduledDates) {
      if (filledSet.has(date)) continue;
      try {
        await db.execute({
          sql:  'INSERT INTO fill_entries (id, profile_id, med_id, slot_id, fill_date, created_at) VALUES (?, ?, ?, ?, ?, ?)',
          args: [randomUUID(), req.profile.id, fillMedId, fillRangeSlotId, date, new Date().toISOString()],
        });
        affected.push(date);
      } catch { /* ignore duplicate */ }
    }
  }

  const numWeeks = req.profile.organizerCount ?? 1;
  await streamFillGrid(res, req.profile.id, fillMedId, numWeeks, req.localDate);

  // Update take-mode cells for all affected dates
  if (affected.length > 0) {
    const slotLabel = String(slotCheck.rows[0].label);
    const medName   = String(medCheck.rows[0].name);

    let affectedImageUrl = null;
    if (fillAction !== 'remove') {
      const imgRow = await db.execute({
        sql:  'SELECT source, url, crop_data FROM medication_images WHERE med_id = ? ORDER BY sort_order ASC LIMIT 1',
        args: [fillMedId],
      });
      if (imgRow.rows.length) {
        const row      = imgRow.rows[0];
        const src      = String(row.source);
        const rawUrl   = String(row.url);
        const cropData = row.crop_data ? JSON.parse(String(row.crop_data)) : null;
        affectedImageUrl = src === 'cloudinary' ? imageUrl(rawUrl, cropData) : rawUrl;
      }
    }

    const placeholders = affected.map(() => '?').join(',');
    const takenRes = await db.execute({
      sql:  `SELECT taken_date FROM grid_entries WHERE med_id = ? AND slot_id = ? AND taken_date IN (${placeholders})`,
      args: [fillMedId, fillRangeSlotId, ...affected],
    });
    const takenSet = new Set(takenRes.rows.map(r => String(r.taken_date)));

    const nowFilled = fillAction !== 'remove';
    for (const date of affected) {
      const isTaken  = takenSet.has(date);
      const dateObj  = new Date(date + 'T12:00:00');
      const dayLabel = dateObj.toLocaleDateString('en-US', { weekday: 'short' });
      const dayNum   = dateObj.getDate();
      const cid      = cellId(fillMedId, fillRangeSlotId, date);
      const useImg   = nowFilled ? affectedImageUrl : null;
      const html     = cellHtml(cid, fillMedId, fillRangeSlotId, date, medName, slotLabel, dayLabel, dayNum, isTaken, useImg, nowFilled);
      res.write('event: datastar-patch-elements\n');
      res.write('data: mode outer\n');
      res.write(`data: elements ${html}\n\n`);
    }
  }

  res.end();
});


export default router;
