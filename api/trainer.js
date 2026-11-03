// Trainer mode, stage 1 (TG14): a trainer sees a client's history, measurements and stats, read only.
// Pure helpers here; the routes and the db.json storage are in server.js (`trainer*` keys).
//
// Stored in db.json:
//   user.trainer        { enabled, since, ageConfirmedAt }
//   db.trainerInvites   [{ id, hash, coachUid, label, created, expires, usedBy?, usedAt?, revokedAt? }]
//   db.trainerLinks     [{ id, coachUid, clientUid, status, grants, ageConfirmedAt, consentAt, consentVersion,
//                          createdAt, revokedAt?, revokedBy?, archivedAt?, pause?, pauses? }]   (pause and archive: below)
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
// Only an active link gives a trainer access and takes a place; an archived one (below) does neither.
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

// ---- the trainer's week: which days a client comes, and the reminder for it ----
// Kept on the link (`link.schedule = { days, time, remind }`, days as ISO weekdays 1 = Monday .. 7 = Sunday, time
// 'HH:MM' or ''), so it ends with the link. The trainer's own time zone is `user.trainer.tz`, sent by the app.
export const REMIND_LEAD_MIN = 60;          // a reminder goes this long before the booked time
export const REMIND_DEFAULT_AT = '08:00';   // and at this time on a day with no booked time
export const REMIND_LATE_MIN = 30;          // a booked time that has passed by more than this is not reminded

/** The body of "set the schedule", or an error code with its text. */
export function checkSchedule(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'bad-request', text: 'Не указано расписание' };
  if (!Array.isArray(body.days) || body.days.length > 7 || !body.days.every(d => Number.isInteger(d) && d >= 1 && d <= 7)) {
    return { error: 'days-invalid', text: 'Дни недели указаны неверно' };
  }
  const time = body.time == null ? '' : body.time;
  if (typeof time !== 'string' || (time !== '' && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time))) return { error: 'time-invalid', text: 'Время указано неверно' };
  if (body.remind !== undefined && typeof body.remind !== 'boolean') return { error: 'bad-request', text: 'Напоминание включается или выключается' };
  const days = [...new Set(body.days)].sort((a, b) => a - b);
  return { schedule: { days, time, remind: body.remind === true && days.length > 0 } };
}

const minutes = hhmm => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** What the reminder tick does for one link right now. `now` = { date, hhmm, weekday } in the trainer's zone
 *  (weekday 0 = Sunday .. 6, as userNow gives it). 'send': tell the trainer; 'skip': mark the day done without a
 *  message (the moment has passed); null: not yet, not today, or already done. */
export function reminderDecision(link, now) {
  const s = link && link.schedule;
  if (!s || !s.remind || !Array.isArray(s.days) || !s.days.length || link.status !== 'active') return null;
  if (isPaused(link, now.date)) return null;   // on pause: no reminder, and nothing to mark as done
  const iso = now.weekday === 0 ? 7 : now.weekday;
  if (!s.days.includes(iso) || link.lastRemindDate === now.date) return null;
  const at = s.time ? Math.max(0, minutes(s.time) - REMIND_LEAD_MIN) : minutes(REMIND_DEFAULT_AT);
  const nowMin = minutes(now.hhmm);
  if (nowMin < at) return null;
  if (s.time && nowMin > minutes(s.time) + REMIND_LATE_MIN) return 'skip';
  return 'send';
}

/** The words of the reminder. */
export const reminderText = (name, time) => time ? `Сегодня к вам придёт ${name} в ${time}.` : `Сегодня у вас занятие: ${name}.`;

// ---- pause and archive of a client (TG14) ----
// A pause keeps the place and the access; the trainer is only not reminded, and the plan is not held against the
// client. An archive frees the place and closes the trainer's access until the link is restored.
// On the link:
//   status   'active' | 'archived' | 'revoked'     archivedAt (ISO) while archived
//   pause    { since: ISO, until: 'YYYY-MM-DD' | null, reason? }   only while a pause is set; `until` is the last
//            paused day, and a date in the past means the pause is over (read lazily, no timer: isPaused)
//   pauses   [{ from, to, archived? }]    the history, days inclusive, `to` null = still open. The archived time
//            is recorded here too (`archived: true`), so "was the client expected on this day" is one question:
//            pausedOn. At most PAUSES_KEEP, the oldest dropped.
/** Whether the client's consent is of the current text (CONSENT_VERSION). A client without Telegram gave none: always. */
export const consentCurrent = link => !!link && (link.managed === true || (Number(link.consentVersion) || 0) >= CONSENT_VERSION);

/** The words the bot sends a client when the trainer archives or brings them back. */
export const lifecycleNotice = (kind, coachName) => kind === 'archive'
  ? `Тренер ${coachName} перенёс вас в архив: он не видит ваш дневник.`
  : `Тренер ${coachName} снова видит ваш дневник по прежнему согласию. Закрыть доступ можно в Настройки → Мой тренер.`;

