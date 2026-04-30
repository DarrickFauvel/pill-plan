# MediGrid — App Specification

## Overview

MediGrid is a Progressive Web App (PWA) for organizing medications and verifying weekly pill organizer refills. It serves both patients managing their own medications and caregivers managing medications for others. A single account supports multiple named profiles (e.g., "Mom", "Self", "Dad").

The centerpiece is **The Grid** — a visual, date-aware representation of a physical 7-day pill organizer that spans a full month, supports custom time slots, and can be printed.

---

## Design System

### Aesthetic
Health-app aesthetic — calm, clinical-clean, approachable. Reference: Apple Health, Calm, Headspace. No harsh edges, no dense tables.

### Palette
| Token | Value | Use |
|---|---|---|
| `--color-primary` | `#6EC6A0` | Actions, active states, brand |
| `--color-secondary` | `#7BB8D4` | Accents, info, secondary actions |
| `--color-surface` | `#F5FAFA` | Page backgrounds |
| `--color-card` | `#FFFFFF` | Cards, modals |
| `--color-text` | `#1A2E2A` | Body text |
| `--color-muted` | `#7A9A94` | Secondary text, placeholders |
| `--color-warning` | `#F4A261` | Refill alerts |
| `--color-danger` | `#E76F51` | Missed doses |
| `--color-border` | `#D4E8E2` | Borders, dividers |

### Typography
- Font: System stack (`-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`)
- Scale: 4-step fluid type scale using `clamp()`
- Line height: 1.5 body, 1.2 headings

### Spacing & Radius
All sizing uses relative units — `rem` for font sizes and global spacing, `em` for component-internal spacing, `%`/`fr`/`ch` for layout, `dvh`/`dvw` for viewport. `px` is reserved for borders, outlines, box-shadows, and media query breakpoints.

- Base spacing unit: `0.5rem`
- Card radius: `1rem`
- Button radius: `0.5rem`
- Grid cell radius: `0.75rem`

### Motion
- Transitions: `150ms ease` for interactive states
- SSE-driven updates use CSS `@starting-style` for smooth fragment merges

### Accessibility — Senior-Optimized
A significant portion of users are seniors or caregivers for seniors. Accessibility is a core requirement, not an afterthought. Target WCAG 2.1 AA minimum; AAA where feasible.

**Vision**
- Body text minimum `1.125rem` (`18px`); never smaller
- Heading scale starts at `1.5rem` and steps up — no small headings
- Color contrast: minimum 4.5:1 for body text, 3:1 for large text and UI components (WCAG AA); prefer 7:1 for critical labels (AAA)
- Color is never the sole indicator of state — always pair with an icon, label, or pattern
- Support `@media (prefers-contrast: more)` — darken borders and text, remove transparency
- Support `@media (prefers-color-scheme: dark)` — high-contrast dark palette

