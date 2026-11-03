// Trainer mode (TG14): the plan compliance over 7, 30 and 90 days (api/trainer-compliance.js). The formula is pure, so
// it is tested directly; the routes that carry it are in trainer-compliance-routes.test.js.
// The calendar used below: 2026-11-04 is a Wednesday (ISO 3). A window of 7 days that ends yesterday (Tuesday 11-03)
// runs from Wednesday 10-28; it holds each weekday once.
import test from 'node:test';
import assert from 'node:assert/strict';
import { complianceOf, dateIn, daysBetween, QUIET_DAYS } from '../trainer-compliance.js';
import { addDays } from '../trainer.js';

const TODAY = '2026-11-04';
const MWF = { days: [1, 3, 5] };
const old = { createdAt: '2026-01-01T10:00:00.000Z' };   // a link that began long ago
const w = (...ds) => ds.map(d => ({ d }));
const at = (offset) => addDays(TODAY, offset);

test('the window ends yesterday: a week of Mon, Wed, Fri has three planned days, and a missed one shows', () => {
  // planned: Wed 10-28, Fri 10-30, Mon 11-02. Done: Wed and Mon.
  const c = complianceOf({ workouts: w('2026-10-28', '2026-11-02'), schedule: MWF, link: old, today: TODAY });
  assert.deepEqual({ ...c.d7 }, { planned: 3, done: 2, pct: 67, workouts: 2, from: '2026-10-28', to: '2026-11-03' });
  assert.equal(c.hasSchedule, true);
});

test('the window borders: the first and the last day count, the day before the first and today do not', () => {
  // Wednesday 10-28 is the first day of the 7-day window; Tuesday 10-27 is outside it.
  const edge = complianceOf({ workouts: w('2026-10-28'), schedule: { days: [3] }, link: old, today: TODAY });
  assert.deepEqual([edge.d7.planned, edge.d7.done], [1, 1]);
  const outside = complianceOf({ workouts: w('2026-10-27'), schedule: { days: [2] }, link: old, today: TODAY });
  assert.deepEqual([outside.d7.planned, outside.d7.done, outside.d7.workouts], [1, 0, 0], '10-27 is the 8th day back, Tuesday 11-03 is the one in the window');
  // The 30-day window runs 10-05 .. 11-03: Monday 10-05 is in, Sunday 10-04 is not.
  const m = complianceOf({ workouts: w('2026-10-05'), schedule: { days: [1] }, link: old, today: TODAY });
  assert.deepEqual([m.d30.from, m.d30.to, m.d30.planned, m.d30.done], ['2026-10-05', '2026-11-03', 5, 1]);
  const o = complianceOf({ workouts: w('2026-10-04'), schedule: { days: [7] }, link: old, today: TODAY });
  assert.equal(o.d30.workouts, 0);
  assert.equal(o.d90.workouts, 1, 'the same day is inside 90 days');
});

test('today is not held against the client: a planned day without a workout yet is not planned', () => {
  // Today is Wednesday and planned, nothing logged yet.
  const c = complianceOf({ workouts: [], schedule: { days: [3] }, link: old, today: TODAY });
  assert.equal(c.d7.to, '2026-11-03');
  assert.deepEqual([c.d7.planned, c.d7.done], [1, 0], 'only last Wednesday (10-28), not today');
});

test('a workout today counts: a planned day is done, an unplanned one is a moved session', () => {
  const planned = complianceOf({ workouts: w(TODAY), schedule: { days: [3] }, link: old, today: TODAY });
  assert.equal(planned.d7.to, TODAY);
  assert.deepEqual([planned.d7.from, planned.d7.planned, planned.d7.done, planned.d7.pct], ['2026-10-29', 1, 1, 100], 'the window is still 7 days: it ends today and starts a day later');
  // Monday 11-02 was planned and missed; Wednesday's workout is not planned, so it stands in for it.
  const moved = complianceOf({ workouts: w(TODAY), schedule: { days: [1] }, link: old, today: TODAY });
  assert.deepEqual([moved.d7.planned, moved.d7.done, moved.d7.pct], [1, 1, 100]);
});

