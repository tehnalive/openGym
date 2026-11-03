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
  'GET /api/trainer/managed/{id}/export',
  'GET /api/trainer/managed/{id}/data', 'PUT /api/trainer/managed/{id}/data', 'GET /api/trainer/managed/{id}/data/rev',
  'GET /api/trainer/clients/{id}/doc', 'GET /api/trainer/clients/{id}/doc/rev',
  'PUT /api/trainer/links/{id}/pause', 'DELETE /api/trainer/links/{id}/pause', 'POST /api/trainer/links/{id}/archive', 'POST /api/trainer/links/{id}/restore',
  'GET /api/trainer/templates', 'POST /api/trainer/templates', 'POST /api/trainer/templates/from-client/{id}', 'GET /api/trainer/templates/{id}',
  'PUT /api/trainer/templates/{id}', 'DELETE /api/trainer/templates/{id}', 'POST /api/trainer/templates/{id}/assign',
  'GET /api/trainer/managed/{id}/routines', 'POST /api/trainer/managed/{id}/routines/copy', 'POST /api/trainer/offers/{id}/accept', 'POST /api/trainer/offers/{id}/decline']) {
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
  // The client routes are reads only (the list, the trimmed data, and the same as the app's document); nothing else, and no PUT,
  // addresses /api/trainer/clients: a Telegram client's document cannot be written by a trainer.
  const clientKeys = [...code.matchAll(/^\s*'(GET|POST|PUT|DELETE) (\/api\/trainer\/clients[^']*)':/gm)].map(m => `${m[1]} ${m[2]}`);
  assert.deepEqual(clientKeys.sort(), ['GET /api/trainer/clients', 'GET /api/trainer/clients/{id}/data', 'GET /api/trainer/clients/{id}/doc', 'GET /api/trainer/clients/{id}/doc/rev']);
});

