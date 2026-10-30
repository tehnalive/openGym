// Guards for the Telegram fork's API patches (docs/telegram/FORK_PATCHES.md). They read the source
// files: the routes, their openapi entries and the audit labels must survive an upstream merge.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = rel => fs.readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const server = read('../server.js');
const openapi = read('../openapi.yaml');

for (const route of ['POST /api/telegram/login', 'GET /api/telegram/notifications', 'PUT /api/telegram/notifications']) {
  test(`route ${route} exists and is documented`, () => {
    assert.ok(server.includes(`'${route}'`), `${route} missing from server.js`);
    const [method, path] = route.split(' ');
    const block = openapi.split(/\n(?=  \/)/).find(b => b.startsWith(`  ${path}:`)) || '';
    assert.ok(block.includes(`    ${method.toLowerCase()}:`), `${route} missing from openapi.yaml`);
  });
}

test('audit events auth.telegram.* are written by the login route', () => {
  for (const ev of ['auth.telegram.ok', 'auth.telegram.fail', 'auth.telegram.register', 'auth.telegram.denied']) {
    assert.ok(server.includes(`'${ev}'`), `${ev} missing from server.js`);
  }
});

test('TELEGRAM_ONLY refuses the passkey, password and pairing routes before dispatch', () => {
  assert.match(server, /TELEGRAM_ONLY && TELEGRAM_ONLY_REFUSED\.has\(key\)/);
  for (const r of ['POST /api/login/verify', 'POST /api/register/verify', 'POST /api/login/password', 'POST /api/pair/redeem']) {
    assert.ok(server.includes(`'${r}'`), `${r} not in the refused list`);
  }
});

test('state writes check the Telegram identity header and can notify the chat', () => {
  assert.match(server, /function stateIdentityMatches/);
  assert.match(server, /maybeNotifyNewWorkout\(user, cur, body\.state\)/);
});

for (const route of ['GET /api/trainer/me', 'PUT /api/trainer/me', 'POST /api/trainer/invites', 'GET /api/trainer/invites', 'DELETE /api/trainer/invites/{id}',
  'GET /api/trainer/invites/preview', 'POST /api/trainer/invites/accept', 'GET /api/trainer/clients', 'GET /api/trainer/clients/{id}/data', 'DELETE /api/trainer/links/{id}',
  'POST /api/trainer/managed', 'GET /api/trainer/managed/{id}', 'DELETE /api/trainer/managed/{id}', 'POST /api/trainer/managed/{id}/ops',
  'GET /api/trainer/managed/{id}/export']) {
  test(`trainer route ${route} exists and is documented`, () => {
    assert.ok(server.includes(`'${route}'`), `${route} missing from server.js`);
    const [method, path] = route.split(' ');
    const block = openapi.split(/\n(?=  \/)/).find(b => b.startsWith(`  ${path}:`)) || '';
    assert.ok(block.includes(`    ${method.toLowerCase()}:`), `${route} missing from openapi.yaml`);
  });
}

test('trainer mode is read only: no trainer route writes a client document', () => {
  const start = server.indexOf("'GET /api/trainer/me'");
  const end = server.indexOf("'GET /api/telegram/notifications'");
  assert.ok(start > 0 && end > start);
  // The managed-client routes (the trainer's own diaries for people without Telegram) are the one place a trainer writes;
  // they are checked by the next test. Everything else must not touch a state file.
  const mStart = server.indexOf("'POST /api/trainer/managed'");
  const mEnd = server.indexOf("'DELETE /api/trainer/links/{id}'");
  assert.ok(mStart > start && mEnd > mStart);
  const code = server.slice(start, mStart) + server.slice(mEnd, end);
  assert.ok(!/stateFile|atomicWrite|writeState|stateCache|commitState/.test(code), 'a trainer route touches a state file');
  // The only client route is the one read; nothing else addresses /api/trainer/clients.
  const clientKeys = [...code.matchAll(/^\s*'(GET|POST|PUT|DELETE) (\/api\/trainer\/clients[^']*)':/gm)].map(m => `${m[1]} ${m[2]}`);
  assert.deepEqual(clientKeys.sort(), ['GET /api/trainer/clients', 'GET /api/trainer/clients/{id}/data']);
});

test('the only client document a trainer writes is a managed one, through commitState, after managedTarget', () => {
  const start = server.indexOf("'POST /api/trainer/managed'");
  const end = server.indexOf("'DELETE /api/trainer/links/{id}'");
  const code = server.slice(start, end);
  assert.ok(!/atomicWrite|writeState|stateCache/.test(code), 'managed routes write by hand');
  for (const m of code.matchAll(/commitState\(([^,]+),/g)) assert.ok(/^(t\.client|client)$/.test(m[1].trim()), 'commitState on ' + m[1]);
  // Every managed route except the one that creates the profile first resolves the owner's own managed link.
  for (const key of ["'GET /api/trainer/managed/{id}'", "'POST /api/trainer/managed/{id}/ops'", "'GET /api/trainer/managed/{id}/export'", "'DELETE /api/trainer/managed/{id}'"]) {
    const at = code.indexOf(key);
    assert.ok(at >= 0, key);
    assert.ok(/managedTarget\(req, res, user\)/.test(code.slice(at, at + 700)), key + ' does not call managedTarget');
  }
  // A managed profile has no session, no sign-in, no reminders.
  assert.match(server, /if \(isManaged\(user\)\) return null;/);
});