test('a workout on an unplanned day stands in for a missed one, but never lifts the total above the plan', () => {
  // Planned Mon/Wed/Fri; trained Tue 11-03 only: one moved session.
  const one = complianceOf({ workouts: w('2026-11-03'), schedule: MWF, link: old, today: TODAY });
  assert.deepEqual([one.d7.planned, one.d7.done, one.d7.pct], [3, 1, 33]);
  // Everything planned is done and there are extra days: still 100 %, not more.
  const all = complianceOf({ workouts: w('2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03'), schedule: MWF, link: old, today: TODAY });
  assert.deepEqual([all.d7.planned, all.d7.done, all.d7.pct, all.d7.workouts], [3, 3, 100, 7]);
});

test('two workouts on one day are one day', () => {
  const c = complianceOf({ workouts: [{ d: '2026-11-02' }, { d: '2026-11-02' }, { d: '2026-11-02', id: 'x' }], schedule: MWF, link: old, today: TODAY });
  assert.deepEqual([c.d7.done, c.d7.workouts], [1, 1]);
});

test('no plan: the percentage is null, never 0, and the training days are still counted', () => {
  for (const schedule of [null, undefined, {}, { days: [] }]) {
    const c = complianceOf({ workouts: w('2026-10-30', '2026-11-02', '2026-10-10'), schedule, link: old, today: TODAY });
    assert.equal(c.d7.pct, null); assert.equal(c.d30.pct, null);
    assert.deepEqual([c.d7.planned, c.d7.workouts, c.d30.workouts, c.d90.workouts], [0, 2, 3, 3]);
    assert.equal(c.hasSchedule, false);
    assert.equal(c.attention, null, 'no plan, so no drop; the last workout was two days ago, so not quiet');
  }
});

test('a plan and a bad record: planned days with nothing logged are 0 %, not null', () => {
  const c = complianceOf({ workouts: [], schedule: MWF, link: old, today: TODAY });
  assert.deepEqual([c.d7.planned, c.d7.done, c.d7.pct], [3, 0, 0]);
});

test('the window does not start before the link: a new client does not begin at 0 %', () => {
  // The link began on Monday 11-02 (trainer in UTC): the window is 11-02 .. 11-03; planned: Monday only.
  const fresh = { createdAt: '2026-11-02T09:00:00.000Z' };
  const c = complianceOf({ workouts: w('2026-11-02'), schedule: MWF, link: fresh, today: TODAY });
  assert.deepEqual({ ...c.d7 }, { planned: 1, done: 1, pct: 100, workouts: 1, from: '2026-11-02', to: '2026-11-03' });
  assert.equal(c.d90.from, '2026-11-02');
  // Created today: nothing to measure yet, null and not 0.
  const today = complianceOf({ workouts: [], schedule: MWF, link: { createdAt: '2026-11-04T01:00:00.000Z' }, today: TODAY });
  assert.deepEqual([today.d7.planned, today.d7.pct, today.d7.from], [0, null, null]);
  // ... but a workout today counts from the start.
  const first = complianceOf({ workouts: w(TODAY), schedule: MWF, link: { createdAt: '2026-11-04T01:00:00.000Z' }, today: TODAY });
  assert.deepEqual([first.d7.planned, first.d7.done, first.d7.pct, first.d7.from], [1, 1, 100, TODAY]);
  // A workout before the link began is not in the window.
  const before = complianceOf({ workouts: w('2026-10-30'), schedule: MWF, link: fresh, today: TODAY });
  assert.equal(before.d7.workouts, 0);
});

