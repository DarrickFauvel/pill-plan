import db from '../db/client.js';

/**
 * @typedef {Object} GridDay
 * @property {string} date       - YYYY-MM-DD
 * @property {number} dayNum     - Day of month (1-31)
 * @property {string} dayLabel   - Short weekday name (Mon, Tue…)
 * @property {boolean} isToday
 * @property {boolean} isPast
 * @property {boolean} isFuture
 */

/**
 * @typedef {Object} GridEntry
 * @property {string} entryId
 * @property {string} status  - 'taken' | 'skipped'
 */

/**
 * @typedef {Object} GridMed
 * @property {string} id
 * @property {string} name
 * @property {string} strength
 * @property {number} doseQty
 * @property {number[]} scheduledDays  - 0=Sun … 6=Sat
 * @property {Record<string, GridEntry>} entries  - keyed by YYYY-MM-DD
 */

/**
 * @typedef {Object} GridSlot
 * @property {string} id
 * @property {string} label
 * @property {GridMed[]} meds
 */

/**
 * @typedef {Object} RefillAlert
 * @property {string} id
 * @property {string} name
 * @property {number} daysRemaining
 */

/**
 * @typedef {Object} GridMonth
 * @property {number} year
 * @property {number} month     - 0-based
 * @property {string} monthLabel
 * @property {string} prevMonth - YYYY-MM
 * @property {string} nextMonth - YYYY-MM
 * @property {GridDay[]} days
 * @property {GridSlot[]} slots
 * @property {string} todayStr  - YYYY-MM-DD
 * @property {RefillAlert[]} refillAlerts
 */

/**
 * Format a Date as YYYY-MM-DD using local time.
 *
 * @param {Date} date
 * @returns {string}
 */
