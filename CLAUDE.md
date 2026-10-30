# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Project Is

Culinary Canvas Tools (Web) is a static web-app port of `../culinary-canvas-tools`, a personal Chrome MV3 extension. Same product, same single teacher, same feature set — creating lab professionalism assignments, taking attendance (auto-zero/journal-lock for absences, deduction-based scoring for presents), and rolling scores up by Unit (Canvas Module) and Term back to the gradebook. The only thing that changed is the shell: no manifest, no background service worker, no `chrome.*` APIs — just a multi-page static site talking to the Canvas REST API directly from the browser with a personal access token. Each tool is still its own full page, not a SPA route.

See `DECISIONS.md` for the running log of product/design decisions — check it before assuming an open question hasn't been settled yet. Most of the extension's decision history (scoring model, vocabulary, theming) still applies and lives in the original repo's `DECISIONS.md`; this one only covers what's specific to the web port.

## Commands

```
npm run dev       # vite dev server, port 5175
npm run build     # production build to dist/
npm run preview   # preview the production build
npm run lint      # eslint src — see "Tailwind token guard" below before treating failures as bugs
npm run test      # node --test "src/**/*.test.js" "api/**/*.test.js"
```

Run a single test file directly: `node --test src/pages/labs/scoring.test.js`

**Running it:** `npm run dev` and open `http://localhost:5175/`. Production is deployed on Vercel (not GitHub Pages — see below for why), which builds and serves both the static site and the `api/canvas` proxy function together; a plain `npm run build` + static-host serve of `dist/` alone will load the UI but every Canvas API call will fail, since there's nothing there to run the proxy.

## Why this fork exists, and the CORS proxy

The extension's `chrome.*` surface turned out to be almost entirely shell plumbing (navigation between pages, key-value storage) with zero coupling to the Canvas page itself — no content script, no DOM injection, no session-cookie reliance. Every Canvas call already went through `fetch` with `Authorization: Bearer <token>` in `api/request.js`. That made this port mechanical rather than a rewrite. See the original repo's conversation history for the full audit.

**The one thing that wasn't guaranteed to work, and didn't:** the extension's `host_permissions` let its `fetch` calls bypass CORS entirely — a browser-level exemption tied to the extension's identity, not anything Canvas does differently. A plain web page gets no such exemption. The first deploy (GitHub Pages) confirmed Granite's Canvas instance sends no `Access-Control-Allow-Origin` header at all — and it's not an admin-configurable setting on Instructure-hosted Canvas, only on self-hosted instances, so there was no district-side fix to ask for. Every Canvas call failed with a CORS error in the browser console, starting with onboarding's token verification.

The fix: `api/canvas.js`, a dumb pass-through serverless function — forwards the request to Canvas server-to-server (CORS is a browser-only restriction, so it doesn't apply there), relays the response back byte-for-byte, logs nothing, persists nothing, and forwards whatever bearer token the caller supplies rather than holding its own credential. It also rewrites Canvas's `Link` pagination header to point back through the proxy, since `canvasGetAll` (`src/api/request.js`) follows that URL directly and would otherwise bypass the proxy — and hit the same CORS wall — on page 2 onward. The proxy's destination host is restricted to an allowlist (`ALLOWED_CANVAS_HOSTS` env var, defaults to `graniteschools.instructure.com`) so it can't be turned into an open relay to arbitrary hosts by a crafted `X-Canvas-Base` header. It's a single named file, not a `[...path].js` catch-all — Vercel only honors that bracket syntax inside Next.js apps, and silently 404s it on a plain Vite project. `vercel.json` rewrites every `/api/canvas/*` request to this one function, which recovers the real Canvas path and query from its own request URL (`parseProxyRequestUrl` in `api/_canvasProxyHelpers.js`) rather than from a route param.

This does reintroduce a server component that sees the Canvas token and response bodies in transit, which the extension version never had — accepted deliberately once the CORS failure was confirmed real, not spent on speculatively. It's also why hosting moved from GitHub Pages (static-only, can't run the proxy) to Vercel, which serves the static build and the `api/` serverless function from the same deployment and domain — so the frontend's calls to `/api/canvas/*` are same-origin, no CORS headers needed on that hop either.

## Architecture

### Entry points — no manifest, no background worker

Plain multi-page Vite build. `vite.config.js`'s `build.rollupOptions.input` lists every standalone page (root redirect, home, onboarding, settings, labs) — adding a new tool page means adding an entry here and a route in `config/tools.jsx` (below); neither alone is enough. There is no background service worker and no browser-action popup (the extension's `OPEN_PAGE` message + `chrome.tabs.create` round trip, and the popup UI, both went away — `src/shell/index.jsx`, the home page, is the only launcher now).