test('the day the link began is the trainer\'s day, not UTC', () => {
  assert.equal(dateIn('2026-11-02T23:30:00.000Z', 'UTC'), '2026-11-02');
  assert.equal(dateIn('2026-11-02T23:30:00.000Z', 'Asia/Almaty'), '2026-11-03', 'it is already the next day there');
  assert.equal(dateIn('2026-11-02T23:30:00.000Z', 'Not/AZone'), '2026-11-02', 'an unknown zone falls back to UTC');
  assert.equal(dateIn('2026-11-02T23:30:00.000Z'), '2026-11-02');
  assert.equal(dateIn('garbage', 'UTC'), null);
  const link = { createdAt: '2026-11-02T23:30:00.000Z' };
  // (the first day of the link counts only with a workout on it, so each case has one on its own first day)
  const utc = complianceOf({ workouts: w('2026-11-02'), schedule: { days: [1, 2] }, link, today: TODAY, tz: 'UTC' });
  const almaty = complianceOf({ workouts: w('2026-11-03'), schedule: { days: [1, 2] }, link, today: TODAY, tz: 'Asia/Almaty' });
  assert.equal(utc.d7.from, '2026-11-02');
  assert.equal(almaty.d7.from, '2026-11-03');
  assert.deepEqual([utc.d7.planned, almaty.d7.planned], [2, 1]);
});

test('pause: closed, open and archived days are not planned and a workout in them is not a moved session', () => {
  // Paused Mon 11-02 .. Tue 11-03 (closed). Planned Mon, Wed, Fri: Wed 10-28 and Fri 10-30 stand; Mon is off.
  const closed = { ...old, pauses: [{ from: '2026-11-02', to: '2026-11-03' }] };
  const a = complianceOf({ workouts: w('2026-10-28'), schedule: MWF, link: closed, today: TODAY });
  assert.deepEqual([a.d7.planned, a.d7.done, a.d7.pct], [2, 1, 50]);
  // Trained during the pause: not counted in done (not a moved session, not a planned day) but it is still a training day.
  const b = complianceOf({ workouts: w('2026-11-02', '2026-11-03'), schedule: MWF, link: closed, today: TODAY });
  assert.deepEqual([b.d7.planned, b.d7.done, b.d7.workouts], [2, 0, 2]);
  // Open pause since Thursday 10-29 (to null): the rest of the window is off. Only Wed 10-28 is planned.
  const open = { ...old, pause: { since: '2026-10-29T08:00:00.000Z', until: null }, pauses: [{ from: '2026-10-29', to: null }] };
  const c = complianceOf({ workouts: [], schedule: MWF, link: open, today: TODAY });
  assert.deepEqual([c.d7.planned, c.d7.done], [1, 0]);
  // Archived and brought back: the archived stretch is in the history with `archived: true` and is off the same way.
  const archived = { ...old, pauses: [{ from: '2026-10-20', to: '2026-11-01', archived: true }] };
  const d = complianceOf({ workouts: [], schedule: MWF, link: archived, today: TODAY });
  assert.deepEqual([d.d7.planned, d.d7.done], [1, 0], 'only Monday 11-02 is back in the plan');
  assert.equal(d.d30.planned, 8, '30 days: Mon, Wed, Fri of 10-05..10-19 are 7, the archived 10-20..11-01 is off, Monday 11-02 is the 8th');
});

test('pause: the 30-day count drops exactly the paused days', () => {
  // The 30-day window 10-05 .. 11-03, with and without a pause over the week 10-12 (Mon) .. 10-18 (Sun).
  const bare = complianceOf({ workouts: [], schedule: MWF, link: old, today: TODAY });
  const paused = complianceOf({ workouts: [], schedule: MWF, link: { ...old, pauses: [{ from: '2026-10-12', to: '2026-10-18' }] }, today: TODAY });
  assert.equal(bare.d30.planned - paused.d30.planned, 3, 'a whole week of pause removes Mon, Wed and Fri');
  // A pause that is all of the window: nothing planned, null, not 0.
  const all = complianceOf({ workouts: [], schedule: MWF, link: { ...old, pauses: [{ from: '2026-01-01', to: null }] }, today: TODAY });
  assert.deepEqual([all.d7.planned, all.d7.pct], [0, null]);
});

