import { Router } from 'express';
import { randomUUID } from 'crypto';
import db from '../db/client.js';
import { requireAuth, loadAppContext } from '../middleware/auth.js';

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
 * @param {string} profileId
 * @returns {Promise<Array<{id: string, label: string, sortOrder: number}>>}
 */
async function loadSlots(profileId) {
  const result = await db.execute({
    sql:  'SELECT id, label, sort_order FROM time_slots WHERE profile_id = ? ORDER BY sort_order ASC',
    args: [profileId],
  });
  return result.rows.map((r) => ({
    id:        String(r.id),
    label:     String(r.label),
    sortOrder: Number(r.sort_order),
  }));
}

/**
 * Derive a JS-safe signal key from a UUID: "label" + hex digits, no hyphens.
 *
 * @param {string} slotId
 * @returns {string}
 */
function slotSignalKey(slotId) {
  return `label${slotId.replace(/-/g, '')}`;
}


/* ─────────────────────────────────────────────────────────────
   Settings page  GET /app/settings
   ───────────────────────────────────────────────────────────── */

router.get('/app/settings', requireAuth, loadAppContext, async (req, res) => {
  const slots = await loadSlots(req.profile.id);

  /** @type {Record<string, string | number>} */
  const signals = { saveStatus: 'idle', newSlotLabel: '' };
  for (const slot of slots) {
    signals[slotSignalKey(slot.id)] = slot.label;
  }

  res.render('pages/settings', {
    title:    'Settings',
    path:     '/app/settings',
    profile:  req.profile,
    profiles: req.profiles,
    slots,
    signals:  JSON.stringify(signals),
    extraCss: '/css/settings.css',
  });
});


/* ─────────────────────────────────────────────────────────────
   Add time slot  POST /api/settings/slots
   ───────────────────────────────────────────────────────────── */

router.post('/api/settings/slots', requireAuth, loadAppContext, async (req, res) => {
  const label = String(req.body.newSlotLabel ?? '').trim();
  if (!label) return res.redirect('/app/settings');

  const maxRes = await db.execute({
    sql:  'SELECT MAX(sort_order) AS mx FROM time_slots WHERE profile_id = ?',
    args: [req.profile.id],
  });
  const nextOrder = (Number(maxRes.rows[0]?.mx ?? -1)) + 1;

  await db.execute({
    sql:  'INSERT INTO time_slots (id, profile_id, label, sort_order) VALUES (?, ?, ?, ?)',
    args: [randomUUID(), req.profile.id, label, nextOrder],
  });

  res.redirect('/app/settings');
});


/* ─────────────────────────────────────────────────────────────
   Delete time slot  POST /api/settings/slots/:id/delete
   (registered before /:id to avoid shadowing)
   ───────────────────────────────────────────────────────────── */

router.post('/api/settings/slots/:id/delete', requireAuth, loadAppContext, async (req, res) => {
  const { id } = req.params;

  await db.execute({
    sql:  'DELETE FROM time_slots WHERE id = ? AND profile_id = ?',
    args: [id, req.profile.id],
  });

  res.redirect('/app/settings');
});


/* ─────────────────────────────────────────────────────────────
   Autosave slot label  POST /api/settings/slots/:id
   Datastar SSE — reads signal "label{hexId}" from body
   ───────────────────────────────────────────────────────────── */

router.post('/api/settings/slots/:id', requireAuth, loadAppContext, async (req, res) => {
  sseHeaders(res);
  const { id } = req.params;

  const check = await db.execute({
    sql:  'SELECT id FROM time_slots WHERE id = ? AND profile_id = ?',
    args: [id, req.profile.id],
  });
  if (!check.rows.length) {
    res.write('event: datastar-merge-signals\ndata: signals {"saveStatus":"error"}\n\n');
    return res.end();
  }

  const label = String(req.body[slotSignalKey(id)] ?? '').trim();
  if (!label) {
    res.write('event: datastar-merge-signals\ndata: signals {"saveStatus":"error"}\n\n');
    return res.end();
  }

  await db.execute({
    sql:  'UPDATE time_slots SET label = ? WHERE id = ?',
    args: [label, id],
  });

  res.write('event: datastar-merge-signals\ndata: signals {"saveStatus":"saved"}\n\n');
  res.end();
});


export default router;
