# MediGrid — Claude Code Guide

## What This Project Is

A PWA for organizing medications and verifying pill organizer refills. Full product spec in `SPEC.md`.

## Stack Conventions

### HTML
- Semantic HTML5 only — use `<nav>`, `<main>`, `<article>`, `<section>`, `<aside>`, `<header>`, `<footer>` appropriately
- No `<div>` soup — every element should have a semantic reason
- Datastar attributes live on HTML elements (`data-signals`, `data-on-click`, `data-bind`, etc.)

### CSS
- All design tokens in `public/css/tokens.css` as CSS custom properties
- Use `@layer` for cascade management: `@layer base, components, utilities`
- Prefer `grid` and `flex` — no floats, no absolute positioning for layout
- Fluid sizing with `clamp()` — no hard breakpoints where avoidable
- `@media print` styles in `public/css/grid.css` for the printable grid

### JavaScript
- ES2022+ (`?.`, `??`, `structuredClone`, top-level await where applicable)
- JSDoc type annotations on every function and non-trivial variable — no TypeScript, but types must be documented
- No build step — files are served directly from `public/js/`
- No front-end framework — Datastar handles all reactivity

### Datastar
- Datastar drives all client ↔ server interaction via SSE
- The server sends HTML fragments; Datastar merges them into the DOM
- Use `data-on-click="@post('/api/...')"` for mutations
- Use `data-on-load="@get('/api/...')"` to populate on mount
- Server responses must be SSE streams with `datastar-merge-fragments`, `datastar-merge-signals`, or `datastar-execute-script` events
- Never return JSON to Datastar endpoints — always return SSE with HTML fragments
- Keep fragments small and targeted — update only the element that changed

**SSE response format (Express):**
```js
res.setHeader('Content-Type', 'text/event-stream');
res.setHeader('Cache-Control', 'no-cache');
res.setHeader('Connection', 'keep-alive');

res.write(`event: datastar-merge-fragments\ndata: fragments <div id="target">...</div>\n\n`);
res.end();
```

### Express
- Routes in `src/routes/` — one file per resource
- Auth middleware in `src/middleware/auth.js` — applied to all `/api/*` and `/app/*` routes
- SSE stream endpoint at `GET /api/sse` — one persistent connection per session
- Return HTML fragments from route handlers, not JSON (except `/api/meds/search` which proxies RxNorm)
- Use `express-async-errors` or wrap handlers — never let unhandled promise rejections crash the server

### Turso / libSQL
- Client initialized once in `src/db/client.js`, imported everywhere
- Use parameterized queries always — never string-interpolate user input into SQL
- Migrations as plain SQL files in `src/db/migrations/`, run in order
- IDs are `TEXT` (ULIDs or `crypto.randomUUID()`) — never auto-increment integers
- Dates stored as ISO 8601 strings (`new Date().toISOString()`)

### Auth
- Sessions stored in the `sessions` table in Turso
- Session ID in an `HttpOnly; Secure; SameSite=Strict` cookie named `sid`
- Passwords hashed with `bcrypt` (cost factor 12)
- `src/middleware/auth.js` looks up the session on every request and attaches `req.user` and `req.profile`

### RxNorm API
- Proxied through Express at `/api/meds/search` and `/api/meds/details/:rxcui`
- Never call RxNorm directly from the client
- Base URL: `https://rxnav.nlm.nih.gov/REST`
- Autocomplete: `GET /approximateTerm.json?term={q}&maxEntries=10`
- Details: `GET /rxcui/{rxcui}/properties.json`

## Code Style

- No comments unless the WHY is non-obvious
- No `console.log` left in committed code — use a thin logger wrapper
- Prefer `const` over `let`; never `var`
- Destructure function parameters when there are more than 2
- Error messages shown to users must be friendly — never expose stack traces or SQL errors

## File Structure

```
public/          # Static assets served directly
  css/
    tokens.css   # Design tokens (edit here first)
    base.css
    components.css
    grid.css     # Grid-specific styles + @media print
  js/
    app.js
    grid.js
  manifest.json
  sw.js
src/
  server.js      # Express app entry point
  db/
    client.js    # Turso client singleton
    migrations/
  routes/        # One file per resource
  middleware/
    auth.js
  services/
    rxnorm.js    # RxNorm API wrapper
    gridBuilder.js
    notifications.js
  views/
    fragments/   # HTML partials returned via SSE
    pages/       # Full page HTML
```

## Running Locally

```bash
npm install
npm run dev
```

Requires `.env`:
```
TURSO_URL=
TURSO_AUTH_TOKEN=
SESSION_SECRET=
PORT=3000
```
