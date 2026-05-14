/**
 * Redirect non-Pro users to the billing page with an optional reason hint.
 *
 * @param {string} [reason]
 * @returns {import('express').RequestHandler}
 */
export function requirePro(reason = 'upgrade') {
  return (req, res, next) => {
    if (req.user.isPro) return next();
    res.redirect(`/app/billing?reason=${encodeURIComponent(reason)}`);
  };
}

/**
 * Return 402 JSON for non-Pro users on fetch-based API routes.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
export function requireProJson(req, res, next) {
  if (req.user.isPro) return next();
  res.status(402).json({ error: 'Pro plan required' });
}

/**
 * Return 402 for non-Pro users on API/SSE routes (used where a redirect
 * would break a Datastar SSE response).
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
export function requireProApi(req, res, next) {
  if (req.user.isPro) return next();
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.write('event: datastar-patch-signals\ndata: signals {"saveStatus":"error"}\n\n');
  res.end();
}