function toDateStr(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Format YYYY-MM from a year + 0-based month.
 *
 * @param {number} y
 * @param {number} m - 0-based
 * @returns {string}
 */
function toMonthParam(y, m) {
  const d = new Date(y, m, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * @typedef {Object} DayMed
 * @property {string} id
 * @property {string} name
 * @property {string} strength
 * @property {number} doseQty
 * @property {string | null} entryId
 * @property {boolean} taken
 */

/**
 * @typedef {Object} DaySlot
 * @property {string} id
 * @property {string} label
 * @property {DayMed[]} meds
 */

/**
 * @typedef {Object} DayGrid
 * @property {string} date       - YYYY-MM-DD
 * @property {string} dateLabel  - Human-readable date
 * @property {boolean} isToday
 * @property {string} prevDate   - YYYY-MM-DD
 * @property {string} nextDate   - YYYY-MM-DD
 * @property {DaySlot[]} slots
 * @property {RefillAlert[]} refillAlerts
 */

/**
 * Build a single-day grid for the bottles organizer view.
 *
 * @param {string} profileId
 * @param {string} dateStr  - YYYY-MM-DD
 * @returns {Promise<DayGrid>}
 */
export async function buildDayGrid(profileId, dateStr) {
  const dateObj   = new Date(dateStr + 'T12:00:00');
  const dayOfWeek = dateObj.getDay();
  const today     = new Date();
  const todayStr  = toDateStr(today);

  const [slotsRes, medsRes, entriesRes] = await Promise.all([
    db.execute({
      sql:  'SELECT id, label, sort_order FROM time_slots WHERE profile_id = ? ORDER BY sort_order ASC',
      args: [profileId],
    }),
    db.execute({
      sql: `SELECT m.id, m.name, m.strength, m.total_quantity, m.refill_threshold,
                   s.slot_id, s.days, s.dose_qty
            FROM medications m
            JOIN schedules s ON s.med_id = m.id
            WHERE m.profile_id = ? AND m.active = 1
            ORDER BY s.slot_id, m.created_at ASC`,
      args: [profileId],
    }),
    db.execute({
      sql:  'SELECT id, med_id, slot_id, status FROM grid_entries WHERE profile_id = ? AND taken_date = ?',
      args: [profileId, dateStr],
    }),
  ]);

  /** @type {Record<string, {entryId: string, status: string}>} */
  const entryIndex = {};
  for (const e of entriesRes.rows) {
    entryIndex[`${e.med_id}:${e.slot_id}`] = { entryId: String(e.id), status: String(e.status) };
  }

  /** @type {Record<string, {name: string, totalQty: number, threshold: number, dailyDose: number}>} */
  const medRefill = {};

  /** @type {Record<string, DayMed[]>} */
  const slotMedsMap = {};
  for (const row of medsRes.rows) {
    const slotId = String(row.slot_id);
    let scheduledDays;
    try {
      scheduledDays = JSON.parse(String(row.days));
    } catch {
      scheduledDays = [0, 1, 2, 3, 4, 5, 6];
    }
    if (!scheduledDays.includes(dayOfWeek)) continue;

    if (!slotMedsMap[slotId]) slotMedsMap[slotId] = [];

    const medId = String(row.id);
    if (!medRefill[medId]) {
      medRefill[medId] = {
        name:      String(row.name),
        totalQty:  Number(row.total_quantity ?? 0),
        threshold: Number(row.refill_threshold ?? 7),
        dailyDose: 0,
      };
    }
    medRefill[medId].dailyDose +=
      Number(row.dose_qty ?? 1) * (scheduledDays.length / 7);

    const entry = entryIndex[`${medId}:${slotId}`] ?? null;
    slotMedsMap[slotId].push({
      id:       medId,
      name:     String(row.name),
      strength: row.strength ? String(row.strength).replace(/^\./, '0.') : '',
      doseQty:  Number(row.dose_qty ?? 1),
      entryId:  entry?.entryId ?? null,
      taken:    !!(entry && entry.status === 'taken'),
    });
  }

  /** @type {DaySlot[]} */
  const slots = slotsRes.rows
    .map((r) => ({
      id:    String(r.id),
      label: String(r.label),
      meds:  slotMedsMap[String(r.id)] ?? [],
    }))
    .filter((s) => s.meds.length > 0);

  /** @type {RefillAlert[]} */
  const refillAlerts = [];
  for (const [medId, data] of Object.entries(medRefill)) {
    if (data.totalQty <= 0 || data.dailyDose <= 0) continue;
    const daysRemaining = Math.floor(data.totalQty / data.dailyDose);
    if (daysRemaining <= data.threshold) {
      refillAlerts.push({ id: medId, name: data.name, daysRemaining });
    }
  }
  refillAlerts.sort((a, b) => a.daysRemaining - b.daysRemaining);

  const prevDate = new Date(dateObj); prevDate.setDate(prevDate.getDate() - 1);
  const nextDate = new Date(dateObj); nextDate.setDate(nextDate.getDate() + 1);

  return {
    date:      dateStr,
    dateLabel: dateObj.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }),
    isToday:   dateStr === todayStr,
    prevDate:  toDateStr(prevDate),
    nextDate:  toDateStr(nextDate),
    slots,
    refillAlerts,
  };
}

/**
 * Build the full month grid data structure for a profile.
 *
 * @param {string} profileId
 * @param {number} year
 * @param {number} month - 0-based (0=Jan, 11=Dec)
 * @returns {Promise<GridMonth>}
 */
export async function buildMonthGrid(profileId, year, month) {
  const firstDay = new Date(year, month, 1);
  const lastDay  = new Date(year, month + 1, 0);
  const today    = new Date();
  const todayStr = toDateStr(today);

  /** @type {GridDay[]} */
  const days = [];
  for (let d = 1; d <= lastDay.getDate(); d++) {
    const date    = new Date(year, month, d);
    const dateStr = toDateStr(date);
    days.push({
      date:     dateStr,
      dayNum:   d,
      dayLabel: date.toLocaleDateString('en-US', { weekday: 'short' }),
      isToday:  dateStr === todayStr,
      isPast:   dateStr < todayStr,
      isFuture: dateStr > todayStr,
    });
  }

  const startDate = toDateStr(firstDay);
  const endDate   = toDateStr(lastDay);

  const [slotsRes, medsRes, entriesRes] = await Promise.all([
    db.execute({
      sql:  'SELECT id, label, sort_order FROM time_slots WHERE profile_id = ? ORDER BY sort_order ASC',
      args: [profileId],
    }),
    db.execute({
      sql: `SELECT m.id, m.name, m.strength, m.total_quantity, m.refill_threshold,
                   s.slot_id, s.days, s.dose_qty
            FROM medications m
            JOIN schedules s ON s.med_id = m.id
            WHERE m.profile_id = ? AND m.active = 1
            ORDER BY s.slot_id, m.created_at ASC`,
      args: [profileId],
    }),
    db.execute({
      sql: `SELECT id, med_id, slot_id, taken_date, status
            FROM grid_entries
            WHERE profile_id = ? AND taken_date >= ? AND taken_date <= ?`,
      args: [profileId, startDate, endDate],
    }),
  ]);

  /** @type {Record<string, GridEntry>} */
  const entryIndex = {};
  for (const e of entriesRes.rows) {
    const key = `${e.med_id}:${e.slot_id}:${e.taken_date}`;
    entryIndex[key] = { entryId: String(e.id), status: String(e.status) };
  }

  /** @type {Record<string, {name: string, totalQty: number, threshold: number, dailyDose: number}>} */
  const medRefill = {};

  /** @type {Record<string, GridMed[]>} */
  const slotMedsMap = {};
  for (const row of medsRes.rows) {
    const slotId = String(row.slot_id);
    if (!slotMedsMap[slotId]) slotMedsMap[slotId] = [];

    let scheduledDays;
    try {
      scheduledDays = JSON.parse(String(row.days));
    } catch {
      scheduledDays = [0, 1, 2, 3, 4, 5, 6];
    }

    // Accumulate daily dose across all schedule rows for this med
    const medId = String(row.id);
    if (!medRefill[medId]) {
      medRefill[medId] = {
        name:      String(row.name),
        totalQty:  Number(row.total_quantity ?? 0),
        threshold: Number(row.refill_threshold ?? 7),
        dailyDose: 0,
      };
    }
    medRefill[medId].dailyDose +=
      Number(row.dose_qty ?? 1) * (scheduledDays.length / 7);

    /** @type {Record<string, GridEntry>} */
    const medEntries = {};
    for (const day of days) {
      const key = `${row.id}:${slotId}:${day.date}`;
      if (entryIndex[key]) medEntries[day.date] = entryIndex[key];
    }

    slotMedsMap[slotId].push({
      id:            String(row.id),
      name:          String(row.name),
      strength:      row.strength ? String(row.strength) : '',
      doseQty:       Number(row.dose_qty ?? 1),
      scheduledDays,
      entries:       medEntries,
    });
  }

  /** @type {GridSlot[]} */
  const slots = slotsRes.rows.map((r) => ({
    id:    String(r.id),
    label: String(r.label),
    meds:  slotMedsMap[String(r.id)] ?? [],
  }));

  /** @type {RefillAlert[]} */
  const refillAlerts = [];
  for (const [medId, data] of Object.entries(medRefill)) {
    if (data.totalQty <= 0 || data.dailyDose <= 0) continue;
    const daysRemaining = Math.floor(data.totalQty / data.dailyDose);
    if (daysRemaining <= data.threshold) {
      refillAlerts.push({ id: medId, name: data.name, daysRemaining });
    }
  }
  refillAlerts.sort((a, b) => a.daysRemaining - b.daysRemaining);

  return {
    year,
    month,
    monthLabel: firstDay.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
    prevMonth:  toMonthParam(year, month - 1),
    nextMonth:  toMonthParam(year, month + 1),
    days,
    slots,
    todayStr,
    refillAlerts,
  };
}
