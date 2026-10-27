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
npm run test      # node --test "src/**/*.test.js"
```

Run a single test file directly: `node --test src/pages/labs/scoring.test.js`

**Running it:** `npm run dev` and open `http://localhost:5175/`, or `npm run build` and serve `dist/` from any static host over HTTPS. No install/reload step — it's just a web page.

## Why this fork exists, and the one open risk

The extension's `chrome.*` surface turned out to be almost entirely shell plumbing (navigation between pages, key-value storage) with zero coupling to the Canvas page itself — no content script, no DOM injection, no session-cookie reliance. Every Canvas call already went through `fetch` with `Authorization: Bearer <token>` in `api/request.js`. That made this port mechanical rather than a rewrite. See the original repo's conversation history for the full audit.

**The one thing that isn't guaranteed to work:** the extension's `host_permissions` let its `fetch` calls bypass CORS entirely — a browser-level exemption tied to the extension's identity, not anything Canvas does differently. A plain web page gets no such exemption; its cross-origin `fetch` calls are enforced by the browser against whatever `Access-Control-Allow-Origin` (and preflight `Access-Control-Allow-Headers`/`-Methods`, since `Authorization` triggers a preflight) Canvas's response actually sends back. If Granite's Canvas instance doesn't allow this page's origin, API calls will fail in the browser console with a CORS error even though the exact same request works fine from the extension. If that happens, the fix is a dumb pass-through proxy (forward request, forward response, log nothing, persist nothing) — not a redesign of this app — but that reintroduces a server component that sees student data in transit, which the extension version never had. Don't build that proxy speculatively; only if a real CORS failure shows up.

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

The Canvas API token is still AES-GCM encrypted (`storage/encryption.js`) with a per-browser key that never leaves `localStorage`. `getDecryptedToken()` is the only way to get a usable token, and `api/request.js` calls it immediately before every fetch — never hold a decrypted token in component state. **This matters more here than it did in the extension:** an extension's storage is isolated from arbitrary page scripts by the browser; `localStorage` on a web origin is readable by any script that runs on that origin. No third-party scripts, no CDN-hosted dependencies, no analytics — ship a strict CSP (`script-src 'self'`, no `unsafe-inline`/`unsafe-eval`) once this is actually deployed somewhere.

### Canvas API layer — unchanged

Every Canvas call goes through `src/api/request.js` (`canvasGet` / `canvasGetAll` / `canvasPost` / `canvasPut` / `canvasDelete`): auth headers, pagination (`canvasGetAll` follows the `Link` response header), and rate-limit backoff (a 403 with `X-Rate-Limit-Remaining` pauses subsequent requests) all live there — feature code never touches `fetch` directly. None of this changed in the port; it was already extension-agnostic.

Each `api/*.js` module maps Canvas's raw snake_case JSON to a camelCase internal shape before returning it (see `assignments.js`'s `mapAssignment` / `buildPayload` pair for the pattern) — components never see raw Canvas JSON.

Errors are typed (`api/errors.js`): `AuthError` (401), `NotFoundError` (404), `RateLimitError` (403, carries backoff ms), `ApiError` (everything else). Callers pattern-match on error type, not HTTP status. A CORS failure shows up differently from these — as a browser-level network error with no response object at all, not a typed `ApiError` — so don't expect `api/errors.js` to catch it.

### PIN gate / write protection — unchanged

`usePinGate()` (`security/usePinGate.jsx`) wraps every Canvas-writing action: `requirePin(auditMeta, action, { forcePrompt })` runs `action()` immediately if the PIN is disabled or the session was recently active, otherwise shows `PinPrompt` and defers `action` until verified. Every gated action logs to the audit log regardless of whether the prompt appeared. `forcePrompt: true` is for irreversible operations: always re-prompts, blocks outright (`PinRequiredError`) if no PIN is configured.

### Theming — unchanged, already portable

Palette, dark/light/system, and text size are applied via `utils/color.js` and persisted to `localStorage` only (this was already true in the extension — `color.js` never touched `chrome.storage`, specifically so `public/theme-init.js`'s classic inline script could paint the right theme before first render). The extension needed a CRXJS plugin pair (`stripClassicScripts`/`injectClassicScripts`) purely to stop CRXJS's dev-mode transform from choking on that non-module script; plain Vite has no such problem, so `vite.config.js` here is just `react()` plus the multi-entry build — no workaround plugins.

### Tailwind token guard (`eslint.config.js`) — unchanged

The only lint rule configured is a `no-restricted-syntax` guard that fails on raw Tailwind color utilities (`text-gray-500`), arbitrary hex in Tailwind values (`bg-[#B7102A]`), and bare hex anywhere (`style={{ color: '#ef4444' }}`). Every color must resolve through a `--color-*` custom property defined in `src/styles/global.css`. Picking the right token matters as much as using one — see the original repo's `DECISIONS.md` ("Theme contrast") for the token-usage rules; they carried over unchanged.

### Tool page structure — Labs, Attendance & Professionalism (`src/pages/labs/`)

Unchanged from the extension — see the original repo's `CLAUDE.md` for the full breakdown of tabs, the Pairing/Standalone vocabulary, Unit/Term rollup, and `scoring.js`. None of that logic touched `chrome.*` and none of it changed here.

## Related projects

`../culinary-canvas-tools` is the extension this was forked from — check its `DECISIONS.md` for product/design history predating the fork, and its `CLAUDE.md` for anything this file doesn't repeat.

`../canvas-power-tools` (sibling repo, same author) is a more mature Chrome extension with overlapping Canvas API conventions and a numbered `design_docs/` system. It already has a working New Quizzes API wrapper (`src/api/newQuizzes.js`) and QTI export tooling (`src/utils/qtiQuizExport.js`) — check there before building anything quiz- or item-bank-related here rather than re-deriving it.

## Known stale references

`scoring.js`, `scoring.test.js`, and `storage/setup.js` have comments citing a `PLAN.md` that does not exist in this repo — carried over from an earlier prototype, predating even the extension. Don't go looking for it.
