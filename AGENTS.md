# Project context

The user is building a personal gym diary for two Android users. Research is in `research/`; selected implementation is an openGym adaptation for Telegram Mini App on a normal Docker server. The domain is managed at Cloudflare; do not migrate the API to Workers/D1 without a new user request.

## Source and ownership

- The repository root is the openGym application fork. Preserve LICENSE and third-party NOTICE, especially exercise media restrictions.
- `integration/` contains Telegram bot/deployment helpers. The canonical initData validator is `api/telegram-auth.mjs`; its integration entrypoint only reexports it.
- `.cache/` is ignored scratch/runtime data, never the implementation source.
- Update `TELEGRAM_PLAN.md` and `KANBAN.md` with actual completion evidence. Do not mark real Telegram/Docker/server checks done from mocks alone.

## Development

Use Node 22+; current local checks may run Node 24. `node scripts/dev.mjs` starts local API+Vite without sending bot messages. `compose.telegram.yml` builds custom images; upstream prebuilt images do not contain our changes.

Meaningful checks: `node --test integration/telegram-auth.test.mjs integration/telegram-bot.test.mjs`; API `node --test test/telegram-login.test.js`; frontend Telegram/store adoption tests and `npm run build`; `docker compose -f compose.telegram.yml config --quiet`. See recorded validation for exact names and environment limitations.

## Identity and secrets

Never trust initDataUnsafe, browser Telegram IDs or names as authentication. Validate raw initData server-side, then map signed Telegram ID to its own persistent profile. Do not link existing accounts by name/email. Never embed bot tokens in browser code, logs, screenshots or committed config.

Block Telegram bootstrap before rendering old stored profiles or syncing data. Preserve guest/previous-owner pending records in separate local copies; never silently import them into another Telegram account. Keep the X-OpenGym-User guard on state requests and check identity again after awaits.

Public deployment, bot setup and actual messages require the user's configured infrastructure and bot. Do not invent credentials, disable validation for a demo, or start external polling with a real token as a test.