test('the only client document a trainer writes is a managed one, through commitState, after managedTarget', () => {
  const start = server.indexOf("'POST /api/trainer/managed'");
  const end = server.indexOf("'DELETE /api/trainer/links/{id}'");
  const code = server.slice(start, end);
  assert.ok(!/atomicWrite|writeState|stateCache/.test(code), 'managed routes write by hand');
  for (const m of code.matchAll(/commitState\(([^,]+),/g)) assert.ok(/^(t\.client|client)$/.test(m[1].trim()), 'commitState on ' + m[1]);
  // Every managed route except the one that creates the profile first resolves the owner's own managed link.
  // The diary routes open an ACTIVE client only: managedTarget(req, res, user) with no list of statuses. Only the export and
  // the delete may name statuses (an archived client's diary can still be saved and erased), and exactly these two.
  const routeBody = key => {
    const at = code.indexOf(key);
    assert.ok(at >= 0, key);
    const next = code.indexOf('\n  \'', at + key.length);
    return code.slice(at, next > 0 ? next : undefined);
  };
  for (const key of ["'GET /api/trainer/managed/{id}'", "'POST /api/trainer/managed/{id}/ops'", "'GET /api/trainer/managed/{id}/data'", "'PUT /api/trainer/managed/{id}/data'", "'GET /api/trainer/managed/{id}/data/rev'"]) {
    assert.ok(/managedTarget\(req, res, user\)/.test(routeBody(key)), key + ' must call managedTarget(req, res, user) with no statuses');
  }
  for (const key of ["'GET /api/trainer/managed/{id}/export'", "'DELETE /api/trainer/managed/{id}'"]) {
    assert.ok(/managedTarget\(req, res, user, \['active', 'archived'\]\)/.test(routeBody(key)), key + ' may open an archived client, and only with exactly [active, archived]');
  }
  assert.equal([...code.matchAll(/managedTarget\(req, res, user, /g)].length, 2, 'only the export and the delete name statuses');
  // A managed profile has no session, no sign-in, no reminders.
  assert.match(server, /if \(isManaged\(user\)\) return null;/);
});

test('pause and archive routes change the link only: no state file, and only the trainer\'s own link', () => {
  // Pause, resume and archive open an ACTIVE link; restore an ARCHIVED one: not the other way round, and not either.
  const wants = { "'PUT /api/trainer/links/{id}/pause'": 'active', "'DELETE /api/trainer/links/{id}/pause'": 'active', "'POST /api/trainer/links/{id}/archive'": 'active', "'POST /api/trainer/links/{id}/restore'": 'archived' };
  for (const [key, status] of Object.entries(wants)) {
    const at = server.indexOf(key);
    assert.ok(at > 0, key);
    const body = server.slice(at, server.indexOf('\n  },\n', at));
    assert.ok(!/stateFile|atomicWrite|writeState|stateCache|commitState|readStateStrict/.test(body), key + ' touches a state file');
    assert.ok(/l\.coachUid === user\.id/.test(body), key + ' does not pin the link to its trainer');
    assert.ok(body.includes(`l.status === '${status}'`), key + ` must find the link with status '${status}'`);
    assert.ok(!body.includes(`l.status === '${status === 'active' ? 'archived' : 'active'}'`), key + ' names the other status in its lookup');
    assert.ok(body.includes('TRAINER_WRITES.take(user.id)'), key + ' has no write limit');
  }
  // The client's data (and the trimmed document) is read for an ACTIVE link only.
  const dataAt = server.indexOf("'GET /api/trainer/clients/{id}/data'");
  const dataBody = server.slice(dataAt, server.indexOf('\n  },\n', dataAt));
  assert.match(dataBody, /l\.status === 'active'/);
  assert.ok(!/archived/.test(dataBody), 'an archived client\'s data must not open');
  // The access to a Telegram client stays active-only: an archived link reads as not there.
  const target = server.slice(server.indexOf('function telegramClientTarget'), server.indexOf('function commitState'));
  assert.match(target, /l\.status === 'active'/);
  assert.ok(!/archived/.test(target), 'an archived link must not open a client');
});

test('templates and offers (section 17): a client document is written only for a managed client, through commitState after managedClientOf; offers never write one', () => {
  const at = server.indexOf('function deliverToLink(');
  const fn = server.slice(at, server.indexOf('function linkIdsOf(', at));
  assert.ok(at > 0 && fn.length > 100);
  assert.match(fn, /managedClientOf\(user, linkId\)/);
  const calls = [...fn.matchAll(/commitState\(([^,]+),/g)];
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1].trim(), 't.client');
  assert.ok(fn.indexOf('managedClientOf(') < fn.indexOf('commitState('), 'the managed client is resolved before the write');
  // The write sits inside the managed branch; what follows it (a Telegram client) puts an offer on the link and touches no document.
  const managedBranch = fn.indexOf('if (link.managed)');
  const telegramPart = fn.slice(fn.indexOf('buildOffer('));
  assert.ok(managedBranch > 0 && managedBranch < fn.indexOf('commitState('));
  assert.ok(!/stateFile|atomicWrite|writeState|stateCache|commitState|readStateStrict/.test(telegramPart), 'a Telegram clients document is not touched');
  assert.match(telegramPart, /link\.offers = /);
  // The accept and decline routes only take an offer off the link.
  const oStart = server.indexOf("'POST /api/trainer/offers/{id}/accept'");
  const oEnd = server.indexOf("'GET /api/trainer/clients'");
  assert.ok(oStart > 0 && oEnd > oStart);
  assert.ok(!/stateFile|atomicWrite|writeState|stateCache|commitState|readStateStrict/.test(server.slice(oStart, oEnd)), 'an offer route touches a state file');
  // The routes that read a client's routines resolve a managed client first (a Telegram client's routines are never read).
  const rStart = server.indexOf("'POST /api/trainer/templates/from-client/{id}'");
  assert.ok(/managedClientOf\(user, req\.trainerId\)/.test(server.slice(rStart, rStart + 400)), 'from-client does not resolve a managed client');
  const lStart = server.indexOf("'GET /api/trainer/managed/{id}/routines'");
  assert.ok(/managedTarget\(req, res, user\)/.test(server.slice(lStart, lStart + 500)), 'the routine list does not call managedTarget');
  const cStart = server.indexOf("'POST /api/trainer/managed/{id}/routines/copy'");
  assert.ok(/managedTarget\(req, res, user\)/.test(server.slice(cStart, cStart + 500)), 'copy does not call managedTarget');
  // Nothing that is not a trainer's route writes a template file by hand.
  assert.ok(!/atomicWrite\([^)]*trainer-templates/.test(server));
});
