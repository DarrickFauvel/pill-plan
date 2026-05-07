import { Router } from 'express';
import db from '../db/client.js';

const router = Router();

const VALID_PLANS = new Set(['free', 'pro']);
const PAGE_SIZE = 25;

/**
 * @param {string} iso
 * @returns {string}
 */
function fmtDate(iso) {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
  });
}


/* ─────────────────────────────────────────────────────────────
   GET /admin  →  redirect to dashboard
   ───────────────────────────────────────────────────────────── */

router.get('/', (req, res) => res.redirect('/admin/dashboard'));


/* ─────────────────────────────────────────────────────────────
   GET /admin/dashboard
   ───────────────────────────────────────────────────────────── */

router.get('/dashboard', async (req, res) => {
  const [
    usersRes,
    proRes,
    new7dRes,
    new30dRes,
    active7dRes,
    profilesRes,
    medsRes,
    entriesRes,
  ] = await Promise.all([
    db.execute('SELECT COUNT(*) AS n FROM users'),
    db.execute("SELECT COUNT(*) AS n FROM users WHERE plan = 'pro'"),
    db.execute("SELECT COUNT(*) AS n FROM users WHERE created_at > datetime('now', '-7 days')"),
    db.execute("SELECT COUNT(*) AS n FROM users WHERE created_at > datetime('now', '-30 days')"),
    db.execute("SELECT COUNT(DISTINCT user_id) AS n FROM sessions WHERE expires_at > datetime('now', '-7 days')"),
    db.execute('SELECT COUNT(*) AS n FROM profiles'),
    db.execute('SELECT COUNT(*) AS n FROM medications WHERE active = 1'),
    db.execute('SELECT COUNT(*) AS n FROM grid_entries'),
  ]);

  const totalUsers = Number(usersRes.rows[0].n);
  const proUsers   = Number(proRes.rows[0].n);

  res.render('pages/admin/dashboard', {
    title:        'Admin — Dashboard',
    adminPath:    '/admin/dashboard',
    user:         req.user,
    stats: {
      totalUsers,
      proUsers,
      freeUsers:  totalUsers - proUsers,
      new7d:      Number(new7dRes.rows[0].n),
      new30d:     Number(new30dRes.rows[0].n),
      active7d:   Number(active7dRes.rows[0].n),
      profiles:   Number(profilesRes.rows[0].n),
      medications: Number(medsRes.rows[0].n),
      entries:    Number(entriesRes.rows[0].n),
    },
    extraCss: '/css/admin.css',
  });
});


/* ─────────────────────────────────────────────────────────────
   GET /admin/users
   ───────────────────────────────────────────────────────────── */

router.get('/users', async (req, res) => {
  const planFilter = ['free', 'pro'].includes(String(req.query.plan ?? ''))
    ? String(req.query.plan)
    : null;
  const page   = Math.max(1, parseInt(String(req.query.page ?? '1'), 10) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  const whereClause = planFilter ? `WHERE u.plan = '${planFilter}'` : '';

  const [usersRes, countRes] = await Promise.all([
    db.execute({
      sql: `SELECT u.id, u.email, u.plan, u.created_at,
                   COUNT(DISTINCT p.id) AS profile_count,
                   COUNT(DISTINCT m.id) AS med_count
            FROM users u
            LEFT JOIN profiles p ON p.user_id = u.id
            LEFT JOIN medications m ON m.profile_id = p.id AND m.active = 1
            ${whereClause}
            GROUP BY u.id
            ORDER BY u.created_at DESC
            LIMIT ? OFFSET ?`,
      args: [PAGE_SIZE, offset],
    }),
    db.execute({
      sql: `SELECT COUNT(*) AS n FROM users u ${whereClause}`,
      args: [],
    }),
  ]);

  const total     = Number(countRes.rows[0].n);
  const totalPages = Math.ceil(total / PAGE_SIZE);

  const users = usersRes.rows.map((r) => ({
    id:           String(r.id),
    email:        String(r.email),
    plan:         String(r.plan),
    createdAt:    fmtDate(String(r.created_at)),
    profileCount: Number(r.profile_count),
    medCount:     Number(r.med_count),
  }));

  res.render('pages/admin/users', {
    title:      'Admin — Users',
    adminPath:  '/admin/users',
    user:       req.user,
    users,
    planFilter,
    page,
    totalPages,
    total,
    extraCss:   '/css/admin.css',
  });
});


/* ─────────────────────────────────────────────────────────────
   GET /admin/users/:id
   ───────────────────────────────────────────────────────────── */

router.get('/users/:id', async (req, res) => {
  const { id } = req.params;

  const userRes = await db.execute({
    sql:  'SELECT id, email, plan, stripe_customer_id, stripe_subscription_id, plan_expires_at, created_at FROM users WHERE id = ?',
    args: [id],
  });
  if (!userRes.rows.length) return res.status(404).send('User not found');

  const row = userRes.rows[0];
  const target = {
    id:                   String(row.id),
    email:                String(row.email),
    plan:                 String(row.plan),
    stripeCustomerId:     row.stripe_customer_id ? String(row.stripe_customer_id) : null,
    stripeSubscriptionId: row.stripe_subscription_id ? String(row.stripe_subscription_id) : null,
    planExpiresAt:        row.plan_expires_at ? fmtDate(String(row.plan_expires_at)) : null,
    createdAt:            fmtDate(String(row.created_at)),
  };

  const profilesRes = await db.execute({
    sql:  `SELECT p.id, p.name, p.organizer_type, p.avatar_color,
                  COUNT(m.id) AS med_count
           FROM profiles p
           LEFT JOIN medications m ON m.profile_id = p.id AND m.active = 1
           WHERE p.user_id = ?
           GROUP BY p.id
           ORDER BY p.created_at ASC`,
    args: [id],
  });

  const profiles = profilesRes.rows.map((p) => ({
    id:            String(p.id),
    name:          String(p.name),
    organizerType: String(p.organizer_type ?? '7x4'),
    avatarColor:   String(p.avatar_color ?? '#6EC6A0'),
    medCount:      Number(p.med_count),
  }));

  res.render('pages/admin/user', {
    title:     `Admin — ${target.email}`,
    adminPath: '/admin/users',
    user:      req.user,
    target,
    profiles,
    success:   req.query.updated === '1',
    extraCss:  '/css/admin.css',
  });
});


/* ─────────────────────────────────────────────────────────────
   POST /admin/users/:id/plan
   ───────────────────────────────────────────────────────────── */

router.post('/users/:id/plan', async (req, res) => {
  const { id } = req.params;
  const plan = String(req.body.plan ?? '').trim();

  if (!VALID_PLANS.has(plan)) {
    return res.redirect(`/admin/users/${id}`);
  }

  await db.execute({
    sql:  'UPDATE users SET plan = ?, plan_expires_at = NULL WHERE id = ?',
    args: [plan, id],
  });

  res.redirect(`/admin/users/${id}?updated=1`);
});


export default router;
