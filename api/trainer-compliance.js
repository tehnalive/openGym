// Trainer mode (TG14): how well a client keeps to the plan, over the last 7, 30 and 90 days. Pure: the routes hand in
// the client's workouts, the link and the trainer's date. The formula and the decisions behind it are written up in
// docs/telegram/TRAINER_MODE.md, section 15.
//
//   window      N days ending yesterday; today is in only when a workout is already logged today. The window does not
//               start before the link did, and a day of pause or archive is not counted either way.
//   planned     the days of the window whose ISO weekday is in the schedule, minus the paused days
//   done        planned days with a workout, plus moved sessions: a workout on an unplanned (not paused) day covers a
//               missed planned day of the SAME ISO week (Monday to Sunday), as many as there are of each, so extra
//               days of one week never make up for another week. A day is a day: two workouts on it are one.
//   start       the link's first day counts as planned only if there was a workout on it, else the window begins the
//               next day; for a client without Telegram, whose diary the trainer fills in later, the window begins
//               at the earlier of the link and the first workout.
//   pct         round(done / planned * 100), or null when nothing was planned (shown as "no plan", never as 0 %)
import { addDays, isPaused, pausedOn, validDay } from './trainer.js';

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
  // The training days: one per real calendar date (2026-10-99 is not one). For the percentages only up to today; for "the
  // last workout" up to tomorrow too, as the client's zone may be ahead of the trainer's. Never a negative age.
  if (!validDay(today)) return out;
  const tomorrow = addDays(today, 1);
  const trained = new Set();
  let last = '', first = '';
  for (const w of Array.isArray(workouts) ? workouts : []) {
    if (!w || !validDay(w.d) || w.d > tomorrow) continue;
    if (w.d > last) last = w.d;
    if (w.d <= today) { trained.add(w.d); if (!first || w.d < first) first = w.d; }
  }
  if (last) { out.lastWorkout = last; out.daysSinceLast = Math.max(0, daysBetween(last, today)); }

  const plan = new Set(Array.isArray(schedule && schedule.days) ? schedule.days.filter(d => Number.isInteger(d) && d >= 1 && d <= 7) : []);
  out.hasSchedule = plan.size > 0;
  const start = link && link.createdAt ? dateIn(link.createdAt, tz) : null;   // the link's first day
  // Where the windows may begin: after the first day unless it has a workout; a diary kept by the trainer from the first workout.
  let begin = start && !trained.has(start) ? addDays(start, 1) : start;
  if (link && link.managed === true && first && (!start || first < start)) begin = first;
  const end = trained.has(today) ? today : addDays(today, -1);

  for (const n of WINDOWS) {
    let from = addDays(end, -(n - 1));
    if (begin && from < begin) from = begin;
    if (from > end) continue;
    let planned = 0, done = 0, workoutsIn = 0;
    let missed = 0, moved = 0;   // of the ISO week being walked
    const closeWeek = () => { done += Math.min(missed, moved); missed = 0; moved = 0; };
    for (let d = from; d <= end; d = addDays(d, 1)) {
      if (isoWeekday(d) === 1) closeWeek();
      const paused = pausedOn(link, d);
      const did = trained.has(d);
      if (did) workoutsIn++;
      if (plan.has(isoWeekday(d)) && !paused) { planned++; if (did) done++; else missed++; }
      else if (did && !paused) moved++;
    }
    closeWeek();
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
