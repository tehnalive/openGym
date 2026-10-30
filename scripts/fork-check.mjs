#!/usr/bin/env node
// Checks that the Telegram fork's patches on top of upstream openGym are still in place.
// Run it after every upstream merge, before anything else: `npm run fork:check` (repo root).
// Red means "do not deploy". The patch list and the reason for each is docs/telegram/FORK_PATCHES.md.
//
// 1. Quick presence checks: key lines are in the files (works without node_modules).
// 2. The guard tests: vitest in frontend/ and node --test in api/ (needs `npm ci` in both).
// No Docker, no network. Works on Windows.
import { existsSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = p => readFileSync(join(root, p), 'utf8').replace(/\r\n/g, '\n')

// [patch, file, kind, needle]: kind 'has' = the text must be there, 'not' = it must not be.
const PRESENCE = [
  ['TELEGRAM_ONLY: refusal list', 'api/server.js', 'has', 'TELEGRAM_ONLY && TELEGRAM_ONLY_REFUSED.has(key)'],
  ['TELEGRAM_ONLY: on in the compose file', 'compose.telegram.yml', 'has', 'TELEGRAM_ONLY'],
  ['Telegram login route', 'api/server.js', 'has', "'POST /api/telegram/login'"],
  ['Telegram notification routes', 'api/server.js', 'has', "'PUT /api/telegram/notifications'"],
  ['Telegram routes in openapi.yaml', 'api/openapi.yaml', 'has', '/api/telegram/login:'],
  ['Audit labels auth.telegram.*', 'frontend/src/lib/audit.js', 'has', "'auth.telegram.ok'"],
  ['API image ships telegram-auth/notifications', 'api/Dockerfile', 'has', 'telegram-notifications.mjs'],
  ['CSP: Telegram Web may frame the app', 'web/Dockerfile', 'has', "frame-ancestors 'self' https://web.telegram.org"],
  ['CSP: Telegram SDK script', 'web/Dockerfile', 'has', 'script-src \'self\' https://telegram.org'],
  ['nginx: no X-Frame-Options', 'web/nginx.conf.template', 'not', 'add_header X-Frame-Options'],
  ['Keyboard: watchKeyboardViewport', 'frontend/src/lib/use-sheet-keyboard.js', 'has', 'export function watchKeyboardViewport'],
  ['Keyboard: picker uses it', 'frontend/src/components/ui.jsx', 'has', 'watchKeyboardViewport(sync)'],
  ['Keyboard diagnostics module', 'frontend/src/lib/kb-debug.js', 'has', 'toggleKbDebug'],
  ['Keyboard diagnostics: 7 taps in Settings', 'frontend/src/views/Settings.jsx', 'has', 'if (k.n < 7) return'],
  ['Boot page ignores foreign script errors', 'frontend/index.html', 'has', "t.src.indexOf(location.origin + '/') !== 0"],
  ['Telegram entry gate in App', 'frontend/src/App.jsx', 'has', "telegram && !['off', 'ready'].includes(telegram.status)"],
  ['First-run onboarding', 'frontend/src/App.jsx', 'has', 'FirstRunOnboarding'],
  ['Brand: Жимолость in the manifest', 'frontend/public/manifest.json', 'has', '"name": "Жимолость"'],
  ['Trainer mode: client data route', 'api/server.js', 'has', "'GET /api/trainer/clients/{id}/data'"],
  ['Trainer mode: read only filter', 'api/trainer.js', 'has', 'export function trimForTrainer'],
  ['Trainer mode: consent needs the 18+ box', 'api/server.js', 'has', "'POST /api/trainer/invites/accept'"],
  ['Trainer mode: routes in openapi.yaml', 'api/openapi.yaml', 'has', '/api/trainer/clients/{id}/data:'],
  ['Trainer mode: API image ships trainer.js', 'api/Dockerfile', 'has', 'trainer.js'],
  ['Trainer mode: audit labels trainer.*', 'frontend/src/lib/audit.js', 'has', "'trainer.read'"],
  ['Trainer mode: t_ launch parameter', 'frontend/src/lib/plan-link.js', 'has', 'export const trainerTokenOf'],
  ['Trainer mode: consent screen in App', 'frontend/src/App.jsx', 'has', 'TrainerConsentGate'],
  ['Trainer mode: cabinet routes in App', 'frontend/src/App.jsx', 'has', '/trainer/:linkId'],
  ['Trainer mode: managed clients have no session', 'api/server.js', 'has', 'if (isManaged(user)) return null;'],
  ['Trainer mode: managed clients write through commitState', 'api/server.js', 'has', 'commitState(t.client,'],
  ['Trainer mode: API image ships trainer-managed.js', 'api/Dockerfile', 'has', 'trainer-managed.js'],
  ['Trainer mode: managed routes in openapi.yaml', 'api/openapi.yaml', 'has', '/api/trainer/managed/{id}/ops:'],
  ['Trainer mode: managed client screen route', 'frontend/src/App.jsx', 'has', '/trainer/m/:linkId'],
  ['Trainer mode: settings card', 'frontend/src/views/Settings.jsx', 'has', '<TrainerSettings />'],
  ['Removed: check-in screen', 'frontend/src/App.jsx', 'not', 'views/CheckIn.jsx'],
  ['Removed: progress photos screen', 'frontend/src/App.jsx', 'not', 'views/ProgressPhotos.jsx'],
]

const FRONTEND_TESTS = [
  'src/lib/fork-guards.test.js', 'src/lib/csp.test.js', 'src/lib/use-sheet-keyboard.watch.test.js',
  'src/lib/kb-debug.test.js', 'src/lib/audit.test.js', 'src/lib/brand.test.js', 'src/lib/telegram.test.js',
  'src/App.telegram.test.jsx', 'src/components/ProfileAvatar.test.jsx', 'src/views/FirstRunOnboarding.test.jsx',
  'src/store/useStore.telegram.test.jsx',
  'src/lib/trainer.test.js', 'src/components/TrainerConsent.test.jsx', 'src/views/Trainer.test.jsx', 'src/lib/plan-link.test.js',
  'src/lib/trainer-managed.test.js', 'src/views/TrainerManaged.test.jsx',
]
const API_TESTS = [
  'test/fork-routes.test.js', 'test/server-telegram-only.test.js', 'test/telegram-login.test.js', 'test/openapi-routes.test.js',
  'test/trainer.test.js', 'test/trainer-managed.test.js',
]

const failures = []
const ok = []

console.log('1. Presence checks')
for (const [name, file, kind, needle] of PRESENCE) {
  let found
  try { found = read(file).includes(needle) } catch { found = null }
  const good = found !== null && (kind === 'has' ? found : !found)
  const line = `${name}  (${file})`
  if (good) { ok.push(line); console.log(`   ok    ${line}`) }
  else {
    const why = found === null ? 'file is missing' : kind === 'has' ? `missing: ${needle}` : `must not contain: ${needle}`
    failures.push(`${line}: ${why}`)
    console.log(`   FAIL  ${line}: ${why}`)
  }
}

function run(title, cwd, args, tests, needs) {
  console.log(`\n${title}`)
  if (!existsSync(join(root, cwd, needs))) {
    const msg = `${title}: cannot run (${join(cwd, needs)} not found). Run "npm ci" in ${cwd}/ first.`
    failures.push(msg); console.log(`   FAIL  ${msg}`); return
  }
  const missing = tests.filter(t => !existsSync(join(root, cwd, t)))
  if (missing.length) {
    const msg = `${title}: guard test files are missing: ${missing.join(', ')}`
    failures.push(msg); console.log(`   FAIL  ${msg}`); return
  }
  const r = spawnSync(process.execPath, [...args, ...tests], { cwd: join(root, cwd), stdio: 'inherit' })
  if (r.status === 0) ok.push(title)
  else failures.push(`${title}: exit ${r.status ?? r.signal} (see the output above)`)
}

run('2. Frontend guard tests (vitest)', 'frontend', ['node_modules/vitest/vitest.mjs', 'run'], FRONTEND_TESTS, 'node_modules/vitest/vitest.mjs')
run('3. API guard tests (node --test)', 'api', ['--test'], API_TESTS, 'node_modules')

console.log('\n' + '='.repeat(60))
if (failures.length) {
  console.log(`FORK CHECK FAILED: ${failures.length} problem(s). Do not deploy.`)
  for (const f of failures) console.log(` - ${f}`)
  console.log('See docs/telegram/FORK_PATCHES.md for what each patch is and how to put it back.')
  process.exit(1)
}
console.log(`FORK CHECK OK: ${ok.length} checks passed.`)
