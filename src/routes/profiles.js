import { Router } from 'express';
import db from '../db/client.js';
import { requireAuth, loadAppContext } from '../middleware/auth.js';

const router = Router();

/**
 * POST /switch/:id
 * Verifies the profile belongs to the authenticated user, then sets the `pid`
 * cookie and redirects back to the referrer (or /app/grid as fallback).
 */
router.post('/switch/:id', async (req, res) => {
  const { id } = req.params;

  const { rows } = await db.execute({
    sql: 'SELECT id FROM profiles WHERE id = ? AND user_id = ?',
    args: [id, req.user.id],
  });

  if (!rows.length) {
    return res.redirect('/app/grid');
  }

  res.cookie('pid', id, {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
  });

  const back = req.get('Referer') ?? '/app/grid';
  res.redirect(back);
});

export default router;
