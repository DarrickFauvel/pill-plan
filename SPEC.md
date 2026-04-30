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
- Base spacing unit: `0.5rem`
- Card radius: `1rem`
- Button radius: `0.5rem`
- Grid cell radius: `0.75rem`

### Motion
- Transitions: `150ms ease` for interactive states
- SSE-driven updates use CSS `@starting-style` for smooth fragment merges

---

## Tech Stack

| Layer | Choice |
|---|---|
| Markup | Semantic HTML5 |
| Styles | Modern CSS (custom properties, container queries, `@layer`, `grid`, `clamp()`) |
| Client logic | Vanilla JS (ES2022+, JSDoc type annotations throughout) |
| Reactivity | [Datastar](https://data-star.dev) — hypermedia signals + SSE fragment merges |
| Server | Node.js + Express |
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

The server maintains one SSE connection per authenticated session. Datastar's `@get` and `@post` attributes on HTML elements trigger server actions; the server responds with SSE fragments that Datastar merges into the DOM.

**SSE Event Types**
- `datastar-merge-fragments` — partial HTML updates (grid cell, alert banner, medication card)
- `datastar-merge-signals` — signal updates (days remaining, refill alerts)
- `datastar-execute-script` — toast notifications

**Example flow — marking a dose taken:**
1. User taps a slot cell → Datastar `@post /api/grid/entry/:id`
2. Express updates `grid_entries`, recalculates days remaining
3. Server emits SSE fragment: updated cell HTML + updated days-remaining badge
4. Datastar merges fragment into DOM — no full page reload

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
│       ├── fragments/
│       │   ├── grid-cell.html
│       │   ├── med-card.html
│       │   └── alert-banner.html
│       └── pages/
│           ├── login.html
│           ├── signup.html
│           ├── grid.html
│           ├── medications.html
│           └── print.html
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
