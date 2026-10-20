# openGym fork and upstream updates

- Original repository: https://github.com/DuarteSantos8/openGym (`upstream` remote).
- Personal fork: https://github.com/tehnalive/openGym (`origin` remote).
- Baseline: `e348fc17c42c7e9a211c5972e573ad3698190ee2`, retrieved 2026-10-20.
- Telegram implementation branch: `telegram-mini-app`, based on upstream `main`.

The repository root contains the openGym source. Telegram changes add server-side initData validation, profile/session exchange, a gated Mini App login flow, bot launcher and Docker/Caddy configuration. This is an independent adaptation, not an official openGym release.

## Updating from upstream

Keep `main` in the fork aligned with upstream. Do feature work on `telegram-mini-app` or short-lived branches based on it. To bring in an upstream release:

```sh
git fetch upstream
git switch main
git merge --ff-only upstream/main
git push origin main
git switch telegram-mini-app
git merge main
```

If the last merge reports conflicts, resolve them in the Telegram branch, review upstream authentication and data-sync changes carefully, and run the API/frontend tests plus Docker Compose configuration check before pushing. Keep custom changes in `api/telegram-auth.mjs`, `integration/`, and small focused patches to upstream files so future merges stay reviewable. Do not replace custom builds with upstream prebuilt images.

## Licensing

The application code is AGPL-3.0-or-later, consistent with upstream. Keep the upstream `LICENSE`, `NOTICE.md`, and exercise media notices and terms. Exercise media has separate restrictions; this fork must preserve the upstream limits and notices. When a modified version is made available as a network service, provide its corresponding source under the applicable AGPL terms. Commercial use of the exercise media may need a separate license from its rights holder.