export const PAUSES_KEEP = 50;
export const PAUSE_MAX_DAYS = 365;
export const PAUSE_REASON_MAX = 80;
export const ARCHIVE_LIMIT = 50;           // archived clients a trainer may keep (their diaries stay on the server)

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
// A real calendar day. Date.parse says NaN for 2026-13-45 or 0000-00-00 (toISOString would throw a RangeError on them).
const validDay = d => {
  if (typeof d !== 'string' || !ISO_DATE.test(d)) return false;
  const at = Date.parse(d + 'T12:00:00Z');
  return Number.isFinite(at) && new Date(at).toISOString().slice(0, 10) === d;
};
export const addDays = (iso, n) => new Date(Date.parse(iso + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);

export const archivedLinks = (db, coachUid) => (db.trainerLinks || []).filter(l => l.coachUid === coachUid && l.status === 'archived');
/** The client's current link: active or archived (an archived one still stands until the client ends it). */
export const currentLink = (db, clientUid) => (db.trainerLinks || []).find(l => l.clientUid === clientUid && (l.status === 'active' || l.status === 'archived')) || null;

/** Whether the pause set on the link still holds on `today` ('YYYY-MM-DD'). A pause with `until` before today is over. */
export function isPaused(link, today) {
  const p = link && link.status === 'active' ? link.pause : null;
  return !!p && (p.until == null || p.until >= today);
}

/** The pause to show: the set one while it holds, else null. */
export const pauseOf = (link, today) => (isPaused(link, today) ? { since: link.pause.since, until: link.pause.until ?? null, ...(link.pause.reason ? { reason: link.pause.reason } : {}) } : null);

/** Whether the client was on pause (or archived) on the day `iso`, by the history. A day before `from` or after `to`
 *  is not; `to` null is open. */
export function pausedOn(link, iso) {
  return (Array.isArray(link && link.pauses) ? link.pauses : []).some(p => p && p.from <= iso && (p.to == null || iso <= p.to));
}

export const PAUSED_DAYS_MAX = 400;   // the longest range pausedDays walks; a longer one counts its last PAUSED_DAYS_MAX days

/** How many days of the range [from, to] (inclusive, 'YYYY-MM-DD') the client was on pause or archived. A range longer
 *  than PAUSED_DAYS_MAX days counts only its last PAUSED_DAYS_MAX (the walk is day by day). */
export function pausedDays(link, from, to) {
  if (!validDay(from) || !validDay(to) || to < from) return 0;
  if (Date.parse(to + 'T12:00:00Z') - Date.parse(from + 'T12:00:00Z') >= PAUSED_DAYS_MAX * 86400000) from = addDays(to, -(PAUSED_DAYS_MAX - 1));
  let n = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) if (pausedOn(link, d)) n++;
  return n;
}

/** The body of "pause", or an error code with its text. `today` is the trainer's date. */
export function checkPause(body, today) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || body.until === undefined) return { error: 'bad-request', text: 'Не указан срок паузы' };
  let until = null;
  if (body.until !== null) {
    if (!validDay(body.until)) return { error: 'until-invalid', text: 'Дата окончания паузы указана неверно' };
    if (body.until < today) return { error: 'until-past', text: 'Пауза не может закончиться раньше сегодняшнего дня' };
    if (body.until > addDays(today, PAUSE_MAX_DAYS)) return { error: 'until-far', text: 'Пауза не может быть дольше года' };
    until = body.until;
  }
  let reason = '';
  if (body.reason !== undefined && body.reason !== null) {
    if (typeof body.reason !== 'string') return { error: 'bad-request', text: 'Причина должна быть текстом' };
    reason = body.reason.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, PAUSE_REASON_MAX);
  }
  return { until, reason };
}

const trimPauses = link => { if (link.pauses.length > PAUSES_KEEP) link.pauses = link.pauses.slice(-PAUSES_KEEP); };

/** Set (or change) the pause on an active link. Mutates the link. */
export function startPause(link, { until, reason }, today, nowIso) {
  link.pauses = Array.isArray(link.pauses) ? link.pauses : [];
  const live = isPaused(link, today);
  if (live) {
    // Change of an ongoing pause: its period in the history follows.
    const last = link.pauses[link.pauses.length - 1];
    if (last && !last.archived) last.to = until;
    link.pause = { since: link.pause.since, until, ...(reason ? { reason } : {}) };
  } else {
    link.pauses.push({ from: today, to: until });
    link.pause = { since: nowIso, until, ...(reason ? { reason } : {}) };
  }
  trimPauses(link);
}

/** Take the pause off from `today` on: the client is expected today again. Mutates the link. */
export function endPause(link, today) {
  if (link.pause && isPaused(link, today)) {
    const yesterday = addDays(today, -1);
    const last = (link.pauses || [])[link.pauses.length - 1];
    if (last && !last.archived) {
      if (last.from > yesterday) link.pauses.pop(); else last.to = yesterday;
    }
  }
  delete link.pause;
}

/** Archive an active link: the pause is lifted, the archived time starts in the history, open offers of the trainer (templates, TRAINER_MODE.md section 17) are withdrawn. Mutates the link. */
export function archiveLink(link, today, nowIso) {
  endPause(link, today);
  link.pauses = Array.isArray(link.pauses) ? link.pauses : [];
  link.pauses.push({ from: today, to: null, archived: true });
  trimPauses(link);
  link.status = 'archived';
  link.archivedAt = nowIso;
  delete link.offers;
}

/** Bring an archived link back: from `today` on the client is expected again. Mutates the link. */
export function restoreLink(link, today) {
  const yesterday = addDays(today, -1);
  const at = (link.pauses || []).map(p => p.archived && p.to == null).lastIndexOf(true);
  if (at >= 0) {
    if (link.pauses[at].from > yesterday) link.pauses.splice(at, 1); else link.pauses[at].to = yesterday;
  }
  link.status = 'active';
  delete link.archivedAt;
}
