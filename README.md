# Pill Plan

A Progressive Web App for organizing medications and verifying weekly pill organizer refills. Supports both patients and caregivers, with multiple profiles per account.

## Features

- **The Grid** — monthly view of a 7-day pill organizer with custom time slots, date-aware status tracking, and a print-friendly layout
- **Medication management** — search and add medications via the RxNorm API (NIH), with dose scheduling and refill threshold alerts
- **Refill logging** — track quantities on hand, log refills, and get alerted when you're down to 7 days of supply
- **Real-time sync** — SSE-driven updates across devices via Datastar
- **Multiple profiles** — one account for a whole household (e.g., "Mom", "Self", "Dad")

## Stack

| Layer | Choice |
|---|---|
| Markup | Semantic HTML5 |
| Styles | Modern CSS (custom properties, container queries, `@layer`) |
| Client logic | Vanilla JS (ES2022+, JSDoc) |
| Reactivity | [Datastar](https://data-star.dev) + SSE |
| Server | Node.js + Express |
| Database | Turso (libSQL) |
| Auth | Email + password |
| Med lookup | RxNorm API (NIH) |

## Design

Light green and light blue health-app aesthetic. See [`SPEC.md`](./SPEC.md) for the full design token system, data models, routes, and architecture.

## Development

```bash
npm install
npm run dev
```

Requires a `.env` file with:

```
TURSO_URL=
TURSO_AUTH_TOKEN=
SESSION_SECRET=
PORT=3000
```

## Spec

Full product specification is in [`SPEC.md`](./SPEC.md).
