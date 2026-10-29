// Writes api/card-assets/exercise-names.json: { "<exercise id>": [english name, russian name?] }.
// The api image carries nothing from catalogue/ or frontend/, and the report card names the
// heaviest exercise of a workout. Text only, no media. `--check` fails if the file is stale.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const target = path.join(root, 'api', 'card-assets', 'exercise-names.json');
const ru = JSON.parse(fs.readFileSync(path.join(root, 'catalogue', 'i18n', 'ru.json'), 'utf8'));
const out = {};
for (const file of fs.readdirSync(path.join(root, 'catalogue', 'exercises')).filter(f => f.endsWith('.json')).sort()) {
  const ex = JSON.parse(fs.readFileSync(path.join(root, 'catalogue', 'exercises', file), 'utf8'));
  if (typeof ex.id !== 'string' || typeof ex.name !== 'string') continue;
  const ruName = ru[ex.id]?.name;
  out[ex.id] = typeof ruName === 'string' && ruName ? [ex.name, ruName] : [ex.name];
}
const text = JSON.stringify(out) + '\n';
if (process.argv.includes('--check')) {
  if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== text) {
    console.error('api/card-assets/exercise-names.json is stale: run node scripts/catalogue/build-card-names.mjs');
    process.exit(1);
  }
} else {
  fs.writeFileSync(target, text);
  console.log(`${Object.keys(out).length} names, ${text.length} bytes`);
}
