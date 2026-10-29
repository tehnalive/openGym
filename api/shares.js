// Shared training plans (TG19): the sender's plan bundle is kept on the server and the link carries
// only a short random id (Telegram's startapp parameter is 512 characters at most, and a plan is
// far longer). Pure helpers here, the routes are in server.js. The bundle format is
// frontend/src/lib/plan-share.js; the API image cannot import it, so only the shape is checked
// here, and the recipient's app runs the real parsePlan on whatever it gets.
import crypto from 'node:crypto';

export const SHARE_ID_RE = /^[A-Za-z0-9_-]{8,32}$/;
export const SHARE_MAX_BYTES = 200 * 1024;
export const SHARE_MAX_ROUTINES = 50;
export const SHARE_MAX_EXERCISES = 600;
export const SHARE_MAX_CUSTOM = 200;
const BUNDLE_KEYS = ['opengym_plan', 'exported', 'name', 'unit', 'week', 'routines', 'customEx'];

export const newShareId = () => crypto.randomBytes(9).toString('base64url');   // 12 characters

/** The shape check. Returns the trimmed bundle (known top-level keys only) or an error string. */
export function checkBundle(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 'not a plan';
  if (raw.opengym_plan !== 1) return 'not a plan';
  if (!Array.isArray(raw.routines) || !raw.routines.length) return 'the plan has no routines';
  if (raw.routines.length > SHARE_MAX_ROUTINES) return 'too many routines';
  let exercises = 0;
  for (const r of raw.routines) {
    if (!r || typeof r !== 'object' || Array.isArray(r) || !Array.isArray(r.ex)) return 'not a plan';
    exercises += r.ex.length;
    for (const e of r.ex) if (!e || typeof e !== 'object' || Array.isArray(e) || typeof e.id !== 'string') return 'not a plan';
  }
  if (!exercises) return 'the plan has no exercises';
  if (exercises > SHARE_MAX_EXERCISES) return 'too many exercises';
  if (raw.customEx !== undefined && (!Array.isArray(raw.customEx) || raw.customEx.length > SHARE_MAX_CUSTOM)) return 'not a plan';
  if (raw.week !== undefined && (!raw.week || typeof raw.week !== 'object' || Array.isArray(raw.week))) return 'not a plan';
  const out = {};
  for (const k of BUNDLE_KEYS) if (raw[k] !== undefined) out[k] = raw[k];
  if (JSON.stringify(out).length > SHARE_MAX_BYTES) return 'plan too large';
  return out;
}

/** The name a recipient sees. A profile name that had to be made unique carries the Telegram id
 *  after a middle dot (see POST /api/telegram/login); that suffix is never shown. */
export function authorName(user) {
  const n = String(user?.name || '').replace(/\s·\s\d{5,}$/, '').trim().slice(0, 40);
  return n || 'openGym';
}

export function shareLink(id, bot, shortName) {
  const base = shortName ? `https://t.me/${bot}/${shortName}` : `https://t.me/${bot}`;
  return `${base}?startapp=p_${id}`;
}

export const shareExpired = (share, now = Date.now()) => !!share.expires && Date.parse(share.expires) <= now;
