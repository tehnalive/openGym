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
