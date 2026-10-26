# Project context

The user is building «Жимолость», a gym diary for trainers and trainees. The initial pilot was for two Android users; on 22.10.2026 the user chose the trainer/trainee service as the product direction. Research is in `research/`; selected implementation is an openGym adaptation for Telegram Mini App on a normal Docker server. The domain is managed at Cloudflare; do not migrate the API to Workers/D1 without a new user request.

## Project orchestration

Start with `docs/telegram/README.md` and `docs/telegram/HANDOFF.md` for portable project documentation. Features, configuration and operational instructions live alongside them. Local planning/status files can be absent from a repository-only handoff; the handoff document includes a dated roadmap snapshot. Keep these docs aligned with changed behavior and distinguish historical evidence from new verification.

- Read `ORCHESTRATION.md` for team roles and the user's decisions. `KANBAN.md` is the task ledger; `TELEGRAM_PLAN.md` is the feature and acceptance plan. Keep one writer per shared file and assign bounded tasks with evidence of completion.
- The user authorized the orchestrator to assign work to existing project chats and create necessary subagents. Usually run one or two workers, at most three on independent tasks. Workers do not delegate further unless the orchestrator explicitly assigns that responsibility.
- Allowed worker models: `gpt-6.1-sol`, `gpt-6-luna`, `gpt-5.6-terra`, `gpt-5.6-luna`. Use only `low`, `medium`, or `high` reasoning; never exceed `high`. Do not silently substitute a different model if a selected model is unavailable.
- The user authorized future deployments of agreed work without asking again, after appropriate tests and independent review. Verify a backup and rollback path before deploying; record actual post-deployment evidence. The current organizational task does not request a new deployment.
- Independent review must come from a different author. Local, simulated, public HTTP and real Telegram/Android checks remain separate acceptance evidence.

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