Navigation between pages is still a full page load, not client-side routing — `src/utils/nav.js`'s `pageUrl(path)` turns a relative path like `src/pages/labs/index.html` into a root-relative URL and every call site does `window.location.href = pageUrl(path)`. This directly replaces `chrome.runtime.getURL(path)`, which did the equivalent against the extension's own origin.

`config/tools.jsx` (`MODULES` + `TOOLS` arrays) is still the single source of truth for which tools exist, their icons, labels, and paths — `AppNav` and the home page both read from it.

### Setup gating

Root `/` is a tiny redirect page (`index.html`) to `src/shell/index.html`, the home/dashboard. Every tool page other than onboarding is wrapped in `<SetupGuard>`, which redirects to onboarding if `isSetupComplete()` is false — unchanged from the extension. There's no install-time hook anymore (no `chrome.runtime.onInstalled`); a first-time visitor just hits `SetupGuard`'s redirect the first time they land on any gated page.

### Storage model — single localStorage tier, no sync

The extension had a `chrome.storage.sync`-backed tier (cross-device) mirrored into a `chrome.storage.local` read-through cache. There's no web equivalent of `chrome.storage.sync`, so that collapsed to one tier: `src/storage/kv.js`'s `kvGet`/`kvSet`/`kvClear` wrap `localStorage` directly, and every store (`account`, `setup`, `preferences`, `security`, `auditLog`) calls through it. Every exported function in `storage/*.js` and `security/*.js` kept its exact name and signature — only the persistence underneath changed. **Consequence:** settings and course config no longer follow the teacher across browsers/devices; each browser's `localStorage` is independent. If that's ever worth fixing, it means a real backend (accounts, sync endpoint) — don't bolt it on without deciding that deliberately, since it changes the data-handling model (see the CORS/proxy note above — same category of decision).

`setup.js` still stores only teacher-authored configuration (course/lab/term definitions), deliberately no student data. Attendance/grade state is always re-derived live from Canvas, never cached — this is the single most important property to preserve in this app, extension or web, and has nothing to do with the shell it runs in.

`security` (`security/pin.js`) and `auditLog` (`security/audit-log.js`) are local-only, same as before — just `localStorage` instead of `chrome.storage.local`.

The Canvas API token is still AES-GCM encrypted (`storage/encryption.js`) with a per-browser key that never leaves `localStorage`. `getDecryptedToken()` is the only way to get a usable token, and `api/request.js` calls it immediately before every fetch — never hold a decrypted token in component state. **This matters more here than it did in the extension:** an extension's storage is isolated from arbitrary page scripts by the browser; `localStorage` on a web origin is readable by any script that runs on that origin. No third-party scripts, no CDN-hosted dependencies, no analytics — and a strict CSP in `vercel.json` (`script-src 'self'`, no inline scripts, `connect-src 'self'`) — production only, since the dev server sends no CSP. **In progress:** the app is moving to run inside Canvas via a bookmarklet, retiring the proxy — see the plan in `DECISIONS.md` ("replacing it by running the app inside Canvas") before changing the request layer or storage. The overall data-handling promise (gradebook data stays local and goes only to Canvas; nothing persisted server-side; no analytics; the proxy stays dumb) is written up as a standing invariant in `DECISIONS.md` — "Standing invariant — privacy" — and enforced by `api/canvas.privacy.test.js`. Do not erode it without a deliberate, documented decision.

### Canvas API layer — now routed through a proxy

Every Canvas call still goes through `src/api/request.js` (`canvasGet` / `canvasGetAll` / `canvasPost` / `canvasPut` / `canvasDelete`): auth headers, pagination (`canvasGetAll` follows the `Link` response header), and rate-limit backoff (a 403 with `X-Rate-Limit-Remaining` pauses subsequent requests) all live there — feature code never touches `fetch` directly. What changed in the port: requests now target `/api/canvas/*` (same-origin) instead of the Canvas domain directly, with an `X-Canvas-Base` header telling `api/canvas.js` which Canvas instance to forward to — see "Why this fork exists, and the CORS proxy" above. `src/api/auth.js`'s `verifyToken` goes through the same proxy.

Each `api/*.js` module maps Canvas's raw snake_case JSON to a camelCase internal shape before returning it (see `assignments.js`'s `mapAssignment` / `buildPayload` pair for the pattern) — components never see raw Canvas JSON.

