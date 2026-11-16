# Task: Stop the cafeteria site's firewall from blocking our Vercel proxy

## Context
This repo (SSIP meal-order app, v1.3.3) is a React + Vercel serverless scraping proxy in front of
`https://ssip-cafeteria.whew.life` (WordPress/WooCommerce + Wordfence). Read `CLAUDE.md` first and
follow it, especially: keep `vercel.json` `regions: ["sin1"]` and never call the cafeteria site from
anywhere other than the `api/` functions.

Production is now showing "The cafeteria site is blocking requests from our server right now" on the
Dashboard (`isSecurityBlockPage()` matched Wordfence's "Your access to this site has been limited by
the site owner" page). We have 100+ weekly users. **All of them share one egress IP: Vercel `sin1`.**
So to Wordfence, the whole user base is one very busy visitor. The v1.3.3 commit (back-off, batch
size 2, 5-min dashboard staleTime) did not fix it.

**Confirmed by me:** running the same code locally (`npm run dev` + `npm run dev:api`, outbound from my
own Singapore IP) signs in and works without being blocked. Only the Vercel deployment is blocked.
So the block is **IP-based against Vercel's egress IP**. It is not caused by our code, parsing,
headers or credentials. What we don't know yet is *which* IP rule:
(a) rate limiting / brute-force lockout triggered by our combined user traffic on one IP, which fixing
our traffic can solve; or (b) Vercel's AWS IP sitting on Wordfence's real-time blocklist or in a
data-center/hosting range rule, which no traffic fix can solve.
Phase 0 must tell these apart before we judge whether Phases 1–3 worked.

## Diagnosis (verified by reading the code; confirm each before changing it)

### A. We don't know *why* Wordfence blocks us
1. `isSecurityBlockPage()` (`api/_utils.js`) only checks for the banner text. Wordfence's block page
   also includes a "Block Technical Data" section with the **block reason** (e.g. rate limit exceeded,
   IP on Wordfence's real-time blocklist, country block, brute-force/login lockout, manual block) and
   the **blocked IP**. We throw that away, so we can't tell which cause applies.
   Shared AWS/Vercel IPs often end up on Wordfence's real-time blocklist because of other tenants. If
   that's the cause, no amount of request reduction fixes it.

### B. Block detection exists only in `dashboard.js` and `login.js`
2. `api/meals.js`, `api/orders.js`, `api/place-order.js` and `api/cancel-order.js` never call
   `isSecurityBlockPage()`, and they don't check the shared back-off.
   - `meals.js`: a 503 block becomes `502 "WooCommerce returned 503"`. A 200 block page parses as zero meals.
   - `place-order.js` / `cancel-order.js`: a block page is treated as a normal page. `cancel-order`
     even reports `success: true` because of `wcRes.status < 400`.
   So during a block every endpoint except the dashboard keeps hitting the site and can extend the block.
3. `blockedUntil` and `scrapeCache` in `dashboard.js` are **module-level, per warm lambda**. With
   concurrent users Vercel runs many instances, and each starts unblocked. The back-off is
   ineffective exactly when load is high.
4. Headers are inconsistent. `meals.js`, `orders.js`, `cancel-order.js` and the `place-order.js` raw
   `fetch()` calls omit `BROWSER_HEADERS`. Each handler builds its own fetch instead of a shared wrapper.

### C. The client amplifies traffic, especially when things fail
5. `src/App.jsx` QueryClient sets `retry: 1`, so every failed request (including blocks) is sent twice.
6. `src/lib/api.js` silently re-logs in with saved credentials on any `sessionExpired`. Each login is
   at least 2 requests to `/my-account/` (GET + POST, plus redirects). Wordfence's brute-force /
   login-security rules count login attempts **per IP**, and every user's logins come from the same IP.
   There is no per-user or global throttle on re-logins.
7. Dashboard "Retry" buttons (`DashboardPage.jsx` ~L327, ~L383) have no cooldown.
8. `HistoryPage.jsx` uses `staleTime: 0`, so it refetches on every visit.

### D. Request volume per user action is high and not shared between users
9. **Order → Month tab:** `PerDayOrderPanel` uses `useQueries` to fire one `/api/meals` call per working
   day at once (about 20–23 parallel outbound requests per user). Switching months fires another batch.
   The Day tab fetches on every date-input change.
10. **The menu is the same for everyone,** but `meals.js` fetches it per user with that user's cookies,
    and there is no shared cache. 100 users opening the month view means about 2,000 identical page loads.
11. **`place-order.js`** makes per order: add-to-cart POST (+ redirect hops), checkout GET (+ hops),
    **up to 5 guessed `admin-ajax.php` actions** when the action name isn't found in the inline
    script, then the checkout POST. That's about 4–9 requests per order. A month bulk order
    (`handlePlaceAll`, 500 ms apart) can mean 100–200 requests in a few minutes from one user.
    Repeated wrong `admin-ajax` actions look like probing to a WAF.
12. **Dashboard** uncached load: wallet + orders page 1 in parallel, then extra pages 2 at a time.

## What to build

Do this in phases. After each phase, run `npm test` and `npm run build`, then commit with a clear
message. Add `node --test` tests for new server logic, in the same style as `test/dashboardApi.test.js`.

### Phase 0 — Diagnostics (do first)
- Extend block detection into `parseBlockPage(html)`, which returns `{ blocked, reason, blockedIp, rawSnippet }`.
  It should parse Wordfence's "Block Technical Data" fields (the reason and IP), and the code should
  also treat HTTP 403/503/429 responses as possible blocks.
- On every detected block, `console.error('[wf-block]', { endpoint, status, reason, blockedIp })`
  so the reason shows in Vercel logs.
- Add a lightweight per-invocation counter of outbound requests to the cafeteria site, logged at the
  end of each handler (`[outbound] endpoint=meals count=1`), so we can measure the reduction.
- Add `GET /api/diag`, an on-demand check I can open in a browser on production and on localhost to
  compare the two. It makes **one** unauthenticated GET to the cafeteria homepage and returns JSON
  `{ region, egressIp, status, blocked, reason, blockedIp, checkedAt }`. Get `egressIp` from a public
  IP echo service (e.g. `https://api.ipify.org?format=json`). Guard it with a secret query param read
  from an env var (`DIAG_TOKEN`), and rate-limit it to once per 60 s using the store (return the cached
  result in between), so the check can't add load itself.
- In your final summary, explain how to read the result: a reason mentioning rate limiting, too many
  requests or login attempts means case (a); a blocklist, country, network or "manually blocked"
  reason means case (b). Also note whether the egress IP changes between deployments or invocations.

### Phase 1 — One choke point for all outbound traffic
- Create `api/_store.js`, a tiny shared key-value abstraction (`get`, `set` with TTL, `incr`).
  Use **Upstash Redis via REST** (`UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`) when those env
  vars exist; otherwise fall back to the current in-memory Map so local dev and tests still work.
  No new heavy dependencies: plain `fetch` to the Upstash REST API is fine.
  If you think Firestore would be the better fit, stop and ask me before adding it.
- Create `scrapeFetch(url, options, cookieJar)` in `api/_utils.js` and route **every** outbound call to
  the cafeteria site through it (including `fetchFollowing`, all of `place-order.js` and `cancel-order.js`).
  It must:
  - apply `USER_AGENT` + `BROWSER_HEADERS` consistently;
  - check the **shared** `blockedUntil` in the store before sending, and throw a typed `BlockedError`
    without contacting the site while blocked;
  - detect blocks on every response, set the shared `blockedUntil` (start at 10 min; back off
    exponentially on repeated blocks, capped at 60 min), and throw `BlockedError`;
  - count outbound requests (Phase 0).
- Every handler catches `BlockedError` and returns
  `503 { error, blocked: true, retryAfterSec }` with one consistent user-facing message.
  Remove the per-instance `blockedUntil` in `dashboard.js`.
- Fix `cancel-order.js` success detection so a block page or any non-confirmation page is not `success`.

### Phase 2 — Stop the client amplifying
- `lib/api.js`: on `blocked: true`, throw a typed error carrying `retryAfterSec`, and **never** trigger
  silent re-login.
- QueryClient: replace `retry: 1` with a function that never retries blocked errors or session errors.
- Silent re-login: allow at most one attempt per 10 minutes per device (timestamp in localStorage).
  On the server, add a per-username login cooldown in the store (for example, max 3 logins per
  username per 15 min). When the cooldown is hit, return a clear message instead of contacting the site.
- Retry buttons: disable them and show a countdown while blocked (use `retryAfterSec`). Store the
  block-until time in localStorage so a page reload doesn't immediately re-hit.
- `HistoryPage`: use a sensible staleTime (5 min) instead of 0.
- Dashboard: while blocked, keep showing the last cached scrape (`readDashboardCache`) with a
  "last updated X ago" note, not just the red error.

### Phase 3 — Cut volume
- **Shared menu cache** in `meals.js`: key `menu:{date}`, TTL 30 min (shorter, about 5 min, for today
  and tomorrow if stock matters). First verify the menu HTML/product IDs don't depend on the user's
  cookies. Fetch once with and once without cookies and compare the parsed `meals`. If they're the same,
  serve all users from the cache. Coalesce concurrent misses for the same date so only one outbound
  fetch happens.
- **Month/Week view:** limit `/api/meals` concurrency to 2 on the client (a small queue around
  `getMeals`). Load days progressively or only when expanded/visible. Optionally add a
  `POST /api/meals` batch form `{ dates: [...] }` that serves from cache and fetches misses
  sequentially on the server.
- Day tab: debounce date changes (about 400 ms).
- **place-order.js:** cache the discovered `exwfood` AJAX action name in the store (long TTL) so the
  5-action guessing happens at most once. After that, use only the cached action. If the cached action
  fails, re-discover once. Stop the whole bulk run in `handlePlaceAll` as soon as a blocked error comes
  back, and report which dates were not attempted. Increase the inter-order delay to about 1.5 s.
- Keep dashboard behaviour, but move `scrapeCache` to the store (key by a hash of the cookie string,
  never the raw cookie; TTL 60 s). Keep the existing rule that only complete scrapes are cached.

### Phase 4 — Docs and release
- Update `CLAUDE.md`: the new `scrapeFetch` / `_store.js` rule ("all cafeteria traffic goes through
  `scrapeFetch`"), the env vars, and the caching/back-off behaviour.
- Bump the version to 1.4.0 and update `AnnouncementBanner.jsx` (new `NOTICE_ID` + `EXPIRES_AT`) with a
  short, plain notice.
- At the end, write a short summary for me with: a before/after table of estimated outbound requests
  per action (login, dashboard load, month view, single order, 20-day bulk order); the Vercel env vars
  I need to set; and how to read the `[wf-block]` logs.

## Constraints
- Don't change `regions: ["sin1"]`. Don't add an Edge runtime for anything that calls the cafeteria site.
- Don't change parsing logic (selectors, date/timestamp handling, dedupe keys) unless a phase requires it.
- Never log passwords, full cookies or nonces.
- Everything must still work locally (`npm run dev` + `npm run dev:api`) with no Upstash env vars.
- Ask me before adding paid services or any dependency heavier than a few KB.

## Out of scope (just note it in your summary)
- If `/api/diag` or the `[wf-block]` logs show case (b), the traffic fixes won't unblock us. Options to
  recommend, but don't implement: a fixed egress IP (Vercel Static IPs, or a small Singapore VPS proxy)
  with the cafeteria admin allowlisting it; or a Capacitor native wrapper so each phone makes its own
  requests, like the Android app does. Do **not** add rotating or residential proxy services, or any
  other approach meant to get around the site's firewall.
- Storing remember-me passwords in plaintext localStorage is a separate security issue. Flag it, but
  don't change it in this task.
