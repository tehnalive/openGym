import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  PHRASES, bestSet, cardModel, exerciseName, phraseFor, renderCardPng, workoutCardSvg, xmlEscape,
} from '../telegram-card.mjs';

const workout = {
  name: 'Верх тела · A', d: '2026-10-29', start: 1_000_000, end: 1_000_000 + 58 * 60_000, vol: 6480,
  entries: [
    { id: '1000', muscleSnapshot: { muscleWeights: { chest: 1, triceps: 0.4 } },
      sets: [{ done: true, w: 60, r: 8 }, { done: true, w: 62.5, r: 8 }, { done: true, w: 100, r: 1, warmup: true }, { done: false, w: 200, r: 1 }] },
    { id: 'custom-1', muscleSnapshot: { muscleWeights: { 'upper-back': 1 } }, sets: [{ done: true, w: 50, r: 10 }] },
  ],
};
const state = { unit: 'kg', workouts: [1, 2, 3], customEx: [{ id: 'custom-1', name: 'Моя тяга' }] };
const pngSize = png => [png.readUInt32BE(16), png.readUInt32BE(20)];

test('twelve phrases per language, picked in rotation', () => {
  assert.equal(PHRASES.ru.length, 12);
  assert.equal(PHRASES.en.length, 12);
  assert.equal(phraseFor('ru', 0), PHRASES.ru[0]);
  assert.equal(phraseFor('ru', 13), PHRASES.ru[1]);
  assert.equal(phraseFor('ru', -1), PHRASES.ru[0]);
  assert.equal(phraseFor('de', 2), PHRASES.en[2]);
});

test('exercise names come from the catalogue pack or the profile', () => {
  assert.equal(exerciseName('0001', {}, 'en'), '3/4 sit-up');
  assert.match(exerciseName('1000', {}, 'ru'), /^[А-ЯЁ]/);
  assert.equal(exerciseName('custom-1', state, 'ru'), 'Моя тяга');
  assert.equal(exerciseName('nope', {}, 'ru'), '');
});

test('best set is the heaviest completed work set, warm-ups and unchecked sets ignored', () => {
  const best = bestSet(workout, state, 'ru');
  assert.deepEqual({ w: best.w, r: best.r }, { w: 62.5, r: 8 });
  assert.equal(bestSet({ entries: [{ id: '1000', sets: [{ done: true, w: 0, r: 10 }] }] }, state, 'ru'), null);
  const sides = { entries: [{ id: 'custom-1', sets: [{ sides: { L: { done: true, w: 20, r: 10 }, R: { done: true, w: 22.5, r: 9 } } }] }] };
  assert.equal(bestSet(sides, state, 'ru').w, 22.5);
});

test('card model: totals, levels, record, journal count', () => {
  const m = cardModel(workout, state, 'ru', 3);
  assert.equal(m.duration, '58 мин');
  assert.equal(m.volume, '6 480 кг');
  assert.equal(m.sets, 3);
  assert.equal(m.reps, 26);
  assert.equal(m.phrase, PHRASES.ru[3]);
  assert.equal(m.levels.chest, 4);
  assert.ok(m.levels.triceps >= 1 && m.levels.triceps < 4);
  assert.equal(m.record.text, '62,5 кг × 8');
  assert.equal(m.journal, 3);
  assert.equal(m.date, 'ЧЕТВЕРГ · 29 ОКТЯБРЯ');
  assert.deepEqual(m.muscleNames.slice(0, 1), ['Грудь']);
  const lb = cardModel(workout, { unit: 'lb' }, 'en');
  assert.match(lb.volume, /lb$/);
  assert.equal(lb.journal, 0);
});

test('svg escapes every dynamic string and carries no external reference', () => {
  const hostile = { ...workout, name: '<script>alert(1)</script>&"\'' };
  const svg = workoutCardSvg(cardModel(hostile, state, 'ru'));
  assert.ok(!svg.includes('<script'));
  assert.ok(svg.includes('&lt;script&gt;'));
  assert.ok(!/href=|xlink|<image|@import|url\(/.test(svg));
  assert.equal(xmlEscape('a<b&c'), 'a&lt;b&amp;c');
});

test('a card without duration, volume or record still renders sensible content', () => {
  const m = cardModel({ entries: [{ id: '1000', sets: [{ done: true, w: 0, r: 12 }] }] }, {}, 'ru');
  assert.equal(m.duration, '');
  assert.equal(m.volume, '');
  assert.equal(m.record, null);
  const svg = workoutCardSvg(m);
  assert.match(svg, /Тренировка/);
  assert.doesNotMatch(svg, /РЕКОРД/);
});

test('renders a 1080x1080 PNG with the bundled font', async () => {
  const png = await renderCardPng(workoutCardSvg(cardModel(workout, state, 'ru')));
  assert.ok(png, 'resvg is installed for this platform');
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.deepEqual(pngSize(png), [1080, 1080]);
  assert.ok(png.length > 20_000);
});

test('an unparseable svg gives null instead of throwing', async () => {
  assert.equal(await renderCardPng('<svg'), null);
});

test('card body outlines match the frontend geometry (male front/back)', async () => {
  const frontend = new URL('../../frontend/src/lib/body-paths.js', import.meta.url);
  if (!fs.existsSync(fileURLToPath(frontend))) return;
  const src = fs.readFileSync(fileURLToPath(frontend), 'utf8');
  const mod = await import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'));
  const mine = JSON.parse(fs.readFileSync(new URL('../card-assets/body-male.json', import.meta.url), 'utf8'));
  for (const view of ['front', 'back']) assert.deepEqual(mine[view], { vb: mod.default.male[view].vb, p: mod.default.male[view].p });
});