test('a pause that had not been set yet on a past day does not touch it, and a pause after the window does not either', () => {
  const later = { ...old, pauses: [{ from: TODAY, to: addDays(TODAY, 10) }] };
  const c = complianceOf({ workouts: [], schedule: MWF, link: later, today: TODAY });
  assert.equal(c.d7.planned, 3);
});

test('the three windows share one calendar: 7 days are inside 30, 30 inside 90', () => {
  const c = complianceOf({ workouts: w(...Array.from({ length: 40 }, (_, i) => at(-1 - i))), schedule: { days: [1, 2, 3, 4, 5, 6, 7] }, link: old, today: TODAY });
  assert.deepEqual([c.d7.planned, c.d30.planned, c.d90.planned], [7, 30, 90]);
  assert.deepEqual([c.d7.pct, c.d30.pct], [100, 100]);
  assert.deepEqual([c.d90.done, c.d90.pct], [40, 44]);
});

test('last workout and days since: from the workout dates, today in the trainer\'s zone', () => {
  const c = complianceOf({ workouts: w('2026-10-20', '2026-10-31', '2026-11-04'), schedule: null, link: old, today: TODAY });
  assert.deepEqual([c.lastWorkout, c.daysSinceLast], ['2026-11-04', 0]);
  const y = complianceOf({ workouts: w('2026-11-03'), schedule: null, link: old, today: TODAY });
  assert.equal(y.daysSinceLast, 1);
  const none = complianceOf({ workouts: [], schedule: null, link: old, today: TODAY });
  assert.deepEqual([none.lastWorkout, none.daysSinceLast], [null, null]);
  // A date in the future and junk records are ignored.
  const junk = complianceOf({ workouts: [{ d: '2026-12-01' }, { d: 5 }, null, {}, { d: '4.11.2026' }, { d: '2026-10-30' }], schedule: null, link: old, today: TODAY });
  assert.deepEqual([junk.lastWorkout, junk.daysSinceLast], ['2026-10-30', 5]);
  assert.equal(daysBetween('2026-10-30', '2026-11-04'), 5);
});

test('attention: quiet after seven days without a workout, not before', () => {
  const six = complianceOf({ workouts: w(at(-6)), schedule: null, link: old, today: TODAY });
  assert.equal(six.attention, null);
  const seven = complianceOf({ workouts: w(at(-QUIET_DAYS)), schedule: null, link: old, today: TODAY });
  assert.equal(seven.attention, 'quiet');
  assert.equal(seven.daysSinceLast, 7);
  // A client who never trained, on a link older than a week.
  assert.equal(complianceOf({ workouts: [], schedule: null, link: old, today: TODAY }).attention, 'quiet');
});

test('attention: a new link is not quiet for its first week', () => {
  const six = complianceOf({ workouts: [], schedule: MWF, link: { createdAt: at(-6) + 'T10:00:00.000Z' }, today: TODAY });
  assert.equal(six.attention, null);
  const seven = complianceOf({ workouts: [], schedule: MWF, link: { createdAt: at(-7) + 'T10:00:00.000Z' }, today: TODAY });
  assert.equal(seven.attention, 'quiet');
  // An old workout from before the link does not make it quiet earlier than the link's own week.
  const older = complianceOf({ workouts: w(at(-40)), schedule: MWF, link: { createdAt: at(-2) + 'T10:00:00.000Z' }, today: TODAY });
  assert.equal(older.attention, null);
});

