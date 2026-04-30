# MediGrid — Claude Code Guide

## What This Project Is

A PWA for organizing medications and verifying pill organizer refills. Full product spec in `SPEC.md`.

## Stack Conventions

### HTML
- Semantic HTML5 only — use `<nav>`, `<main>`, `<article>`, `<section>`, `<aside>`, `<header>`, `<footer>` appropriately
- No `<div>` soup — every element should have a semantic reason
- Every page must have `<meta name="viewport" content="width=device-width, initial-scale=1">`
- Every page must have a skip link as the first focusable element: `<a href="#main" class="skip-link">Skip to content</a>`
- Use correct `type` attributes on inputs: `type="email"`, `type="tel"`, `type="number"` — triggers the right mobile keyboard
- Every `<input>` and `<select>` must have an associated `<label>` — never use `placeholder` as a substitute
- Every icon-only button must have `aria-label` describing its action
- SSE-updated regions must have `aria-live="polite"` so screen readers announce changes
- The Grid must use `role="grid"` / `role="row"` / `role="gridcell"` with descriptive `aria-label` per cell
- Destructive actions (`<button>` that deletes) need `aria-describedby` pointing to a warning
- Datastar attributes live on HTML elements (`data-signals`, `data-on-click`, `data-bind`, etc.)

### CSS
- **Mobile-first always** — base styles target small screens, `@media (min-width: ...)` layers on desktop enhancements. Never write desktop-first styles and work down.
- **Relative units always** — use `px` only where a physical pixel is the right unit (borders, outlines, box-shadows, media query breakpoints). Everything else:
  - Font sizes: `rem` (relative to root, respects browser zoom and user font preferences)
  - Component-internal spacing (padding, margin, gap): `em` so it scales with the component's own font size
  - Layout widths: `%`, `fr`, or `ch` (e.g. `max-width: 65ch` for readable line lengths)
  - Viewport-relative: `dvh`/`dvw` (dynamic viewport units) instead of `vh`/`vw` — avoids mobile browser chrome issues
  - Fluid ranges: `clamp(min, preferred, max)` with `rem`/`vw` inside
  - Tap target minimums expressed in `rem`: `3.5rem` (56px at default root) — scales with user zoom
- All design tokens in `public/css/tokens.css` as CSS custom properties
- Use `@layer` for cascade management: `@layer base, components, utilities`
- Prefer `grid` and `flex` — no floats, no absolute positioning for layout
- **Tap targets: `3.5rem × 3.5rem` minimum** for primary actions — seniors have reduced fine motor control
- Spacing between interactive elements: never less than `0.5rem`
- No hover-only affordances — touch devices have no hover state
- `touch-action: manipulation` on buttons and links to eliminate tap delay
- **Font sizes: never below `1.125rem`** — seniors need larger text
- Visible focus ring: `outline: 3px solid var(--color-primary); outline-offset: 3px` — never `outline: none`
- Color is never the sole state indicator — always pair with icon, label, or pattern
- Contrast: minimum 4.5:1 for body text; 7:1 preferred for critical labels
- `@media (prefers-contrast: more)` — darken borders, remove transparency
- `@media (prefers-reduced-motion: reduce)` — disable all transitions and animations
- `@media (prefers-color-scheme: dark)` — high-contrast dark palette
- `@media print` styles in `public/css/grid.css` for the printable grid

### JavaScript
- ES2022+ (`?.`, `??`, `structuredClone`, top-level await where applicable)
- JSDoc type annotations on every function and non-trivial variable — no TypeScript, but types must be documented
- No build step — files are served directly from `public/js/`
- No front-end framework — Datastar handles all reactivity

### Datastar
Datastar drives all client ↔ server interaction via a persistent SSE connection. **Signals are the default — DOM fragment replacement is the last resort.**

**Event priority (use the highest one that fits):**

1. **`datastar-merge-signals`** — preferred. Send updated data values; Datastar's reactive bindings (`data-text`, `data-bind`, `data-show`, `data-class`) update the DOM without any replacement. Zero reflow for elements already in the DOM.
2. **`datastar-execute-script`** — for lightweight client-side actions (toasts, focus management, scroll) that don't need a DOM node replaced.
3. **`datastar-merge-fragments`** — only when the shape of the HTML itself changes (e.g., a list item is added/removed, a new card is inserted). Never use this to update a value that a signal binding can handle.

