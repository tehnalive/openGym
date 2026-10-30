// Trainer mode, stage 1 (TG14): a trainer sees a client's history, measurements and stats, read only.
// Pure helpers here; the routes and the db.json storage are in server.js (`trainer*` keys).
//
// Stored in db.json:
//   user.trainer        { enabled, since, ageConfirmedAt }
//   db.trainerInvites   [{ id, hash, coachUid, label, created, expires, usedBy?, usedAt?, revokedAt? }]
//   db.trainerLinks     [{ id, coachUid, clientUid, status, grants, ageConfirmedAt, consentAt, consentVersion,
//                          createdAt, revokedAt?, revokedBy? }]
// The client's data stays in the client's own state-<uid>.json; nothing is copied to the trainer.
import crypto from 'node:crypto';

export const TRAINER_CLIENT_LIMIT = 5;
export const CONSENT_VERSION = 1;
export const INVITE_DAYS = [1, 7, 30];
export const INVITE_DEFAULT_DAYS = 7;
export const INVITE_MAX_OPEN = 20;
export const INVITE_KEEP_MS = 30 * 86400000;     // used / expired / revoked invites are forgotten after this
export const LABEL_MAX = 60;
export const GRANT_KEYS = ['history', 'measures', 'stats'];

export const CLIENT_LIMIT_MESSAGE = 'Сейчас доступно 5 подопечных, позже появится возможность добавить больше';

// `t_` + 22 base64url characters = 128 bits; Telegram allows 512 in `startapp`.
export const TOKEN_RE = /^t_[A-Za-z0-9_-]{22}$/;
export const ID_RE = /^[A-Za-z0-9_-]{8,32}$/;

export const newToken = () => 't_' + crypto.randomBytes(16).toString('base64url');
export const newId = () => crypto.randomBytes(9).toString('base64url');
export const hashToken = token => crypto.createHash('sha256').update(String(token)).digest('hex');

export function inviteLink(token, bot, shortName) {
  const base = shortName ? `https://t.me/${bot}/${shortName}` : `https://t.me/${bot}`;
  return `${base}?startapp=${token}`;
}

/** The name the other side sees: the profile name without the uniqueness suffix, never a handle. */
export function displayName(user) {
  const n = String(user?.name || '').replace(/\s·\s(\d{5,}|[0-9a-f]{8})$/, '').trim().slice(0, 40);
  return n || 'Тренер';
}

export const isTrainer = user => !!user && user.trainer?.enabled === true;

export const activeLinks = (db, coachUid) => (db.trainerLinks || []).filter(l => l.coachUid === coachUid && l.status === 'active');
export const clientLink = (db, clientUid) => (db.trainerLinks || []).find(l => l.clientUid === clientUid && l.status === 'active') || null;

export const inviteState = (inv, now = Date.now()) =>
  inv.revokedAt ? 'revoked' : inv.usedAt ? 'used' : Date.parse(inv.expires) <= now ? 'expired' : 'open';

/** Forget invites that can no longer do anything and have been dead for a while. Returns whether it changed. */
export function pruneInvites(db, now = Date.now()) {
  const before = (db.trainerInvites || []).length;
  db.trainerInvites = (db.trainerInvites || []).filter(i => {
    if (inviteState(i, now) === 'open') return true;
    const ended = Math.max(Date.parse(i.expires) || 0, Date.parse(i.usedAt) || 0, Date.parse(i.revokedAt) || 0);
    return now - ended < INVITE_KEEP_MS;
  });
  return db.trainerInvites.length !== before;
}

/** What the client chose to open. `stats` needs `history`: the muscle statistics are computed from the
 *  workouts, so opening them without the history would hand the history over anyway.
 *  Returns the clean grants, or an error code. */
export function checkGrants(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 'grants-required';
  const grants = {};
  for (const k of GRANT_KEYS) {
    if (raw[k] !== undefined && typeof raw[k] !== 'boolean') return 'grants-invalid';
    grants[k] = raw[k] === true;
  }
  if (!GRANT_KEYS.some(k => grants[k])) return 'grants-required';
  if (grants.stats && !grants.history) return 'grants-invalid';
  return grants;
}

const isRec = x => !!x && typeof x === 'object' && !Array.isArray(x);
const list = v => (Array.isArray(v) ? v.filter(isRec) : []);

/** The part of a client's document a trainer may get, by grant. A whitelist: anything not named here
 *  (photos, the AI coach, settings, push, check-in cards, notes about days) never leaves the server. */
export function trimForTrainer(S, grants) {
  const doc = isRec(S) ? S : {};
  const out = { unit: doc.unit === 'lb' ? 'lb' : 'kg', weekStart: doc.weekStart === 0 ? 0 : 1 };
  if (grants.history || grants.stats) {
    // Photos and videos attached to a workout are the client's alone.
    out.workouts = list(doc.workouts).map(({ media, ...w }) => (Array.isArray(w.entries)
      ? { ...w, entries: list(w.entries).map(({ media: m, ...e }) => e) } : w));
    out.customEx = list(doc.customEx).map(({ media, photo, video, ...e }) => e);
  }
  if (grants.measures) {
    out.bodyweight = list(doc.bodyweight);
    out.measurements = list(doc.measurements);
    out.customMeasurements = list(doc.customMeasurements);
    out.measurementEnabled = doc.measurementEnabled ?? null;
  }
  return out;
}

/** One line of the client list: when they last trained and how much, from the documents' own dates. */
export function summaryOf(S, grants) {
  const workouts = grants.history || grants.stats ? list(S?.workouts) : null;
  if (!workouts) return {};
  const last = workouts.reduce((m, w) => (typeof w.d === 'string' && w.d > m ? w.d : m), '');
  return { workouts: workouts.length, lastWorkout: last || null };
}
