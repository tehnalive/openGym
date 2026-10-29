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

## How to update from upstream (procedure)

The «Updating from upstream» section above is the old, short version. Use this one. It exists because the
iOS keyboard fix was silently replaced by upstream code in the v1.4.3 merge (26.10) and the bug only came
back on a phone. What the fork changes, and what guards each change: [docs/telegram/FORK_PATCHES.md](docs/telegram/FORK_PATCHES.md).

1. **A separate branch, from a release tag.** `git fetch upstream --tags`, then
   `git switch -c merge/upstream-<version> <the branch that is deployed>` and `git merge <version tag>`
   (for example `v1.5.0`). Never merge upstream `main`: it is not a release. One-time setup on a machine:
   `git config core.autocrlf input` and `git config rerere.enabled true` (`.gitattributes` keeps LF in the repo).
2. **Resolve conflicts by reading both sides.** For every file in FORK_PATCHES.md that the merge touched, keep
   the fork's patch and take upstream's changes around it. If upstream changed the same area, adapt the patch
   to the new code, do not drop it. A file that merged without conflict can still lose a patch: step 3 finds that.
3. **`npm run fork:check`** (repo root; needs `npm ci` in `frontend/` and `api/`). It must be green. Red means
   a patch is gone or changed: fix it in the code, do not edit a guard test to make it pass (only when the patch
   is deliberately retired, and then update FORK_PATCHES.md in the same commit). If the inline script in
   `frontend/index.html` changed, the sha256 in `web/Dockerfile` has to change too (`csp.test.js` tells).
4. **The full tests in a clean LF copy** (Windows checkouts may have CRLF that fails tests which read files):
   `git -c core.autocrlf=false archive HEAD api frontend web scripts integration docs helm kubernetes website compose.telegram.yml package.json package-lock.json | tar -x -C <folder outside the repo>`,
   copy `node_modules` of `api/` and `frontend/` into it, then `node --test test/*.test.js` in `api` and
   `npx vitest run` in `frontend`.
5. **Compare the failures with clean upstream.** Do the same in a copy of the release tag itself. Failures that
   are also red there (on Windows several are: jobs, coach-limits, server-recovery and others) are not ours.
   Every failure that is only on our branch has to be fixed before going on.
6. **By hand on phones, in Telegram:** iPhone (open the exercise picker, tap search, the sheet must stay above
   the keyboard; sign-in; a workout; notifications) and Android (the same). Telegram Web in a browser too:
   it must open in the iframe.
7. **Deploy only after a backup**, with the way back written down: the previous image tags or commit, a copy of
   `data/`, and the commands to restore both. Deploy, check `/api/health` and one Telegram sign-in, and be
   ready to roll back. Do not push the branch to the public GitHub before it is verified.
