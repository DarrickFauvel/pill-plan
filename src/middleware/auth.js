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
    sql: `SELECT s.user_id, u.email
          FROM sessions s
          JOIN users u ON u.id = s.user_id
          WHERE s.id = ? AND s.expires_at > ?`,
    args: [sessionId, new Date().toISOString()],
  });

  if (!rows.length) {
    res.clearCookie('sid');
    return res.redirect('/login');
  }

  req.user = { id: String(rows[0].user_id), email: String(rows[0].email) };
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
  const { rows } = await db.execute({
    sql: `SELECT id, name, avatar_color, organizer_type
          FROM profiles
          WHERE user_id = ?
          ORDER BY created_at ASC`,
    args: [req.user.id],
  });

  /** @type {Array<{id: string, name: string, avatarColor: string, organizerType: string}>} */
  const profiles = rows.map((r) => ({
    id:            String(r.id),
    name:          String(r.name),
    avatarColor:   String(r.avatar_color),
    organizerType: String(r.organizer_type ?? '7x4'),
  }));

  const pidCookie = req.cookies?.pid;
  const active = profiles.find((p) => p.id === pidCookie) ?? profiles[0];

  res.cookie('pid', active.id, {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
  });

  req.profile = active;
  req.profiles = profiles;
  next();
}
