import { Router } from 'express';
import { randomUUID } from 'crypto';
import db from '../db/client.js';
import { requireAuth, loadAppContext } from '../middleware/auth.js';

const router = Router();

const AVATAR_COLORS = new Set([
  '#6EC6A0', '#5B9BD5', '#E07B54', '#C66E99',
  '#8B7CD4', '#E0B84E', '#5BA85B', '#D45B5B',
]);

/* ─────────────────────────────────────────────────────────────
   New profile form  GET /app/profiles/new
   ───────────────────────────────────────────────────────────── */

router.get('/new', async (req, res) => {
  res.render('pages/profile-new', {
    title:     'Add profile',
    path:      '/app/profiles/new',
    profile:   req.profile,
    profiles:  req.profiles,
    error:     req.query.error === 'invalid' ? true : null,
    formName:  String(req.query.name ?? ''),
    formColor: AVATAR_COLORS.has(String(req.query.color ?? '')) ? String(req.query.color) : '#6EC6A0',
    extraCss:  '/css/profiles.css',
  });
});


/* ─────────────────────────────────────────────────────────────
   Create profile  POST /app/profiles
   ───────────────────────────────────────────────────────────── */

router.post('/', async (req, res) => {
  const name  = String(req.body.name ?? '').trim();
  const color = String(req.body.avatarColor ?? '').trim();

  if (!name || !AVATAR_COLORS.has(color)) {
    const params = new URLSearchParams({ error: 'invalid', name, color });
    return res.redirect(`/app/profiles/new?${params}`);
  }

  const profileId = randomUUID();
  const now       = new Date().toISOString();

  await db.execute({
    sql:  'INSERT INTO profiles (id, user_id, name, avatar_color, created_at) VALUES (?, ?, ?, ?, ?)',
    args: [profileId, req.user.id, name, color, now],
  });

  for (const [i, label] of ['Morning', 'Noon', 'Evening', 'Bedtime'].entries()) {
    await db.execute({
      sql:  'INSERT INTO time_slots (id, profile_id, label, sort_order) VALUES (?, ?, ?, ?)',
      args: [randomUUID(), profileId, label, i],
    });
  }

  res.cookie('pid', profileId, {
    httpOnly: true,
    sameSite: 'strict',
    secure:   process.env.NODE_ENV === 'production',
  });

  res.redirect('/app/grid');
});


/* ─────────────────────────────────────────────────────────────
   Switch profile  POST /switch/:id
   ───────────────────────────────────────────────────────────── */

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
