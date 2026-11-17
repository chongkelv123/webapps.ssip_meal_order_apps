# Cafeteria block fix: status and next steps

Last updated: 2026-11-16. Branch: `fix/cafeteria-block`. Full plan: `docs/fix-block-prompt.md`.

## Where we are

| Phase | Status |
|---|---|
| 0: Diagnostics (`parseBlockPage`, `[wf-block]` logs, `/api/diag`) | Done (`636ce5e`) |
| 1: One choke point (`scrapeFetch`), shared back-off in Upstash | Done (`7f2ad01`), pushed, preview built |
| 2: Stop the client multiplying requests | To do |
| 3: Cut request volume | To do |
| 4: Docs (`CLAUDE.md`), version 1.4.0, announcement banner | To do |

- **Production** still runs `master` @ `22f46d1` (v1.3.3): no diagnostics, and the pause after a block is per instance only.
- **Preview from Git** (Phase 1): `https://web-app-ssipm-eal-order-8p4qimwja-chongkelvs-projects.vercel.app`
- **Upstash Redis** is created, and `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` are set for Preview and Production. A test against the preview showed Upstash calls succeeding (no `[store]` errors in the logs).

### Diagnosis so far
`/api/diag` on 2026-11-16 at 21:52 SGT: egress IP `47.129.24.110` (AWS Singapore), `blocked: false`. The block lifted on its own, which points to a temporary rate-limit or login lockout (case a) rather than an IP blocklist (case b). That is one check only: the original block's reason was never recorded, because production doesn't have the diagnostics yet.

## Next steps

### 1. Test the Phase 1 preview (about 5 min)
Sign in at vercel.com in the browser first, because preview URLs need it.
- Open `<preview>/api/diag?token=<DIAG_TOKEN>`. Expect `"store": "upstash"`, `"backoff": {"active": false, ...}` and `"blocked": false`.
- Reload within 60 s. `"cached": true` means the result was saved to and read back from Redis.
- `{"error":"Not found"}` means the token doesn't match. `DIAG_TOKEN` is now Sensitive and may hold a new value.
- In the app: log in, open the Dashboard, view a day's menu.
- Optional: cancel and re-place a test order, because cancel-order's success check changed.

### 2. Merge to `master` (production gets Phases 0 and 1)
- The next block will record Wordfence's reason in the `[wf-block]` logs (case a or case b).
- All instances stop contacting the site together while blocked, so we don't extend the block.
- No client changes needed: the app already shows the 503 message, and `retryAfterSec` is simply unused until Phase 2.
- After merging, check production `/api/diag` the same way.

### 3. Phase 2: stop the client multiplying requests
- `lib/api.js`: on `blocked: true`, throw a typed error carrying `retryAfterSec`. Never silently re-login on a block.
- QueryClient: never retry blocked or session errors (replaces `retry: 1`).
- Silent re-login: at most once per 10 min per device. Server-side login limit per username (for example 3 per 15 min) in the store. Wordfence counts logins per IP, and every user shares our IP.
- Retry buttons: disabled with a countdown while blocked. Keep the block-until time in localStorage.
- `HistoryPage`: `staleTime` 5 min instead of 0.
- Dashboard: while blocked, keep showing the last data with "last updated X ago".

### 4. Phase 3: cut the volume (most likely to stop the blocks for good)
- Shared menu cache in `meals.js` (`menu:{date}`, 30 min; about 5 min for today and tomorrow). First check that the menu doesn't depend on the user's cookies. Concurrent requests for the same date should share one fetch.
- Month/Week view: at most 2 `/api/meals` requests at a time, loaded progressively. Debounce the Day tab (about 400 ms).
- `place-order`: save the discovered admin-ajax action name in the store, so the guessing happens at most once. Stop a bulk run at the first block and report which dates weren't attempted. Order delay about 1.5 s.
- Move the dashboard `scrapeCache` to the store, keyed by a hash of the cookie string (never the raw cookie), with a 60 s TTL.

### 5. Phase 4: docs and release
- `CLAUDE.md`: the rule that all cafeteria traffic goes through `scrapeFetch`, plus `_store.js`, the env vars and the back-off behaviour.
- Version 1.4.0, plus a new `NOTICE_ID` / `EXPIRES_AT` in `AnnouncementBanner.jsx`.

### If the block comes back with a blocklist or network reason (case b)
Traffic fixes won't help. Free route: an Oracle Cloud Always Free VM in Singapore with a reserved static IP, running `dev-server.js` behind a Cloudflare Tunnel, with a Vercel rewrite of `/api/*` to it. Then ask the cafeteria admin to allowlist that IP. Don't use rotating or residential proxies.

## Gotchas learned
- **Redeploy rebuilds the old commit.** "Redeploy" in the Vercel dashboard rebuilds that deployment's original commit, not the latest branch. Push the branch to get a fresh preview.
- **Env vars apply only to new builds.** Redeploy after adding or changing one.
- **Sensitive env vars export as blanks.** `vercel env pull` returns blank values for Sensitive vars, but deployed functions still get them.
- **Previews need a Vercel sign-in.** Use a signed-in browser, or `vercel curl <path> --deployment <url>`.
- **Git Bash rewrites `/api/...` arguments.** It turns them into Windows paths; run `export MSYS_NO_PATHCONV=1` first.
- **A bare 403 doesn't trip the back-off.** It's a stale admin-ajax nonce. A real Wordfence 403 page has its banner and still does.