test('attention: none while paused, and the count restarts from the day the client is back', () => {
  const paused = { ...old, pause: { since: '2026-10-01T00:00:00.000Z', until: null }, pauses: [{ from: '2026-10-01', to: null }] };
  assert.equal(complianceOf({ workouts: [], schedule: MWF, link: paused, today: TODAY }).attention, null);
  // A pause with an end in the future: still paused today.
  const until = { ...old, pause: { since: '2026-10-01T00:00:00.000Z', until: addDays(TODAY, 3) }, pauses: [{ from: '2026-10-01', to: addDays(TODAY, 3) }] };
  assert.equal(complianceOf({ workouts: [], schedule: MWF, link: until, today: TODAY }).attention, null);
  // The pause ended on 10-31: the first day back is 11-01, three days ago. Not quiet, though the last workout was in September.
  const back = { ...old, pauses: [{ from: '2026-10-01', to: '2026-10-31' }] };
  assert.equal(complianceOf({ workouts: w('2026-09-20'), schedule: MWF, link: back, today: TODAY }).attention, null);
  // Seven days after coming back, with nothing done: quiet.
  assert.equal(complianceOf({ workouts: w('2026-09-20'), schedule: MWF, link: back, today: addDays('2026-11-01', 7) }).attention, 'quiet');
  // Back from the archive the same way.
  const restored = { ...old, pauses: [{ from: '2026-10-01', to: '2026-11-02', archived: true }] };
  assert.equal(complianceOf({ workouts: [], schedule: MWF, link: restored, today: TODAY }).attention, null);
});

test('attention: drop when the week is 20 points under the month, and the month has at least four planned days', () => {
  // Every day planned. The month: trained all days of 10-05..10-27, nothing since. Week 0 %, month 23/30.
  const days = Array.from({ length: 23 }, (_, i) => addDays('2026-10-05', i));
  const every = { days: [1, 2, 3, 4, 5, 6, 7] };
  // Last workout 10-27 is eight days ago -> quiet takes precedence.
  assert.equal(complianceOf({ workouts: w(...days), schedule: every, link: old, today: TODAY }).attention, 'quiet');
  // A workout three days ago keeps it from being quiet; the week is 1/7 = 14 %, the month 24/30 = 80 %: a drop.
  const c = complianceOf({ workouts: w(...days, at(-3)), schedule: every, link: old, today: TODAY });
  assert.deepEqual([c.d7.pct, c.d30.pct, c.attention], [14, 80, 'drop']);
  // The edge: 20 points is a drop, 19 is not (the earlier days trained: 19 of 23 and 4 of the last 7, against 22 and 5).
  const train = (early, late) => w(...Array.from({ length: early }, (_, i) => addDays('2026-10-05', i)), ...Array.from({ length: late }, (_, i) => addDays('2026-10-28', i)));
  const edge = complianceOf({ workouts: train(19, 4), schedule: every, link: old, today: TODAY });
  assert.deepEqual([edge.d7.pct, edge.d30.pct, edge.attention], [57, 77, 'drop']);
  const under = complianceOf({ workouts: train(22, 5), schedule: every, link: old, today: TODAY });
  assert.deepEqual([under.d7.pct, under.d30.pct, under.attention], [71, 90, null]);
});

test('attention: drop needs four planned days in the month', () => {
  const every = { days: [1, 2, 3, 4, 5, 6, 7] };
  // Link began 10-31 (3 days before the window ends on 11-03... 4 planned days: 10-31, 11-01, 11-02, 11-03). One workout at the start,
  // none since: the week is 25 %, the month the same, no gap to report.
  const four = complianceOf({ workouts: w('2026-10-31'), schedule: every, link: { createdAt: '2026-10-31T00:00:00.000Z' }, today: TODAY });
  assert.deepEqual([four.d30.planned, four.d7.pct, four.d30.pct, four.attention], [4, 25, 25, null]);
  // Three planned days is too little to say anything, even with the week below the month: link began 11-01.
  const three = complianceOf({ workouts: w('2026-11-01'), schedule: every, link: { createdAt: '2026-11-01T00:00:00.000Z' }, today: TODAY });
  assert.deepEqual([three.d30.planned, three.attention], [3, null]);
});

