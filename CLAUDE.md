# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Project Is

Culinary Canvas Tools (Web) is a web port of `../culinary-canvas-tools`, a personal Chrome MV3 extension. Same product, same single teacher, same feature set — creating lab professionalism assignments, taking attendance (auto-zero/journal-lock for absences, flag-based scoring for presents), and rolling scores up by Unit (Canvas Module) and Term back to the gradebook. **The app runs inside the Canvas origin** (`graniteschools.instructure.com`): a launcher (bookmarklet or userscript) loads its bundle into a Canvas-origin document, and every Canvas call is a same-origin request on the teacher's own Canvas session. Vercel only serves the code. It's one page with in-app routes, not a multi-page site.

See `DECISIONS.md` for the running log of product/design decisions — check it before assuming an open question hasn't been settled yet. Most of the extension's decision history (scoring model, vocabulary, theming) still applies and lives in the original repo's `DECISIONS.md`; this one only covers what's specific to the web port.

## Commands

```
npm run dev       # vite dev server, port 5175
npm run build     # production build to dist/
npm run preview   # preview the production build
npm run lint      # eslint src — see "Tailwind token guard" below before treating failures as bugs
npm run test      # node --test "src/**/*.test.js"
```

Run a single test file directly: `node --test src/pages/labs/scoring.test.js`

**Running it locally:** put a personal Canvas token in `.env.local` (`CANVAS_DEV_TOKEN=...`, optionally `CANVAS_DEV_ORIGIN=https://...`; gitignored, never `VITE_`-prefixed so it never reaches the bundle), `npm run dev`, and open `http://localhost:5175/app.html`. The dev server proxies `/api/v1` to Canvas with that token — local-only, on the teacher's own machine; production has no proxy. `/` is the install page (launchers). To test the launcher itself without real Canvas, serve `dist/` with `Access-Control-Allow-Origin` on `/assets/*` and inject `launch.js` into a page on another origin.

**Production:** Vercel serves `dist/` (install page, `launch.js`, hashed `assets/`). Nothing else — no functions.

## Why this fork exists, and why it runs inside Canvas

The extension's `chrome.*` surface turned out to be almost entirely shell plumbing (navigation, key-value storage) with zero coupling to the Canvas page — so the port was mechanical. The one thing that broke: a plain web page gets no CORS exemption, and Instructure-hosted Canvas sends no CORS headers. The first fix was a pass-through proxy on Vercel (`api/canvas.js`, now deleted). It logged and stored nothing, but Vercel still received the token and student records in transit, with no district agreement — judged likely out of FERPA / Utah / Granite compliance (see `DECISIONS.md`, 2026-10-29).

