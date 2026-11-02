// Trainer mode (TG14): how well a client keeps to the plan, over the last 7, 30 and 90 days. Pure: the routes hand in
// the client's workouts, the link and the trainer's date. The formula and the decisions behind it are written up in
// docs/telegram/TRAINER_MODE.md, section 15.
//
//   window      N days ending yesterday; today is in only when a workout is already logged today. The window does not
//               start before the link did, and a day of pause or archive is not counted either way.
//   planned     the days of the window whose ISO weekday is in the schedule, minus the paused days
//   done        planned days with a workout, plus the workouts of other (unplanned, not paused) days as moved sessions,
//               never more than planned. A day is a day: two workouts on it are one.
//   pct         round(done / planned * 100), or null when nothing was planned (shown as "no plan", never as 0 %)
import { addDays, isPaused, pausedOn } from './trainer.js';

export const WINDOWS = [7, 30, 90];
export const QUIET_DAYS = 7;          // no workout for this long: 'quiet'
export const DROP_POINTS = 20;        // the week this far below the month: 'drop'
export const DROP_MIN_PLANNED = 4;    // ... but only when the month had at least this many planned days to be measured by

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const noon = iso => Date.parse(iso + 'T12:00:00Z');
const isoWeekday = iso => { const d = new Date(noon(iso)).getUTCDay(); return d === 0 ? 7 : d; };
/** Whole days from a to b ('YYYY-MM-DD'), negative when b is earlier. */
export const daysBetween = (a, b) => Math.round((noon(b) - noon(a)) / 86400000);

/** The calendar date ('YYYY-MM-DD') of an instant in a time zone; UTC when the zone is missing or unknown. */
export function dateIn(instant, tz) {
  const t = Date.parse(instant);
  if (Number.isNaN(t)) return null;
  if (tz) {
    try {
      const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(t));
      const g = k => parts.find(p => p.type === k)?.value;
      if (g('year') && g('month') && g('day')) return `${g('year')}-${g('month')}-${g('day')}`;
    } catch { /* an unknown zone: UTC, as the trainer's today is */ }
  }
  return new Date(t).toISOString().slice(0, 10);
}

const emptyWindow = () => ({ planned: 0, done: 0, pct: null, workouts: 0, from: null, to: null });

/** @param {{ workouts: any[], schedule?: { days?: number[] } | null, link?: any, today: string, tz?: string }} a
 *  `today` is the trainer's date, the workouts' `d` are the client's own local dates; both are compared as strings.
 *  `tz` is the trainer's zone, to tell on which day the link began. */
export function complianceOf({ workouts, schedule, link, today, tz } = {}) {
  const out = { d7: emptyWindow(), d30: emptyWindow(), d90: emptyWindow(), hasSchedule: false, lastWorkout: null, daysSinceLast: null, attention: null };
  if (typeof today !== 'string' || !ISO_DATE.test(today)) return out;
  // The training days: one per date, a date in the future (a clock that ran ahead) is not a day that happened.
  const trained = new Set();
  for (const w of Array.isArray(workouts) ? workouts : []) {
    if (w && typeof w.d === 'string' && ISO_DATE.test(w.d) && w.d <= today) trained.add(w.d);
  }
  let last = '';
  for (const d of trained) if (d > last) last = d;
  if (last) { out.lastWorkout = last; out.daysSinceLast = daysBetween(last, today); }

  const plan = new Set(Array.isArray(schedule && schedule.days) ? schedule.days.filter(d => Number.isInteger(d) && d >= 1 && d <= 7) : []);
  out.hasSchedule = plan.size > 0;
  const start = link && link.createdAt ? dateIn(link.createdAt, tz) : null;
  const end = trained.has(today) ? today : addDays(today, -1);

  for (const n of WINDOWS) {
    let from = addDays(end, -(n - 1));
    if (start && from < start) from = start;
    if (from > end) continue;
    let planned = 0, hit = 0, moved = 0, workoutsIn = 0;
    for (let d = from; d <= end; d = addDays(d, 1)) {
      const paused = pausedOn(link, d);
      const did = trained.has(d);
      if (did) workoutsIn++;
      if (plan.has(isoWeekday(d)) && !paused) { planned++; if (did) hit++; }
      else if (did && !paused) moved++;
    }
    const done = Math.min(planned, hit + moved);
    out['d' + n] = { planned, done, pct: planned > 0 ? Math.round(done * 100 / planned) : null, workouts: workoutsIn, from, to: end };
  }

  out.attention = attentionOf(out, link, today, start, last);
  return out;
}

// 'quiet': nothing for QUIET_DAYS, counted from the latest of the last workout, the start of the link and the day the
// client came back from a pause or the archive (so a returning client is not flagged on the first morning).
// 'drop': the week is DROP_POINTS or more below the month. A client on pause has neither.
function attentionOf(c, link, today, start, last) {
  if (!link || isPaused(link, today) || pausedOn(link, today)) return null;
  let back = '';
  for (const p of Array.isArray(link.pauses) ? link.pauses : []) {
    if (p && typeof p.to === 'string' && p.to < today && addDays(p.to, 1) > back) back = addDays(p.to, 1);
  }
  const anchor = [last, start || '', back].reduce((m, d) => (d > m ? d : m), '');
  if (anchor && daysBetween(anchor, today) >= QUIET_DAYS) return 'quiet';
  if (c.d7.pct !== null && c.d30.pct !== null && c.d30.planned >= DROP_MIN_PLANNED && c.d30.pct - c.d7.pct >= DROP_POINTS) return 'drop';
  return null;
}
