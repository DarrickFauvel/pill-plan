import { Router } from 'express';
import bcrypt from 'bcrypt';
import db from '../db/client.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.get('/export', requireAuth, async (req, res) => {
  const userId = req.user.id;

  const [{ rows: user }, { rows: profiles }, { rows: medications }, { rows: entries }] = await Promise.all([
    db.execute({ sql: 'SELECT email, created_at FROM users WHERE id = ?', args: [userId] }),
    db.execute({ sql: 'SELECT id, name, avatar_color, organizer_type, organizer_count, created_at FROM profiles WHERE user_id = ?', args: [userId] }),
    db.execute({ sql: 'SELECT m.id, m.profile_id, m.name, m.strength, m.form, m.instructions, m.rxcui, m.total_quantity, m.bottle_quantity, m.refill_threshold, m.not_in_organizer, m.active, m.created_at FROM medications m JOIN profiles p ON p.id = m.profile_id WHERE p.user_id = ?', args: [userId] }),
    db.execute({ sql: 'SELECT ge.id, ge.medication_id, ge.slot_id, ge.taken_date, ge.status, ge.created_at FROM grid_entries ge JOIN medications m ON m.id = ge.medication_id JOIN profiles p ON p.id = m.profile_id WHERE p.user_id = ?', args: [userId] }),
  ]);

  const payload = {
    exported_at: new Date().toISOString(),
    account: { email: String(user[0].email), created_at: String(user[0].created_at) },
    profiles: profiles.map((r) => ({ ...r })),
    medications: medications.map((r) => ({ ...r })),
    grid_entries: entries.map((r) => ({ ...r })),
  };

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', 'attachment; filename="medigrid-data.json"');
  res.send(JSON.stringify(payload, null, 2));
});

router.post('/delete', requireAuth, async (req, res) => {
  const password = String(req.body.password ?? '');
  if (!password) return res.redirect('/app/settings?error=delete-password');

  const { rows } = await db.execute({ sql: 'SELECT password FROM users WHERE id = ?', args: [req.user.id] });
  if (!rows.length) return res.redirect('/login');

  const match = await bcrypt.compare(password, String(rows[0].password));
  if (!match) return res.redirect('/app/settings?error=delete-password');

  await db.execute({ sql: 'DELETE FROM users WHERE id = ?', args: [req.user.id] });

  res.clearCookie('sid');
  res.clearCookie('pid');
  res.redirect('/');
});

export default router;
