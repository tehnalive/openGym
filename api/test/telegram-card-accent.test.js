import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ACCENTS, cardAccent, cardModel, cardPalette, renderCardPng, workoutCardSvg } from '../telegram-card.mjs';

const workout = {
  name: 'Верх тела · A', d: '2026-10-29', start: 1_000_000, end: 1_000_000 + 58 * 60_000,
  entries: [{ id: '1000', muscleSnapshot: { muscleWeights: { chest: 1, triceps: 0.4 } }, sets: [{ done: true, w: 60, r: 8 }] }],
};
const svgFor = state => workoutCardSvg(cardModel(workout, { unit: 'kg', workouts: [1], ...state }, 'ru'));

test('the card follows the accent the person picked in the app', () => {
  assert.ok(svgFor({ accent: 'violet' }).includes('#bf5af2'));
  assert.ok(!svgFor({ accent: 'violet' }).includes('#30d158'), 'no green left on a purple card');
  assert.ok(svgFor({ accent: 'red' }).includes('#ff453a'));
  assert.ok(svgFor({ accent: 'sky' }).includes('#0a84ff'));
});

test('no accent, an unknown one or rubbish gives the default green', () => {
  for (const state of [{}, { accent: 'lime' }, { accent: 'mauve' }, { accent: 7 }, { accent: 'custom' }, { accent: 'custom', accentCustom: 'red' },
    { accent: 'custom', accentCustom: 'url(#x)' }, { accent: '__proto__' }]) {
    assert.equal(cardAccent(state), '#30d158', JSON.stringify(state));
    assert.ok(svgFor(state).includes('#30d158'));
  }
});

test('a colour of their own is used, lowercase, and never reaches the SVG unchecked', () => {
  assert.equal(cardAccent({ accent: 'custom', accentCustom: ' #FF00AA ' }), '#ff00aa');
  const svg = svgFor({ accent: 'custom', accentCustom: '#12ab34' });
  assert.ok(svg.includes('#12ab34'));
  const hostile = svgFor({ accent: 'custom', accentCustom: '#12ab34"/><script>' });
  assert.ok(!hostile.includes('<script>'));
});

test('a custom colour too dark for the black card is lifted until it shows', () => {
  const lifted = cardAccent({ accent: 'custom', accentCustom: '#0a0a14' });
  assert.notEqual(lifted, '#0a0a14');
  const bright = hex => hex.slice(1).match(/../g).map(v => parseInt(v, 16)).reduce((a, b) => a + b, 0);
  assert.ok(bright(lifted) > bright('#0a0a14'));
});

test('the palette: shades climb from grey to the accent, the logo ink contrasts with it', () => {
  const p = cardPalette('#bf5af2');
  assert.equal(p.shades.length, 5);
  assert.equal(p.shades[0], '#2c2c2e');
  assert.equal(p.shades[4], '#bf5af2');
  assert.equal(p.ink, '#ffffff');   // as in the app: white on violet, black on lime
  assert.equal(cardPalette('#30d158').ink, '#000000');
  assert.equal(cardPalette('nonsense').accent, '#30d158');
});

test('the presets are the app\'s presets (a copy on purpose: the API image cannot import the frontend)', () => {
  const source = fs.readFileSync(fileURLToPath(new URL('../../frontend/src/lib/format.js', import.meta.url)), 'utf8');
  const body = /export const ACCENTS = \{([^}]*)\}/.exec(source)?.[1];
  assert.ok(body, 'ACCENTS not found in frontend/src/lib/format.js');
  const app = Object.fromEntries([...body.matchAll(/(\w+):\s*'(#[0-9a-f]{6})'/gi)].map(m => [m[1], m[2].toLowerCase()]));
  assert.deepEqual(ACCENTS, app);
  // ...and the ink on each preset is the one the app draws on it (ACCENT_INK).
  const inkBody = /export const ACCENT_INK = \{([^}]*)\}/.exec(source)?.[1];
  const ink = Object.fromEntries([...inkBody.matchAll(/(\w+):\s*'(#[0-9a-f]{6})'/gi)].map(m => [m[1], m[2].toLowerCase()]));
  for (const [key, hex] of Object.entries(ACCENTS)) assert.equal(cardPalette(hex).ink, ink[key], key);
});

test('a purple card still renders to a real 1080x1080 PNG', async () => {
  const png = await renderCardPng(svgFor({ accent: 'violet' }));
  if (png === null) return;   // renderer not installed on this machine: the sender falls back to text
  assert.equal(png.readUInt32BE(16), 1080);
  assert.equal(png.readUInt32BE(20), 1080);
});