test('attention: no drop when either percentage is null', () => {
  const noPlan = complianceOf({ workouts: w(at(-3)), schedule: null, link: old, today: TODAY });
  assert.equal(noPlan.attention, null);
  // The week is all paused (null) while the month is fine.
  const link = { ...old, pauses: [{ from: '2026-10-28', to: '2026-11-03' }] };
  const c = complianceOf({ workouts: w('2026-10-20', at(-8)), schedule: { days: [1, 2, 3, 4, 5, 6, 7] }, link, today: TODAY });
  assert.equal(c.d7.pct, null);
  assert.equal(c.attention, null);
});

test('bad input does not throw', () => {
  for (const arg of [undefined, {}, { today: 'x' }, { workouts: 'no', today: TODAY }, { workouts: [], schedule: { days: 'x' }, link: null, today: TODAY }]) {
    const c = complianceOf(arg);
    assert.equal(c.d7.pct, null);
    assert.equal(c.attention === null || c.attention === undefined, true);
  }
});

test('attention: the guard of four planned days against a month thinned out by pauses', () => {
  // Mondays only. The month holds five: 10-05, 10-12, 10-19, 10-26, 11-02. The client trained on the first and the fourth
  // and on Sunday 11-01 (a day of pause: not a moved session). The week has one planned day, Monday 11-02, missed: 0 %.
  const workouts = w('2026-10-05', '2026-10-26', '2026-11-01');
  const mondays = { days: [1] };
  const four = complianceOf({ workouts, schedule: mondays, link: { ...old, pauses: [{ from: '2026-10-12', to: '2026-10-13' }, { from: '2026-11-01', to: '2026-11-01' }] }, today: TODAY });
  assert.deepEqual([four.d30.planned, four.d30.done, four.d30.pct, four.d7.pct, four.attention], [4, 2, 50, 0, 'drop']);
  const three = complianceOf({ workouts, schedule: mondays, link: { ...old, pauses: [{ from: '2026-10-12', to: '2026-10-13' }, { from: '2026-10-19', to: '2026-10-19' }, { from: '2026-11-01', to: '2026-11-01' }] }, today: TODAY });
  assert.deepEqual([three.d30.planned, three.d30.pct, three.d7.pct, three.attention], [3, 67, 0, null]);
});

test('a date that is not on the calendar is no workout: it cannot break the last workout or silence the signal', () => {
  const c = complianceOf({ workouts: [{ d: '2026-10-99' }, { d: '2026-13-01' }, { d: '0000-00-00' }, { d: '2026-02-30' }, { d: '2026-10-30' }], schedule: null, link: old, today: TODAY });
  assert.deepEqual([c.lastWorkout, c.daysSinceLast], ['2026-10-30', 5]);
  // Nothing but junk: no last workout, and a client old enough is quiet (the junk does not hide it).
  const junk = complianceOf({ workouts: [{ d: '2026-10-99' }], schedule: null, link: old, today: TODAY });
  assert.deepEqual([junk.lastWorkout, junk.daysSinceLast, junk.attention], [null, null, 'quiet']);
  assert.ok(!Number.isNaN(junk.d7.workouts));
  assert.equal(complianceOf({ workouts: w('2026-10-30'), schedule: null, link: old, today: '2026-02-30' }).d7.pct, null, 'a junk today is refused too');
});

