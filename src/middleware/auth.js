import db from '../db/client.js';

/**
 * Attaches req.user to authenticated requests.
 * Redirects to /login if the session is missing or expired.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
export async function requireAuth(req, res, next) {
  const sessionId = req.cookies?.sid;
  if (!sessionId) return res.redirect('/login');

  const { rows } = await db.execute({
    sql: `SELECT s.user_id, u.email, u.plan, u.plan_expires_at,
                 u.stripe_customer_id, u.stripe_subscription_id
          FROM sessions s
          JOIN users u ON u.id = s.user_id
          WHERE s.id = ? AND s.expires_at > ?`,
    args: [sessionId, new Date().toISOString()],
  });

  if (!rows.length) {
    res.clearCookie('sid');
    return res.redirect('/login');
  }

  const row = rows[0];
  const planExpiresAt = row.plan_expires_at ? String(row.plan_expires_at) : null;
  req.user = {
    id:                   String(row.user_id),
    email:                String(row.email),
    plan:                 String(row.plan ?? 'free'),
    stripeCustomerId:     row.stripe_customer_id ? String(row.stripe_customer_id) : null,
    stripeSubscriptionId: row.stripe_subscription_id ? String(row.stripe_subscription_id) : null,
    planExpiresAt,
    isPro: row.plan === 'pro' && (!planExpiresAt || new Date(planExpiresAt) > new Date()),
  };
  next();
}

/**
 * Loads all profiles for the authenticated user and resolves the active profile
 * from the `pid` cookie (falling back to the first profile).
 * Sets req.profile and req.profiles; refreshes the `pid` cookie.
 *
 * Must run after requireAuth.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
export async function loadAppContext(req, res, next) {
  const [ownedResult, sharedResult] = await Promise.all([
    db.execute({
      sql: `SELECT id, name, avatar_color, organizer_type, organizer_count
            FROM profiles WHERE user_id = ? ORDER BY created_at ASC`,
      args: [req.user.id],
    }),
    db.execute({
      sql: `SELECT p.id, p.name, p.avatar_color, p.organizer_type, p.organizer_count,
                   ps.invited_email AS shared_by_email
            FROM profiles p
            JOIN profile_shares ps ON ps.profile_id = p.id
            WHERE ps.shared_with_user_id = ? AND ps.accepted_at IS NOT NULL`,
      args: [req.user.id],
    }),
  ]);

  /**
   * @typedef {{ id: string, name: string, avatarColor: string, organizerType: string, organizerCount: number, isOwned: boolean, sharedByEmail: string | null }} Profile
   * @type {Profile[]}
   */
  const profiles = [
    ...ownedResult.rows.map((r) => ({
      id:             String(r.id),
      name:           String(r.name),
      avatarColor:    String(r.avatar_color),
      organizerType:  String(r.organizer_type ?? '7x4'),
      organizerCount: Number(r.organizer_count ?? 1),
      isOwned:        true,
      sharedByEmail:  null,
    })),
    ...sharedResult.rows.map((r) => ({
      id:             String(r.id),
      name:           String(r.name),
      avatarColor:    String(r.avatar_color),
      organizerType:  String(r.organizer_type ?? '7x4'),
      organizerCount: Number(r.organizer_count ?? 1),
      isOwned:        false,
      sharedByEmail:  String(r.shared_by_email),
    })),
  ];

  const pidCookie = req.cookies?.pid;
  const active = profiles.find((p) => p.id === pidCookie) ?? profiles[0];

  if (!active) {
    res.clearCookie('sid');
    res.clearCookie('pid');
    return res.redirect('/signup');
  }

  res.cookie('pid', active.id, {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
  });

  req.profile = active;
  req.profiles = profiles;
  next();
}
