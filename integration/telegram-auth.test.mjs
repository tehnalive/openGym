import test from 'node:test';
import assert from 'node:assert/strict';
// Independent Node HMAC implementation verifies Web Crypto interoperability.
import { createHmac } from 'node:crypto';
import { validateTelegramInitData, TelegramAuthError, MAX_INIT_DATA_BYTES } from './telegram-auth.mjs';

const token = '123456789:synthetic-test-token';
const now = 1_790_000_000;
const person = { id: 4_500_000_001, first_name: 'Аня + & =', username: 'anna', is_premium: true };
function signed(overrides = {}, secretToken = token) {
  const fields = new Map(Object.entries({
    user: JSON.stringify(person), auth_date: String(now), query_id: 'query+with/special=chars',
    ...overrides,
  }));
  const check = [...fields].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, value]) => `${key}=${value}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(secretToken).digest();
  fields.set('hash', createHmac('sha256', secret).update(check).digest('hex'));
  return new URLSearchParams([...fields].reverse()).toString();
}
const validate = (raw, options = {}) => validateTelegramInitData(raw, token, { nowSeconds: now, ...options });
const code = expected => error => error instanceof TelegramAuthError && error.code === expected;

test('valid signed launch: Unicode, reserved characters, large ID, sanitized immutable output', async () => {
  const result = await validate(signed({ user: JSON.stringify({ ...person, role: 'admin', photo_url: 'ignored', __extra: 1 }) }));
  assert.deepEqual(result, { user: person, auth_date: now });
  assert.ok(Object.isFrozen(result) && Object.isFrozen(result.user));
});

test('hash covers every field except hash, including optional signature', async () => {
  const raw = signed({ signature: 'future-ed25519-signature', start_param: 'gym' });
  await validate(raw);
  await assert.rejects(validate(raw.replace('future-ed25519-signature', 'tampered')), code('INVALID_SIGNATURE'));
});

test('tampered user, wrong bot, modified field are rejected without leaking values', async () => {
  const raw = signed();
  await assert.rejects(validateTelegramInitData(raw, 'different-token', { nowSeconds: now }), code('INVALID_SIGNATURE'));
  await assert.rejects(validate(raw.replace('anna', 'intruder')), code('INVALID_SIGNATURE'));
  await assert.rejects(validate(raw.replace('query%2B', 'changed%2B')), error => {
    assert.ok(code('INVALID_SIGNATURE')(error));
    assert.ok(!error.message.includes(token) && !error.message.includes('changed'));
    return true;
  });
});

test('expired and future launch with inclusive default boundaries', async () => {
  await validate(signed({ auth_date: String(now - 300) }));
  await assert.rejects(validate(signed({ auth_date: String(now - 301) })), code('AUTH_EXPIRED'));
  await validate(signed({ auth_date: String(now + 30) }));
  await assert.rejects(validate(signed({ auth_date: String(now + 31) })), code('AUTH_IN_FUTURE'));
  await assert.rejects(validate(signed({ auth_date: String(now + 1) }), { clockSkewSeconds: 0 }), code('AUTH_IN_FUTURE'));
  await assert.rejects(validate(signed({ auth_date: String(now - 11) }), { maxAgeSeconds: 10 }), code('AUTH_EXPIRED'));
});

test('duplicate keys are rejected after decoding, including hash and unknown fields', async () => {
  for (const suffix of ['&user=other', '&%75ser=other', '&hash=' + '0'.repeat(64), '&x=1&x=2']) {
    await assert.rejects(validate(signed() + suffix), code('DUPLICATE_KEY'));
  }
});

test('size limits apply before parsing and to UTF-8 byte length', async () => {
  await assert.rejects(validate('x'.repeat(MAX_INIT_DATA_BYTES + 1)), code('INPUT_TOO_LARGE'));
  await assert.rejects(validate('x=' + 'я'.repeat(9_000)), code('INPUT_TOO_LARGE'));
  await assert.rejects(validate(signed() + '&' + Array.from({ length: 65 }, (_, i) => `x${i}=1`).join('&')), code('INVALID_INPUT'));
});

test('strict hash encoding and invalid query encoding', async () => {
  for (const hash of ['', 'a'.repeat(63), 'g'.repeat(64), 'a'.repeat(65), '-'.repeat(64)]) {
    const params = new URLSearchParams(signed()); params.set('hash', hash);
    await assert.rejects(validate(params.toString()), code('INVALID_HASH'));
  }
  const uppercase = new URLSearchParams(signed()); uppercase.set('hash', uppercase.get('hash').toUpperCase());
  await validate(uppercase.toString());
  for (const value of ['', null, {}, 'x=%XX', 'x=%E0%A4%A', 'x=1&', '=x', 'a%0Ab=1']) {
    await assert.rejects(validate(value), code('INVALID_INPUT'));
  }
});

test('signed invalid users and dates cannot authenticate', async () => {
  for (const user of [null, [], {}, { ...person, id: 0 }, { ...person, id: -1 },
    { ...person, id: '123' }, { ...person, id: 1.5 }, { ...person, id: Number.MAX_SAFE_INTEGER + 1 },
    { ...person, first_name: '' }, { ...person, username: {} }, { ...person, is_premium: 'true' }]) {
    await assert.rejects(validate(signed({ user: JSON.stringify(user) })), code('INVALID_USER'));
  }
  await assert.rejects(validate(signed({ user: '{broken' })), code('INVALID_USER'));
  for (const auth_date of ['', '0', '-1', '1e9', ' 1790000000', '1790000000.0', '9007199254740992']) {
    await assert.rejects(validate(signed({ auth_date })), code('INVALID_AUTH_DATE'));
  }
});

test('two identities remain distinct; a second user cannot replace the signed user', async () => {
  const second = { id: 4_500_000_002, first_name: 'Борис' };
  const [one, two] = await Promise.all([validate(signed()), validate(signed({ user: JSON.stringify(second) }))]);
  assert.equal(one.user.id, person.id);
  assert.equal(two.user.id, second.id);
  const forged = new URLSearchParams(signed()); forged.set('user', JSON.stringify(second));
  await assert.rejects(validate(forged.toString()), code('INVALID_SIGNATURE'));
});

test('token required and unsafe launch objects are never accepted', async () => {
  for (const value of [undefined, null, '', '  ', 123, '\nsecret']) {
    await assert.rejects(validateTelegramInitData(signed(), value), code('BOT_TOKEN_REQUIRED'));
  }
  await assert.rejects(validate({ user: person, auth_date: now }), code('INVALID_INPUT'));
  for (const options of [{ nowSeconds: NaN }, { maxAgeSeconds: Infinity }, { clockSkewSeconds: -1 }, { maxAgeSeconds: 0 }]) {
    await assert.rejects(validate(signed(), options), code('INVALID_OPTIONS'));
  }
  await assert.rejects(validateTelegramInitData(signed(), token, null), code('INVALID_OPTIONS'));
});