test('a moved session covers a missed planned day of its own ISO week only', () => {
  // Plan Mon/Wed/Fri. Three full weeks (Mon 10-12 .. Sun 11-01), the client comes on Tuesday and Thursday only.
  const tuThu = [];
  for (const monday of ['2026-10-12', '2026-10-19', '2026-10-26']) tuThu.push(addDays(monday, 1), addDays(monday, 3));
  const c = complianceOf({ workouts: w(...tuThu), schedule: MWF, link: old, today: '2026-11-02' });
  assert.deepEqual([c.d30.from, c.d30.to], ['2026-10-03', '2026-11-01']);
  // The window holds Mon 10-05's week from Saturday on: Fri 10-09 (week of 10-05) is missed, with no workout in that week.
  // Weeks 10-12, 10-19, 10-26: planned 3, two moved sessions each: 2 of 3 each.
  const weeks = complianceOf({ workouts: w(...tuThu), schedule: MWF, link: old, today: '2026-11-02' });
  assert.deepEqual([weeks.d7.planned, weeks.d7.done, weeks.d7.pct], [3, 2, 67], 'the last week alone: 2 of 3');
  // 30 days: 10-03..11-01 = week of 9/28 (Sat, Sun: nothing planned), 3 full weeks and the tail: Fri 10-09 is in the week of 10-05.
  // Planned: Mon10-05 Wed10-07 Fri10-09 (week 10-05) + 3 + 3 + 3 = 12; done: 0 + 2 + 2 + 2 = 6 (the week of 10-05 had no workout).
  assert.deepEqual([weeks.d30.planned, weeks.d30.done, weeks.d30.pct], [12, 6, 50]);
  // The older formula would have let one busy week cover the others: a week with 5 extra days and a week with none.
  const busy = complianceOf({ workouts: w('2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01'), schedule: MWF, link: old, today: '2026-11-02' });
  assert.equal(busy.d7.done, 3, 'a full week is 3 of 3 and the surplus is lost');
  assert.deepEqual([busy.d30.planned, busy.d30.done], [12, 3], 'it does not make up for the three weeks before it');
});

test('the first day of the link is planned only with a workout on it', () => {
  const link = { createdAt: '2026-11-02T09:00:00.000Z' };   // Monday
  const without = complianceOf({ workouts: [], schedule: { days: [1, 2] }, link, today: TODAY });
  assert.deepEqual([without.d7.from, without.d7.planned], ['2026-11-03', 1], 'Monday is not held against a client who came in the afternoon');
  const withIt = complianceOf({ workouts: w('2026-11-02'), schedule: { days: [1, 2] }, link, today: TODAY });
  assert.deepEqual([withIt.d7.from, withIt.d7.planned, withIt.d7.done], ['2026-11-02', 2, 1]);
  // Created today, nothing done: the window is empty (starts tomorrow).
  assert.equal(complianceOf({ workouts: [], schedule: MWF, link: { createdAt: TODAY + 'T01:00:00.000Z' }, today: TODAY }).d7.from, null);
});

test('the last workout may be tomorrow (the client\'s zone is ahead), the age is never negative, and the percentages stop at today', () => {
  const c = complianceOf({ workouts: w('2026-11-05'), schedule: MWF, link: old, today: TODAY });
  assert.deepEqual([c.lastWorkout, c.daysSinceLast], ['2026-11-05', 0]);
  assert.equal(c.d7.workouts, 0, 'tomorrow is not in the window');
  assert.equal(c.d7.to, '2026-11-03');
  const far = complianceOf({ workouts: w('2026-11-06'), schedule: MWF, link: old, today: TODAY });
  assert.equal(far.lastWorkout, null, 'two days ahead is a wrong clock, not a workout');
});

test('a client without Telegram: the window begins at the first workout when the trainer filled the diary in later', () => {
  const link = { createdAt: '2026-11-02T09:00:00.000Z', managed: true };
  const c = complianceOf({ workouts: w('2026-10-21', '2026-10-23', '2026-10-26'), schedule: MWF, link, today: TODAY });
  assert.equal(c.d30.from, '2026-10-21');
  assert.deepEqual([c.d30.planned, c.d30.done], [6, 3], 'Wed 10-21, Fri 10-23, Mon 10-26, Wed 10-28, Fri 10-30, Mon 11-02; the first three were done');
  const telegram = complianceOf({ workouts: w('2026-10-21', '2026-10-23', '2026-10-26'), schedule: MWF, link: { ...link, managed: false }, today: TODAY });
  assert.equal(telegram.d30.from, '2026-11-03', 'a client with Telegram has no diary before the link');
});
