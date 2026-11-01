# Fork patches: what differs from upstream openGym

The fork (Telegram Mini App «Жимолость») is upstream openGym plus the patches below. This list is the
reference for every upstream merge: if a merge touches one of these files, the patch must survive.
`npm run fork:check` (repo root) verifies the ones marked with a guard. Source of truth for the full
diff: `git diff --stat <upstream tag> HEAD` and `git log <upstream tag>..HEAD` (last baseline: `v1.4.3`).

How to read the "Guard" column: the test or check that goes red if a merge puts the upstream version
back. "fork:check" lists the presence checks in `scripts/fork-check.mjs`; `fork-guards` is
`frontend/src/lib/fork-guards.test.js`; `fork-routes` is `api/test/fork-routes.test.js`.

## Server (`api/`)

| Patch | Files | Why | Guard |
|---|---|---|---|
| Telegram-only entry (`TELEGRAM_ONLY`) | `api/server.js` (`TELEGRAM_ONLY_REFUSED`, check before dispatch), `compose.telegram.yml` (`TELEGRAM_ONLY: 1`) | Passkey, password, device-link and pairing routes answer 403 `telegram-only`; the only way in is a signed Telegram identity. Off by default, so plain openGym is unchanged | `api/test/server-telegram-only.test.js`, fork-routes, fork-check, fork-guards (compose) |
| Telegram login and profile | `api/telegram-auth.mjs`, `api/server.js` (`POST /api/telegram/login`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ALLOWED_IDS`, `INVITE_ONLY` rules, `publicUser.avatarUrl`) | Validates signed `initData`, creates or finds the profile by Telegram id, never links by name | `api/test/telegram-login.test.js`, fork-routes |
| `X-OpenGym-User` identity header | `api/server.js` (`stateIdentityMatches`) | A tab that captured profile A cannot read or write profile B after another tab signs in | `telegram-login.test.js` (captured user header), fork-routes |
| Telegram routes in the API spec | `api/openapi.yaml` (`/api/telegram/login`, `/api/telegram/notifications`) | `openapi-routes.test.js` compares routes with the spec | `api/test/openapi-routes.test.js`, fork-routes (both exist, not just equal) |
| Audit labels `auth.telegram.*` | `api/server.js` (`audit`/`auditFail`), `frontend/src/lib/audit.js` (`ok`, `fail`, `register`, `denied`, reason `not-allowed`) | The admin audit log shows readable text for Telegram events | `frontend/src/lib/audit.test.js`, fork-routes |
| Bot notifications | `api/telegram-notifications.mjs`, `api/server.js` (`maybeNotifyNewWorkout`, `telegramWeeklyTick`, `/api/telegram/notifications`), `api/Dockerfile` (the file is in `COPY`) | Workout message and weekly summary to the user's chat, opt-in | `telegram-login.test.js`, fork-guards (Dockerfile COPY), fork-routes |
| Trainer mode, stage 1 (TG14) | `api/trainer.js` (rules, read filter), `api/server.js` (`/api/trainer/*` routes, `trainerCaller`, `trainerInviteFor`, `db.trainerInvites`/`db.trainerLinks`, `removeAccount`, dispatcher lines for `{id}`), `api/openapi.yaml`, `api/Dockerfile` (`COPY ... trainer.js`), `frontend/src/lib/audit.js` (`trainer.*`) | A trainer reads the history, measurements and muscle stats a client opened, read only; invitation `t_<token>`, consent with 18+ box, at most 5 active clients. Details: `docs/telegram/TRAINER_MODE.md` | `api/test/trainer.test.js`, fork-routes (routes, documented, read only), fork-check, `audit.test.js` |
| Trainer mode, managed clients (TG14, stage 1.5) | `api/trainer-managed.js` (rules, `applyOps`), `api/server.js` (`/api/trainer/managed*` routes, `managedTarget`, `commitState` shared with `PUT /api/data`, `isManaged` in `sessionUser`, cascade in `removeAccount`, health and admin flags), `api/openapi.yaml`, `api/Dockerfile` (`COPY ... trainer-managed.js`), `frontend/src/lib/audit.js` (`trainer.managed.*`) | A trainer keeps the diary of a client without Telegram: a profile with no way in, counted in the 5 clients, changed only by server-side operations. Details: `docs/telegram/TRAINER_MODE.md` section 12 | `api/test/trainer-managed.test.js`, fork-routes (writes only through `commitState` after `managedTarget`), fork-check |
| Brand in server | `api/server.js` (`RP_NAME` default), `api/push-messages.js` | Product name «Жимолость» | fork-guards (brand) |

## Web server (`web/`)

| Patch | Files | Why | Guard |
|---|---|---|---|
| CSP for Telegram | `web/Dockerfile` (`CONTENT_SECURITY_POLICY`): `frame-ancestors 'self' https://web.telegram.org`, `https://telegram.org` in `script-src`, the sha256 of the inline script in `frontend/index.html` | Telegram Web embeds the app in an iframe and the Web App SDK loads from telegram.org. The hash must change whenever the inline script changes | `frontend/src/lib/csp.test.js`, fork-check |
| No `X-Frame-Options` | `web/nginx.conf.template` (every block) | The header forbids the Telegram Web iframe; `frame-ancestors` in the policy limits parents instead | `csp.test.js`, fork-check |
| Entrypoint CR strip | `web/Dockerfile` (`sed -i 's/\r$//'` on `05-check-base-path.sh`) | A Windows checkout with CRLF made the container fail at start | fork-guards |

## Frontend (`frontend/`)

| Patch | Files | Why | Guard |
|---|---|---|---|
| Keyboard recompute (UI01) | `src/lib/use-sheet-keyboard.js` (`watchKeyboardViewport`), `src/components/ui.jsx` (picker sheet uses it) | Telegram iOS shrinks the window a beat after the visual viewport; the sheet was lifted by a stale value. Re-measures on window resize, `viewportChanged` and at 120/450 ms. This is the one an upstream merge silently replaced on 26.10 | `use-sheet-keyboard.watch.test.js`, fork-guards, fork-check |
| Keyboard diagnostics | `src/lib/kb-debug.js`, `src/main.jsx` (`startKbDebug`), `src/index.css` (`html[data-kbmode=...]`, bottom of file), `src/views/Settings.jsx` (7 taps on the version) | A permanent debug tool for keyboard layout on a real phone, off by default | `kb-debug.test.js`, fork-guards, fork-check |
| Telegram safe-area | `src/index.css` (`--tg-safe-top/bottom` inside `--sab`/`--sat`) | Telegram's own insets | fork-guards |
| Boot page ignores foreign scripts | `frontend/index.html` (the inline error handler, only same-origin scripts count) | Cloudflare's analytics beacon is blocked by the CSP and showed «could not start». Changing this script changes its CSP hash | fork-guards (runs the handler), fork-check, `csp.test.js` (hash) |
| Telegram launch gate | `src/App.jsx` (`telegram` status: Shell stays unmounted until sign-in is confirmed), `src/lib/telegram.js`, `src/store/useStore.js` (`bootTelegram`), `src/main.jsx` (`startTelegramAwareMediaSync`) | Old browser state of another user must not show before the identity is known | `App.telegram.test.jsx`, `telegram.test.js`, `useStore.telegram.test.jsx`, fork-guards (order in App.jsx) |
| First-run onboarding | `src/views/FirstRunOnboarding.jsx/.css`, `src/App.jsx` (`needsFirstRunOnboarding`) | Welcome flow for new Telegram users | `FirstRunOnboarding.test.jsx`, fork-guards |
| Brand «Жимолость» | `src/lib/brand.js`, `src/lib/i18n-core.js` (`brandText`), `index.html` title, `public/manifest.json`, `public/sw.js`, `Home.jsx`, `Settings.jsx`, `locales/ru.js` | Product name and attribution | `brand.test.js`, fork-guards |
| Telegram avatar | `src/components/ProfileAvatar.jsx`, `Settings.jsx`, `index.css` (`.sp-avatar img`) | Signed Telegram photo | `ProfileAvatar.test.jsx` |
| Telegram account in Settings | `src/views/Settings.jsx` (`telegramAuth`: no passkeys, pairing, sign-out rows; Telegram messages card) | These do not exist for Telegram profiles | fork-guards |
| Removed screens | check-in (`views/CheckIn`, Home card, Settings row), progress photos (Stats card, route redirects to `/stats`), install tips and APK / support links in Settings | They do not apply to a Mini App | fork-guards (they must stay out of `App.jsx`, `Home.jsx`, `Stats.jsx`, `settings-pages.js`, `Settings.jsx`) |
| Trainer mode screens (TG14) | `src/lib/trainer.js`, `src/lib/plan-link.js` (`launchOf`, `trainerTokenOf`, `takePendingTrainer`: `p_` and `t_` parsed in one place), `src/components/TrainerConsent.jsx` (+ `<TrainerConsentGate>` in `App.jsx`), `src/components/TrainerSettings.jsx` (card in `Settings.jsx` root), `src/views/TrainerHome.jsx`, `src/views/TrainerClient.jsx`, routes `/trainer`, `/trainer/:linkId` in `App.jsx` | Consent screen, cabinet and read only client view. The client's data is held in the component only, never in the store or storage | `lib/trainer.test.js`, `components/TrainerConsent.test.jsx`, `views/Trainer.test.jsx`, `lib/plan-link.test.js`, fork-check |
| Trainer mode, managed client screens (TG14) | `src/lib/trainer-managed.js`, `src/components/ManagedEditor.jsx`, `src/views/TrainerManaged.jsx`, the add choice in `src/views/TrainerHome.jsx`, exports in `src/views/TrainerClient.jsx`, route `/trainer/m/:linkId` in `App.jsx` | Workout, weight and measurement forms for a managed client; the diary is held in the screen only | `lib/trainer-managed.test.js`, `views/TrainerManaged.test.jsx`, `views/Trainer.test.jsx`, fork-check |
| Managed diary as the ordinary app (TG14, section 13) | `src/lib/managed-mode.js` (first import of `src/main.jsx`: storage prefix, `/api` guard), `src/lib/telegram.js` (`isTelegramLaunch` is false in it), `src/App.jsx` (`managed` routes, `<ManagedBar />`, no first-run, no push, no gates), `src/components/ManagedBar.jsx`, `src/components/TabBar.jsx` (no library tab), `src/views/ManagedSettings.jsx`, `src/views/Plan.jsx` (no Telegram share), `src/index.css` (`.managed-bar`), `api/server.js` (`/api/trainer/managed/{id}/data`, `stateBodyError`), `api/trainer-managed.js` (`managedStateIn/Out`) | The trainer opens a client without Telegram as the app itself, in the client's name; the two worlds never share a storage key | `lib/managed-mode.test.js`, `components/ManagedBar.test.jsx`, `views/TrainerManaged.test.jsx`, `api/test/trainer-managed.test.js`, fork-routes, fork-check |
| Dev server host | `vite.config.js` (`allowedHosts` from `APP_HOST`) | Quick Cloudflare tunnel for local testing | fork-guards |

## Outside the app

`integration/` (bot, webhook setup, tests), `compose.telegram.yml`, `scripts/dev.mjs`,
`scripts/check-telegram-local.mjs`: files that upstream does not have, so a merge does not conflict
with them. Their own tests: `node --test integration/*.test.mjs`. The `integration/` tests are not
part of `fork:check` (another task changes them).

## Not protected

- **Look of the keyboard sheets on a real phone**: tests cover the code path (the listeners), not
  Telegram iOS itself. Check by hand on an iPhone in Telegram after each merge.
- **Texts in `locales/ru.js`**: nothing fails if upstream changes a string; only the Russian pack
  fingerprint tests of upstream apply.
- **Visual details of onboarding and `index.css`** beyond the rules named above.
- **Removed screens in files not named in the guard** (a new upstream link to `/checkin` elsewhere).