The replacement: run the app inside the Canvas origin. `src/launch/launch.js` (built to `dist/launch.js` by the `emitLauncher` plugin in `vite.config.js`, which fills in the hashed bundle names) is injected by a launcher into a document on the Canvas origin, wipes it, and writes the app shell with `<link>`/`<script type="module">` tags pointing back at the Vercel assets. Two launchers, both generated in `src/install/launchers.js` and handed out by the install page (root `index.html`):
- **Bookmarklet** — opens an `about:blank` tab (inherits Canvas's origin) and injects `launch.js` there. That document's `location.origin` is `"null"` and Safari treats it as cookie-averse, so the bookmarklet passes `window.__LABTOOLS__ = { canvasOrigin, csrfToken }` (see `api/canvasContext.js`). Reloading that tab blanks it; relaunch.
- **Userscript** (Userscripts on iPad, Tampermonkey on a laptop) — matches `https://graniteschools.instructure.com/labtools*` (a Canvas 404 page) and takes it over in place, so reload works and a home-screen icon opens the app in one tap.

Module scripts and fonts load in CORS mode, so `vercel.json` sends `Access-Control-Allow-Origin: https://graniteschools.instructure.com` on `/assets/*`. `base: './'` in `vite.config.js` makes chunk/asset URLs resolve against the module's URL (Vercel), never the document (Canvas).

## Architecture

### Entry points — one app page, in-app routes

Two build inputs (`vite.config.js`): the install page (root `index.html` + `src/install/main.js`) and the app (`src/app/main.jsx`, a JS entry — launch.js loads its chunk, and `app.html` hosts it in dev only). The app can't navigate between HTML pages without leaving the Canvas origin, so `src/utils/nav.js` is a tiny router: `navigate(route, params, { replace, remount })` and `useRoute()`. Routes are `home`, `labs`, `settings`, `onboarding`; `src/app/main.jsx` maps them to page components (`shell/index.jsx`, `pages/labs/index.jsx`, `settings/index.jsx`, `pages/onboarding/App.jsx`). The route mirrors to `location.hash` only on a real URL (dev, userscript); the bookmarklet's about:blank tab keeps it in memory. `remount: true` bumps an epoch that remounts the whole tree — used after a reset, standing in for the full page load the multi-page app used to do. Adding a tool: a route in `nav.js`'s `ROUTES`, a component in `main.jsx`'s `PAGES`, and an entry in `config/tools.jsx` (`route`, label, icon), which `AppNav` and the home page read.

### Setup gating

Every route except onboarding is wrapped in `<SetupGuard>`, which redirects to onboarding if `isSetupComplete()` is false. Onboarding no longer asks for a URL or token: it confirms the Canvas session (`getCurrentUser()` → `/api/v1/users/self`), then offers a PIN.

### Storage model — localStorage, Canvas's own

`src/storage/kv.js`'s `kvGet`/`kvSet`/`kvClear` wrap `localStorage`, and every store (`account`, `setup`, `preferences`, `security`, `auditLog`, `labGrading`) calls through it. **In the running app this is Canvas's `localStorage`** — every key carries `KEY_PREFIX` (`labtools:`), and `kvClear` removes only prefixed keys. Anything that touches `localStorage` directly (`utils/color.js`, `public/theme-init.js`, `labs/App.jsx`'s working-context key) must use the prefix too. Each browser's storage is independent for now; cross-device sync via Canvas custom data is the next planned step (`DECISIONS.md`, plan step 4).

`setup.js` still stores only teacher-authored configuration (course/lab/term definitions), deliberately no student data. Attendance/grade state is always re-derived live from Canvas, never cached — this is the single most important property to preserve in this app, extension or web, and has nothing to do with the shell it runs in.

There is no stored Canvas token any more (`encryption.js`, the QR device link, and the token onboarding step are gone). The app's code runs with the teacher's full Canvas session, so the supply chain matters more than ever: no third-party scripts, no CDN-hosted dependencies, no analytics, pinned dependencies, 2FA on GitHub and Vercel. The install page keeps a strict CSP in `vercel.json`; the app itself runs under Canvas's (non-enforcing) policy. The data-handling promise is a standing invariant in `DECISIONS.md` — "Standing invariant — privacy" — and `src/api/canvasInPage.test.js` fails if a serverless `api/` directory, a Vercel rewrite, a hard-coded URL, or a bearer token creeps back into production code. Do not erode it without a deliberate, documented decision.

### Canvas API layer — same-origin, session-authenticated

Every Canvas call still goes through `src/api/request.js` (`canvasGet` / `canvasGetAll` / `canvasPost` / `canvasPut` / `canvasDelete`): pagination (`canvasGetAll` follows the `Link` header, re-rooted on `canvasOrigin()` so dev pagination stays on the localhost proxy), rate-limit backoff (a 403 with `X-Rate-Limit-Remaining` pauses subsequent requests), the `while(1);` prefix strip, and `X-CSRF-Token` on non-GET requests all live there — feature code never touches `fetch` directly. `api/canvasContext.js` supplies the origin and CSRF token (cookie first, else what the bookmarklet handed over).

Each `api/*.js` module maps Canvas's raw snake_case JSON to a camelCase internal shape before returning it (see `assignments.js`'s `mapAssignment` / `buildPayload` pair for the pattern) — components never see raw Canvas JSON.

Errors are typed (`api/errors.js`): `AuthError` (401 — the Canvas session expired; log in and relaunch), `NotFoundError` (404), `RateLimitError` (403, carries backoff ms), `ApiError` (everything else). Callers pattern-match on error type, not HTTP status.

### PIN gate / write protection — unchanged

`usePinGate()` (`security/usePinGate.jsx`) wraps every Canvas-writing action: `requirePin(auditMeta, action, { forcePrompt })` runs `action()` immediately if the PIN is disabled or the session was recently active, otherwise shows `PinPrompt` and defers `action` until verified. Every gated action logs to the audit log regardless of whether the prompt appeared. `forcePrompt: true` is for irreversible operations: always re-prompts, blocks outright (`PinRequiredError`) if no PIN is configured.

### Theming — unchanged, already portable

Palette, dark/light/system, and text size are applied via `utils/color.js` and persisted to (prefixed) `localStorage` only (this was already true in the extension — `color.js` never touched `chrome.storage`, specifically so `public/theme-init.js`'s classic inline script could paint the right theme before first render). The extension needed a CRXJS plugin pair (`stripClassicScripts`/`injectClassicScripts`) purely to stop CRXJS's dev-mode transform from choking on that non-module script; plain Vite has no such problem. In production, `emitLauncher` inlines `theme-init.js` into `launch.js`, so the about:blank tab and the taken-over Canvas page get the same pre-paint theme.

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
