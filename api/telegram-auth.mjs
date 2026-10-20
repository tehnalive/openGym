/** Server-only Telegram Mini App authentication. No Node APIs or dependencies.
 * Source: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 * HMAC validation excludes only `hash`; `signature`, when present, remains signed.
 * This validates launch credentials, not consent to message the user or a replay nonce.
 */
const encoder = new TextEncoder();
export const MAX_INIT_DATA_BYTES = 16_384;
const MAX_FIELDS = 64;

const messages = Object.freeze({
  BOT_TOKEN_REQUIRED: 'A valid server bot token is required.',
  INVALID_OPTIONS: 'Invalid authentication options.',
  INVALID_INPUT: 'Invalid Telegram initialization data.',
  INPUT_TOO_LARGE: 'Telegram initialization data exceeds the size limit.',
  DUPLICATE_KEY: 'Duplicate initialization field.',
  INVALID_HASH: 'Invalid Telegram authentication hash.',
  INVALID_SIGNATURE: 'Telegram authentication failed.',
  INVALID_AUTH_DATE: 'Invalid authentication timestamp.',
  AUTH_EXPIRED: 'Telegram initialization data has expired.',
  AUTH_IN_FUTURE: 'Telegram authentication timestamp is in the future.',
  INVALID_USER: 'Invalid Telegram user.',
  CRYPTO_UNAVAILABLE: 'Authentication cryptography is unavailable.',
});

export class TelegramAuthError extends Error {
  constructor(code) {
    super(messages[code] ?? 'Telegram authentication failed.');
    this.name = 'TelegramAuthError';
    this.code = code;
  }
}

function fail(code) { throw new TelegramAuthError(code); }

function decode(component) {
  try { return decodeURIComponent(component.replace(/\+/g, ' ')); }
  catch { fail('INVALID_INPUT'); }
}

function parseFields(raw) {
  if (typeof raw !== 'string' || raw.length === 0) fail('INVALID_INPUT');
  // Check length before allocating the UTF-8 encoding of a potentially huge input.
  if (raw.length > MAX_INIT_DATA_BYTES || encoder.encode(raw).length > MAX_INIT_DATA_BYTES) {
    fail('INPUT_TOO_LARGE');
  }
  const parts = raw.split('&');
  if (parts.length > MAX_FIELDS) fail('INVALID_INPUT');
  const fields = new Map();
  for (const part of parts) {
    const separator = part.indexOf('=');
    if (separator < 1) fail('INVALID_INPUT');
    const key = decode(part.slice(0, separator));
    const value = decode(part.slice(separator + 1));
    if (!/^[A-Za-z0-9_]{1,64}$/.test(key) || /[\r\n\0]/.test(value)) fail('INVALID_INPUT');
    if (fields.has(key)) fail('DUPLICATE_KEY');
    fields.set(key, value);
  }
  return fields;
}

function readOptions(options) {
  if (options === null || typeof options !== 'object' || Array.isArray(options)) fail('INVALID_OPTIONS');
  const nowSeconds = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  const maxAgeSeconds = options.maxAgeSeconds ?? 300;
  const clockSkewSeconds = options.clockSkewSeconds ?? 30;
  for (const value of [nowSeconds, maxAgeSeconds, clockSkewSeconds]) {
    if (!Number.isSafeInteger(value) || value < 0) fail('INVALID_OPTIONS');
  }
  if (maxAgeSeconds === 0) fail('INVALID_OPTIONS');
  return { nowSeconds, maxAgeSeconds, clockSkewSeconds };
}

function sanitizeUser(raw) {
  let parsed;
  try { parsed = JSON.parse(raw); } catch { fail('INVALID_USER'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)
      || !Number.isSafeInteger(parsed.id) || parsed.id <= 0
      || typeof parsed.first_name !== 'string' || parsed.first_name.length === 0
      || parsed.first_name.length > 256) fail('INVALID_USER');
  const user = { id: parsed.id, first_name: parsed.first_name };
  for (const field of ['last_name', 'username', 'language_code']) {
    if (Object.hasOwn(parsed, field)) {
      if (typeof parsed[field] !== 'string' || parsed[field].length > 256) fail('INVALID_USER');
      user[field] = parsed[field];
    }
  }
  for (const field of ['is_bot', 'is_premium', 'allows_write_to_pm']) {
    if (Object.hasOwn(parsed, field)) {
      if (typeof parsed[field] !== 'boolean') fail('INVALID_USER');
      user[field] = parsed[field];
    }
  }
  return Object.freeze(user);
}

/**
 * @param {string} raw Exact Telegram.WebApp.initData string; never initDataUnsafe.
 * @param {string} botToken Server secret; never accept it from a request.
 * @param {{nowSeconds?:number,maxAgeSeconds?:number,clockSkewSeconds?:number}} [options]
 * @returns {Promise<{user:Readonly<object>,auth_date:number}>}
 * @throws {TelegramAuthError} Stable `code`, fixed message, no raw data or secrets.
 * Age limit is inclusive (300s default); future tolerance is inclusive (30s).
 * UI must render profile strings as text. Unknown user fields are discarded.
 */
export async function validateTelegramInitData(raw, botToken, options = {}) {
  if (typeof botToken !== 'string' || botToken.length === 0 || botToken.length > 256
      || botToken.trim() !== botToken || /[\r\n\0]/.test(botToken)) fail('BOT_TOKEN_REQUIRED');
  const { nowSeconds, maxAgeSeconds, clockSkewSeconds } = readOptions(options);
  const fields = parseFields(raw);
  const hash = fields.get('hash');
  if (typeof hash !== 'string' || !/^[a-fA-F0-9]{64}$/.test(hash)) fail('INVALID_HASH');
  const dataCheckString = [...fields.entries()]
    .filter(([key]) => key !== 'hash')
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([key, value]) => `${key}=${value}`).join('\n');
  const signature = Uint8Array.from(hash.match(/../g), pair => Number.parseInt(pair, 16));
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) fail('CRYPTO_UNAVAILABLE');
  let verified;
  try {
    const derivationKey = await subtle.importKey('raw', encoder.encode('WebAppData'),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const secret = await subtle.sign('HMAC', derivationKey, encoder.encode(botToken));
    const verificationKey = await subtle.importKey('raw', secret,
      { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    // The cryptographic provider performs signature comparison, not JS string equality.
    verified = await subtle.verify('HMAC', verificationKey, signature, encoder.encode(dataCheckString));
  } catch { fail('CRYPTO_UNAVAILABLE'); }
  if (!verified) fail('INVALID_SIGNATURE');
  const dateText = fields.get('auth_date');
  if (typeof dateText !== 'string' || !/^[1-9][0-9]*$/.test(dateText)) fail('INVALID_AUTH_DATE');
  const auth_date = Number(dateText);
  if (!Number.isSafeInteger(auth_date)) fail('INVALID_AUTH_DATE');
  if (auth_date - nowSeconds > clockSkewSeconds) fail('AUTH_IN_FUTURE');
  if (nowSeconds - auth_date > maxAgeSeconds) fail('AUTH_EXPIRED');
  const user = sanitizeUser(fields.get('user'));
  return Object.freeze({ user, auth_date });
}