Errors are typed (`api/errors.js`): `AuthError` (401), `NotFoundError` (404), `RateLimitError` (403, carries backoff ms), `ApiError` (everything else). Callers pattern-match on error type, not HTTP status. The proxy turns an unreachable Canvas into a 502 (also not one of these types) rather than the raw browser-level CORS/network error the direct-fetch version used to produce — still not something `api/errors.js` catches, so don't expect it to.

### PIN gate / write protection — unchanged

`usePinGate()` (`security/usePinGate.jsx`) wraps every Canvas-writing action: `requirePin(auditMeta, action, { forcePrompt })` runs `action()` immediately if the PIN is disabled or the session was recently active, otherwise shows `PinPrompt` and defers `action` until verified. Every gated action logs to the audit log regardless of whether the prompt appeared. `forcePrompt: true` is for irreversible operations: always re-prompts, blocks outright (`PinRequiredError`) if no PIN is configured.

### Theming — unchanged, already portable

Palette, dark/light/system, and text size are applied via `utils/color.js` and persisted to `localStorage` only (this was already true in the extension — `color.js` never touched `chrome.storage`, specifically so `public/theme-init.js`'s classic inline script could paint the right theme before first render). The extension needed a CRXJS plugin pair (`stripClassicScripts`/`injectClassicScripts`) purely to stop CRXJS's dev-mode transform from choking on that non-module script; plain Vite has no such problem, so `vite.config.js` here is just `react()` plus the multi-entry build — no workaround plugins.

### Tailwind token guard (`eslint.config.js`) — unchanged

The only lint rule configured is a `no-restricted-syntax` guard that fails on raw Tailwind color utilities (`text-gray-500`), arbitrary hex in Tailwind values (`bg-[#B7102A]`), and bare hex anywhere (`style={{ color: '#ef4444' }}`). Every color must resolve through a `--color-*` custom property defined in `src/styles/global.css`. Picking the right token matters as much as using one — see the original repo's `DECISIONS.md` ("Theme contrast") for the token-usage rules; they carried over unchanged.

### Tool page structure — Labs, Attendance & Professionalism (`src/pages/labs/`)

The Pairing/Standalone vocabulary and the Unit/Term rollup (`scoring.js`) carry over from the extension — see the original repo's `CLAUDE.md` for those. Two things changed in the web app (see `DECISIONS.md`, 2026-10-28):

- **Flag-based lab scoring replaced the deduction model.** The old per-lab score came from `scoreFromDeductions` (start at 4, subtract per mark), which could not cap criticals and gave every clean kitchen a 4. The current model is threshold-based: `kitchenScore`/`studentScore` in `kitchenScoring.js`, driven by flags declared in `config/labFlags.js`. The stored truth is **flags, not scores** (`storage/labGrading.js`, keyed lab→section, with a committed slot and a draft slot), so a later threshold change recomputes old labs. Scores are always derived via `deriveStudentScore`; absent is a separate 0, never computed. `scoreFromDeductions` and the old `ScorePanel`/`AttendancePanel` files remain in the tree but are no longer wired into the tabs.
- **The Attendance and Score tabs collapsed into one period-centric "Lab" tab** (`KitchenScorePanel.jsx`). `App.jsx` lifts the working lab + period (persisted per course), so the teacher picks a lab once and flows create→grade across periods. Attendance (present/absent) and grading live on one screen; edits autosave a local draft and nothing posts to Canvas until a PIN-gated **Commit Period** (warn-but-allow). Reopening a period with an unsaved draft shows a resume/discard prompt. The Unit rollup in `ScoringPanel.jsx` hard-refuses a push until every lab in the unit has grades.

## Related projects

`../culinary-canvas-tools` is the extension this was forked from — check its `DECISIONS.md` for product/design history predating the fork, and its `CLAUDE.md` for anything this file doesn't repeat.

`../canvas-power-tools` (sibling repo, same author) is a more mature Chrome extension with overlapping Canvas API conventions and a numbered `design_docs/` system. It already has a working New Quizzes API wrapper (`src/api/newQuizzes.js`) and QTI export tooling (`src/utils/qtiQuizExport.js`) — check there before building anything quiz- or item-bank-related here rather than re-deriving it.

## Known stale references

`scoring.js`, `scoring.test.js`, and `storage/setup.js` have comments citing a `PLAN.md` that does not exist in this repo — carried over from an earlier prototype, predating even the extension. Don't go looking for it.