**When using `datastar-merge-fragments`:**
- Always target the smallest possible element by `id` — never replace a parent when a child is all that changed
- Use `data-merge-mode="morph"` to diff/patch the existing node instead of replacing it — preserves focus, scroll position, and input state
- Never send large HTML subtrees; pre-compute data in the route handler and keep templates lean

**Signals on the page:**
- Declare all reactive state in `data-signals` on a top-level element at page load
- Bind display to signals with `data-text="$signalName"`, `data-show="$condition"`, `data-class`
- The server pushes `datastar-merge-signals` to update values; bindings handle the rest automatically

**General rules:**
- Use `data-on-click="@post('/api/...')"` for mutations
- Use `data-on-load="@get('/api/...')"` to populate on mount
- Never return JSON to Datastar endpoints — always SSE
- One persistent SSE connection per session at `GET /api/sse`; do not open a new connection per action

**SSE response helpers (Express):**
```js
/** @param {import('express').Response} res */
function sseHeaders(res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
}

// Preferred: signal update — no DOM replacement
res.write(`event: datastar-merge-signals\ndata: signals {"daysRemaining": 12, "refillAlert": false}\n\n`);

// Only when HTML shape changes: morph the existing node
res.write(`event: datastar-merge-fragments\ndata: merge morph\ndata: fragments <li id="med-123">...</li>\n\n`);

res.end();
```

### Eta Templating
- All server-rendered HTML uses [Eta](https://eta.js.org) templates (`.eta` files in `src/views/`)
- Configure Eta once in `src/server.js`: `app.engine('eta', eta.renderFile)` + `app.set('view engine', 'eta')`
- Full pages: `res.render('pages/grid', { data })` — Eta extends the base layout
- SSE fragments: `eta.renderFile('fragments/grid-cell', data)` then write to the SSE stream — do not use `res.render` for fragments
- Base layout at `src/views/layouts/base.eta` — contains `<head>`, skip link, nav, and `<%~ it.body %>` slot
- Pages extend the base layout using Eta's `layout()` helper: `<% layout('layouts/base') %>`
- Keep logic out of templates — pass pre-computed values from the route handler, never query the DB inside a template
- Template variables use `<%= it.value %>` (escaped) by default; use `<%~ it.html %>` only for trusted server-generated HTML fragments

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

### Autosave & Save Indicator
All data-writing inputs use debounced autosave — no save buttons. The save indicator is a fixed bottom-right chip driven entirely by the `$saveStatus` signal.

**Client-side (JS):**
```js
/** @type {ReturnType<typeof setTimeout> | null} */
let saveTimer = null;

/**
 * Call on every `input` event for autosaved fields.
 * @param {() => void} saveFn - the Datastar POST trigger
 */
function scheduleAutosave(saveFn) {
  clearTimeout(saveTimer);
  sse.mergeSignals({ saveStatus: 'pending' });
  saveTimer = setTimeout(saveFn, 1000);
}
```

- Debounce delay: **1000ms** — long enough to avoid thrashing, short enough to feel live
- On POST fire: set `saveStatus` to `"saving"` before the request leaves
- On success response: server emits `datastar-merge-signals` → `{"saveStatus": "saved"}`
- After 2000ms on client: reset `saveStatus` to `"idle"` via a `setTimeout`
- On error response: server emits `{"saveStatus": "error"}` — stays visible until next success

**HTML (in base layout):**
```html
<div
  id="save-indicator"
  role="status"
  aria-live="polite"
  data-show="$saveStatus !== 'idle'"
  data-class="{'save-indicator--error': $saveStatus === 'error'}"
>
  <span data-show="$saveStatus === 'saving'">Saving…</span>
  <span data-show="$saveStatus === 'saved'">Saved</span>
  <span data-show="$saveStatus === 'error'">Not saved</span>
</div>
```

- One indicator instance in `layouts/base.eta` — shared across all pages
- `pointer-events: none` when `idle` or `saved` — never blocks tap targets
- Does **not** apply to delete/deactivate — those use confirmation dialogs, not autosave

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
- Error messages shown to users must be friendly and specific — never expose stack traces or SQL errors, never just say "invalid"
- Destructive actions always require a confirmation step before executing
- No auto-dismissing toasts for critical information — use persistent banners

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
    layouts/
      base.eta       # Base layout — head, skip link, nav, body slot
    fragments/       # Partial .eta templates returned via SSE
    pages/           # Full page .eta templates
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