**Motor**
- Minimum tap target: `3.5rem × 3.5rem` for primary actions (56px at default root — exceeds WCAG 2.5.5's 44px; scales with user zoom for seniors with accessibility font settings)
- Generous spacing between tap targets — no two interactive elements closer than `8px`
- No drag-and-drop as the only interaction path — always provide a button alternative
- No double-tap or long-press required for any primary action

**Cognitive**
- Plain language throughout — no medical jargon without explanation
- Labels on every interactive element — no icon-only buttons
- Destructive actions always require an explicit confirmation step
- Error messages state exactly what went wrong and how to fix it — never just "invalid"
- No auto-dismissing toasts for critical information — use persistent banners that require acknowledgment
- Session timeout warnings give at least 2 minutes notice with a clear "Stay logged in" option
- Consistent navigation — controls stay in the same place across pages

**Motion & Time**
- Respect `@media (prefers-reduced-motion: reduce)` — disable all transitions and animations
- No content that flashes more than 3 times per second
- No time limits on any task — seniors may take longer to complete forms

**Focus & Keyboard**
- Visible focus ring on every interactive element: `outline: 3px solid var(--color-primary); outline-offset: 3px`
- Logical tab order follows visual reading order
- Skip-to-main-content link as first focusable element on every page
- Modal/sheet traps focus within it while open; returns focus on close

**Screen Reader**
- `aria-label` or `aria-labelledby` on every interactive element that lacks visible text
- Live regions (`aria-live="polite"`) on SSE-updated areas so screen readers announce changes
- Status messages (dose taken, refill logged) announced via `role="status"`
- The Grid uses `role="grid"`, `role="row"`, `role="gridcell"` with descriptive `aria-label` per cell (e.g., "Wednesday April 15, Morning slot, 2 medications, all taken")

### Mobile-First
MediGrid is primarily used on phones — patients checking doses, caregivers logging refills on the go. Desktop is an enhancement, not the baseline.

- All CSS written mobile-first: base styles target small screens, `@media (min-width: ...)` adds desktop enhancements
- Minimum tap target size: `44px × 44px` (WCAG 2.5.5)
- Touch-friendly interactions: no hover-only affordances, no tiny controls
- Bottom navigation bar on mobile (thumb reach); sidebar on desktop
- The Grid scrolls horizontally on small screens — one week visible at a time with swipe navigation; full month visible on desktop
- Inputs use appropriate `type` attributes (`tel`, `number`, `email`) to trigger the right mobile keyboard
- No `300ms` tap delay — `touch-action: manipulation` on interactive elements
- Viewport meta: `<meta name="viewport" content="width=device-width, initial-scale=1">`
- Font sizes never below `1rem` on mobile — no pinch-to-read
- Forms are single-column on mobile, can go multi-column on desktop
- Modals are full-screen bottom sheets on mobile, centered dialogs on desktop

---

## Tech Stack

| Layer | Choice |
|---|---|
| Markup | Semantic HTML5 |
| Styles | Modern CSS (custom properties, container queries, `@layer`, `grid`, `clamp()`) |
| Client logic | Vanilla JS (ES2022+, JSDoc type annotations throughout) |
| Reactivity | [Datastar](https://data-star.dev) — hypermedia signals + SSE fragment merges |
| Server | Node.js + Express |
| Templating | [Eta](https://eta.js.org) — lightweight, fast, server-side HTML templates |
| Real-time | Server-Sent Events (SSE) via Express |
| Database | Turso (libSQL / distributed SQLite) |
| Auth | Email + password (bcrypt, server-side sessions in Turso) |
| Med lookup | RxNorm API (NIH, free) — autocomplete + drug details |
| PWA | Web App Manifest + Service Worker (offline shell caching) |

---

## Data Models

### `users`
```
id           TEXT PRIMARY KEY
email        TEXT UNIQUE NOT NULL
password     TEXT NOT NULL          -- bcrypt hash
created_at   TEXT NOT NULL
```

### `sessions`
```
id           TEXT PRIMARY KEY
user_id      TEXT NOT NULL REFERENCES users(id)
expires_at   TEXT NOT NULL
```

### `profiles`
```
id           TEXT PRIMARY KEY
user_id      TEXT NOT NULL REFERENCES users(id)
name         TEXT NOT NULL          -- "Mom", "Self", etc.
avatar_color TEXT                   -- hex, for visual distinction
created_at   TEXT NOT NULL
```

### `medications`
```
id              TEXT PRIMARY KEY
profile_id      TEXT NOT NULL REFERENCES profiles(id)
rxcui           TEXT               -- RxNorm concept ID
name            TEXT NOT NULL
strength        TEXT               -- e.g. "10mg"
form            TEXT               -- e.g. "tablet", "capsule"
instructions    TEXT
total_quantity  INTEGER            -- current pills on hand
refill_threshold INTEGER DEFAULT 7 -- alert when days_remaining <= this
active          INTEGER DEFAULT 1
created_at      TEXT NOT NULL
```

### `time_slots`
```
id          TEXT PRIMARY KEY
profile_id  TEXT NOT NULL REFERENCES profiles(id)
label       TEXT NOT NULL    -- "Morning", "Noon", "Evening", "Bedtime"
sort_order  INTEGER NOT NULL
```

### `schedules`
```
id          TEXT PRIMARY KEY
med_id      TEXT NOT NULL REFERENCES medications(id)
slot_id     TEXT NOT NULL REFERENCES time_slots(id)
days        TEXT NOT NULL    -- JSON array: [0,1,2,3,4,5,6] (0=Sun)
dose_qty    INTEGER DEFAULT 1
```

### `grid_entries`
```
id          TEXT PRIMARY KEY
profile_id  TEXT NOT NULL REFERENCES profiles(id)
med_id      TEXT NOT NULL REFERENCES medications(id)
slot_id     TEXT NOT NULL REFERENCES time_slots(id)
date        TEXT NOT NULL    -- ISO 8601 YYYY-MM-DD
status      TEXT DEFAULT 'pending'  -- pending | taken | skipped | missed
taken_at    TEXT
note        TEXT
```

### `refill_logs`
```
id          TEXT PRIMARY KEY
profile_id  TEXT NOT NULL REFERENCES profiles(id)
logged_at   TEXT NOT NULL
photo_url   TEXT             -- future: camera capture stored reference
notes       TEXT
```

### `refill_log_items`
```
id            TEXT PRIMARY KEY
refill_log_id TEXT NOT NULL REFERENCES refill_logs(id)
med_id        TEXT NOT NULL REFERENCES medications(id)
qty_added     INTEGER NOT NULL
```

---

## Features & Flows

### 1. Auth

**Sign Up**
- Email + password (min 8 chars)
- On success: create user + default profile named "Me" + redirect to onboarding

**Sign In**
- Email + password
- Server sets `HttpOnly` session cookie
- Datastar SSE stream opens on successful login

**Sign Out**
- Deletes session from Turso
- Redirects to `/login`

---

### 2. Profiles

**Profile Switcher**
- Persistent in the sidebar/header
- Avatar initial + name, color-coded
- Switch triggers SSE stream reload for new profile context

**Manage Profiles**
- Create, rename, delete profiles
- Deleting a profile requires confirmation — cascades to all data

---

### 3. Medications

**Add Medication**
- Typeahead search powered by RxNorm `/approximateTerm` endpoint
- Selecting a result auto-fills: name, strength, form from RxNorm `/rxcui/{id}/properties`
- User fills in: time slots, days of week, dose qty, current quantity on hand
- Refill threshold defaults to 7 days

**Medication Detail**
- Shows current quantity, days remaining (quantity ÷ daily doses)
- Refill alert badge when days remaining ≤ threshold
- Edit or deactivate

**Days-Remaining Calculation**
```
daily_dose_count = SUM(dose_qty) across all schedule rows for this med (on active days)
days_remaining   = floor(total_quantity / daily_dose_count)
```

---

### 4. The Grid

The Grid is the core view. It represents a **physical 7-day pill organizer** projected across a **full calendar month**.

#### Layout
- Rows = weeks (4–5 rows per month)
- Columns = days (Sun–Sat, or Mon–Sun, user preference)
- Each cell = one day's organizer compartments
- Each compartment = one time slot
- Each compartment lists the medications scheduled for that slot

#### Cell Anatomy
```
┌─────────────────┐
│ Wed 15          │  ← date header
├─────────────────┤
│ ○ Morning       │  ← slot label + status dot
│   Metformin     │
│   Lisinopril    │
├─────────────────┤
│ ● Evening       │  ← filled = all taken
│   Atorvastatin  │
└─────────────────┘
```

Status indicators:
- `pending` — empty circle (default)
- `all taken` — filled green circle
- `partial` — half-filled circle
- `missed` — red X (past date, not taken)

#### Interactions
- Tap a slot → expand to mark each med as taken/skipped, add a note
- Tap the day header → see full day summary
- SSE pushes real-time updates when another device marks a dose

#### Month Navigation
- Previous / Next month arrows
- "Today" shortcut highlights current day with a ring

#### Grid Printout
- `/grid/print?profile=:id&month=YYYY-MM`
- Print-friendly HTML page: removes nav, renders full month grid in black & white
- Columns = days, rows = time slots, meds listed in each cell
- Shows checkboxes instead of status dots (for paper use)
- `@media print` stylesheet hides all interactive elements
- Optional: "Save as PDF" via browser native print dialog

---

### 5. Refill Verification

**Refill Reminder**
- Alert banner on the Grid when any medication hits its refill threshold (≤ 7 days remaining)
- SSE pushes this alert in real time across devices

**Log a Refill**
- User taps "Log Refill" on a medication
- Enters quantity added
- Optional: attach a photo (stored locally for now; future: upload)
- Updates `total_quantity` on the medication record
- Appended to `refill_logs` for history

**Refill History**
- Per-medication timeline of refill events
- Shows date, qty added, optional photo, notes

---

### 6. Notifications & Reminders

- PWA push notifications (Web Push API)
- User opts in per profile
- Scheduled server-side jobs (cron-style via `setInterval` or a lightweight scheduler):
  - Dose reminder: fires at each time slot's configured time
  - Refill alert: fires daily at 8am if any med is at threshold
- In-app: SSE-driven toast notifications for real-time alerts

---

## Pages & Routes

### Public
| Route | Page |
|---|---|
| `/` | Landing / marketing splash |
| `/login` | Sign in |
| `/signup` | Sign up |

### Authenticated
| Route | Page |
|---|---|
| `/app` | Redirect → `/app/grid` |
| `/app/grid` | The Grid (current month, active profile) |
| `/app/grid/print` | Print-friendly grid |
| `/app/medications` | Medication list |
| `/app/medications/new` | Add medication |
| `/app/medications/:id` | Medication detail / edit |
| `/app/profiles` | Manage profiles |
| `/app/settings` | Account settings, notifications |

### API (Express)
| Method | Path | Description |
|---|---|---|
| `POST` | `/api/auth/signup` | Create account |
| `POST` | `/api/auth/login` | Sign in, set session cookie |
| `POST` | `/api/auth/logout` | Invalidate session |
| `GET` | `/api/meds/search?q=` | Proxy RxNorm autocomplete |
| `GET` | `/api/meds/details/:rxcui` | Proxy RxNorm drug details |
| `GET` | `/api/sse` | SSE stream (per session + profile) |
| `GET` | `/api/profiles` | List profiles |
| `POST` | `/api/profiles` | Create profile |
| `PATCH` | `/api/profiles/:id` | Update profile |
| `DELETE` | `/api/profiles/:id` | Delete profile |
| `GET` | `/api/medications` | List meds for profile |
| `POST` | `/api/medications` | Add medication |
| `PATCH` | `/api/medications/:id` | Update medication |
| `DELETE` | `/api/medications/:id` | Deactivate medication |
| `GET` | `/api/grid?profile=&month=` | Grid data for month |
| `PATCH` | `/api/grid/entry/:id` | Update entry status |
| `POST` | `/api/refills` | Log a refill |
| `GET` | `/api/refills?med=` | Refill history |

---

## SSE Architecture (Datastar)

The server maintains one persistent SSE connection per authenticated session at `GET /api/sse`. Datastar's `@get` and `@post` attributes trigger server actions; the server responds with SSE events that Datastar processes.

**Performance principle: signals over fragments.** Replacing DOM nodes causes reflow and risks losing focus or scroll state. Updating a signal is free — Datastar's reactive bindings handle the DOM change natively. Only send a fragment when the HTML structure itself must change.

**SSE Event Hierarchy**
| Event | When to use |
|---|---|
| `datastar-merge-signals` | Value changes — status, counts, labels, alert flags. Bindings update the DOM with zero reflow. **Default choice.** |
| `datastar-execute-script` | Client-side actions with no DOM node to update — toasts, focus, scroll. |
| `datastar-merge-fragments` (morph) | HTML structure changes — list item added/removed, new card inserted. Use `merge morph` to diff rather than replace. |

**Reactive bindings on the page** (`data-signals` declared at page load):
- `data-text="$signalName"` — updates text content
- `data-show="$condition"` — shows/hides without DOM removal
- `data-class="{'active': $isActive}"` — toggles classes
- `data-bind="$value"` — two-way binding for inputs

**Example flow — marking a dose taken:**
1. User taps a slot cell → Datastar `@post /api/grid/entry/:id`
2. Express updates `grid_entries`, recalculates days remaining
3. Server emits `datastar-merge-signals` → `{"slotStatus_abc": "taken", "daysRemaining_xyz": 11}`
4. Datastar reactive bindings update the status dot and days-remaining badge in place — no DOM replacement, no reflow

---

## PWA Requirements

- `manifest.json`: name, short_name, icons (192/512), theme color `#6EC6A0`, display `standalone`
- Service Worker: cache-first for app shell (HTML, CSS, JS), network-first for API calls
- Offline: show cached grid with a "You're offline" banner; queue entry updates for sync on reconnect
- Install prompt: custom "Add to Home Screen" banner

---

## Project Structure

```
medigrid/
├── public/
│   ├── index.html
│   ├── manifest.json
│   ├── sw.js
│   ├── css/
│   │   ├── tokens.css
│   │   ├── base.css
│   │   ├── components.css
│   │   └── grid.css
│   └── js/
│       ├── app.js
│       └── grid.js
├── src/
│   ├── server.js
│   ├── db/
│   │   ├── client.js
│   │   └── migrations/
│   ├── routes/
│   │   ├── auth.js
│   │   ├── medications.js
│   │   ├── grid.js
│   │   ├── profiles.js
│   │   ├── refills.js
│   │   └── sse.js
│   ├── middleware/
│   │   └── auth.js
│   ├── services/
│   │   ├── rxnorm.js
│   │   ├── gridBuilder.js
│   │   └── notifications.js
│   └── views/
│       ├── layouts/
│       │   └── base.eta        # Base layout (head, skip link, nav, main slot)
│       ├── fragments/          # Partial templates returned via SSE
│       │   ├── grid-cell.eta
│       │   ├── med-card.eta
│       │   └── alert-banner.eta
│       └── pages/
│           ├── login.eta
│           ├── signup.eta
│           ├── grid.eta
│           ├── medications.eta
│           └── print.eta
├── SPEC.md
├── package.json
└── .env
```

---

## Future Considerations (Out of Scope v1)

- Camera-based pill organizer scanning (computer vision / AI)
- Caregiver ↔ patient shared access with permission levels
- Pharmacy integration / e-prescription import
- Export to PDF via headless browser
- Native push via FCM/APNs
- HIPAA compliance audit
- Multi-language support
