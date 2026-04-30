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
