/**
 * Restrict access to admin routes.
 * Allowed emails are set in ADMIN_EMAILS (comma-separated).
 *
 * Must run after requireAuth so req.user is available.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
export function requireAdmin(req, res, next) {
  const allowed = (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  if (allowed.includes(req.user.email.toLowerCase())) return next();

  res.status(403).send('Forbidden');
}
