# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A React web app (iPhone-focused, internal use) that replicates an existing Android meal-ordering app
against a WooCommerce cafeteria site at `https://ssip-cafeteria.whew.life`. That site has no REST API —
it's a server-rendered WordPress/WooCommerce site, so every operation (login, browsing meals, placing
orders, checking wallet balance) is done by submitting HTML forms and scraping the HTML response with
cheerio. Vercel serverless functions in `api/` act as the scraping proxy; the React app never talks to
WooCommerce directly (avoids CORS and keeps scraping logic server-side).

There is no database and no auth system of our own. A logged-in user's WooCommerce session cookies are
handed back to the browser and stored in `localStorage`; every subsequent API call sends those cookies
in the POST body and the serverless function attaches them as a `Cookie` header when it calls
WooCommerce. The proxy itself is stateless (aside from a short-lived in-memory scrape cache — see
below), so multi-user isolation is just "each browser holds its own cookies."

## Commands

```
npm run dev       # Vite dev server (frontend only, http://localhost:5173)
npm run dev:api   # Local API server on :3001 that wraps the api/*.js handlers (dev-server.js)
npm run build     # vite build -> dist/
npm run preview   # preview the production build
```

Run both `dev` and `dev:api` together for local full-stack testing — `vite.config.js` proxies `/api/*`
to `localhost:3001`. There is no test suite and no linter configured in this repo.

Deployment is Vercel (`vercel.json`), pinned to the `sin1` (Singapore) region — see
**Wordfence geo-block** below for why that pin cannot be removed.

## Architecture

### Request flow
`src/lib/api.js` is the only place the frontend calls `/api/*`. Its internal `post()` helper reads
cookies from `localStorage` and merges them into every request body as `{ cookies, ...otherParams }`.
It also centrally handles the `sessionExpired` response flag: on that flag it clears stored cookies and
dispatches a `session-expired` window event, which `AuthProvider` (`src/hooks/useAuth.jsx`) listens for
to redirect to `/login`. Never bypass `lib/api.js` to call `/api/*` directly — you'd lose both the
cookie injection and the session-expiry handling.

`src/hooks/useAuth.js` is a thin re-export shim — the real `AuthProvider`/`useAuth` live in
`useAuth.jsx` because Vite needs the `.jsx` extension to parse JSX. Import from either; don't duplicate
logic into the `.js` file.

### `api/_utils.js` — shared scraping primitives
Every handler in `api/` is built on these:
- `fetchFollowing()` — manual redirect-following fetch that accumulates `Set-Cookie` at every hop
  (needed because WooCommerce sets session cookies mid-redirect-chain) and detects session-expiry
  (redirected to `/my-account/` with a login form in the response).
- `extractCookies()` / `cookieHeader()` — cookie jar <-> header string conversion.
- `isSecurityBlockPage()` — detects the Wordfence firewall block page (see below).
- `dateToUnixTimestamp()` — WooCommerce's `exwfood` delivery-date plugin stores dates as UTC-midnight
  unix timestamps with no timezone offset; don't "fix" this to use local time.

### Handler-specific scraping notes
- **`api/meals.js`**: The meal grid's name/price/image live in `div[data-id_food]` elements, but the
  actual add-to-cart `<button>`s are in a separate DOM section with no price info. Meals are matched
  between the two by `data-id_food` / button `value` (product ID) — if WooCommerce changes either
  section's markup, check `gridData` matching and the `findProductContainer` fallback in that order.
- **`api/place-order.js`**: Order placement is add-to-cart (POST to the menu-date page) then a full
  checkout with a scraped nonce. The delivery time `<select>` is populated client-side via an AJAX call
  the plugin makes after date selection — the handler replicates this by scraping the inline
  `wp_localize_script` config for the AJAX action name and nonce, then calling it itself. If checkout
  starts failing, check this nonce/action extraction first — it's scraped from `<script>` text, not a
  stable API.
- **`api/dashboard.js`**: Reimplements billing-period, missed-meal, and budget logic ported from the
  Android app's Kotlin (`DateUtil`, `OrderScraper`, `BudgetCalculator` — see comments referencing those
  names). Billing periods run the 27th–26th, not calendar months. All budget arithmetic is done in
  integer cents to avoid float boundary errors at "exactly on budget." Includes a 60s in-memory
  `scrapeCache` keyed by cookie string (only helps on warm Vercel lambda reuse) for the expensive
  wallet+full-order-history scrape; budget/exempt-date-dependent derived stats are always recomputed
  fresh from the request even when the underlying scrape is cache-hit, so cache hits can't return stale
  budget numbers.
- Orders across pages are deduped by `date|orderDate|mealName`, not just `orderDate|mealName` — a
  single bulk/batch checkout books the same meal across many delivery dates in one order, so dropping
  `date` from the key would collapse all of them into one.

### Frontend structure
- `src/App.jsx` — router root. Public routes (`/login`, `/about`, `/contact`) vs. an `AuthLayout` wrapper
  (via `<Outlet/>`) for everything else, gated on `useAuth().isLoggedIn`.
- TanStack Query is used for all server-state fetching (`staleTime: 5min`, no refetch-on-focus).
- Settings (order details, dashboard budget config) are read/written directly to `localStorage` by both
  `SettingsPage.jsx` and `lib/api.js` independently (see `DASHBOARD_SETTINGS_KEY` /
  `user_order_details` keys) — keep both in sync if you change the settings shape.
- `AnnouncementBanner.jsx` is a manually-maintained, self-expiring notice banner: bump `NOTICE_ID` (also
  update `EXPIRES_AT`) to show a new one-time announcement; old dismissal keys just go stale in
  localStorage.

## Known external constraint: Wordfence geo-block

The WooCommerce backend (`ssip-cafeteria.whew.life`) runs Wordfence configured to block non-Singapore
source IPs with a 503 "access limited" page (detected by `isSecurityBlockPage()` in `api/_utils.js`).
`vercel.json` pins `regions: ["sin1"]` so serverless function calls egress from Singapore — **do not
remove or change this region pin**, and be aware any new fetch to the WooCommerce origin needs to run
from that same serverless function, not from a different region/edge runtime.
