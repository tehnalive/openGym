import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

const photoPath = fileURLToPath(new URL('./assets/gym-statsbot-avatar.jpg', import.meta.url));
const name = 'Жимолость';
const description = 'Жимолость — дневник тренировок: записывайте упражнения, подходы и веса, следите за прогрессом. Откройте приложение кнопкой ниже и войдите через Telegram.';
const shortDescription = 'Жимолость — дневник тренировок и прогресса: упражнения, подходы, повторы и веса.';
const commands = [
  { command: 'start', description: 'Начать и открыть дневник' },
  { command: 'app', description: 'Открыть дневник тренировок' },
];

function checkConfig(token, miniAppUrl) {
  if (typeof token !== 'string' || !/^[1-9][0-9]*:[A-Za-z0-9_-]{20,200}$/.test(token)) {
    throw new Error('TELEGRAM_BOT_TOKEN is missing or invalid.');
  }
  let parsedUrl;
  try { parsedUrl = new URL(miniAppUrl); } catch { throw new Error('TELEGRAM_MINI_APP_URL is missing or invalid.'); }
  if (parsedUrl.protocol !== 'https:' || !parsedUrl.hostname || parsedUrl.username || parsedUrl.password) {
    throw new Error('TELEGRAM_MINI_APP_URL must be an absolute HTTPS URL without credentials.');
  }
}

async function call(token, method, body, contentType = 'application/json', fetchImpl = fetch) {
  let response;
  let result;
  try {
    response = await fetchImpl(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: contentType ? { 'Content-Type': contentType } : undefined,
      body: body === undefined ? undefined : (contentType === 'application/json' ? JSON.stringify(body) : body),
      signal: AbortSignal.timeout(40_000),
    });
    result = await response.json();
  } catch {
    throw new Error(`Telegram request failed at ${method}; response details withheld.`);
  }
  if (!response.ok || result?.ok !== true) {
    throw new Error(`Telegram rejected ${method}; response details withheld.`);
  }
  return result.result;
}

export async function configureBot({ token, miniAppUrl, fetchImpl = fetch, logger = console }) {
  const request = (method, body, contentType = 'application/json') => call(token, method, body, contentType, fetchImpl);
  checkConfig(token, miniAppUrl);
  const bot = await request('getMe');
  if (bot?.username?.toLowerCase() !== 'gym_statsbot') {
    throw new Error('The configured token does not belong to @Gym_statsbot; no changes were applied.');
  }

  await request('setMyName', { name, language_code: '' });
  logger.log('Bot name updated.');
  await request('setMyProfilePhoto', await profilePhotoForm(), null);
  logger.log('Profile photo updated.');
  await request('setMyDescription', { description, language_code: '' });
  logger.log('Bot description updated.');
  await request('setMyShortDescription', { short_description: shortDescription, language_code: '' });
  logger.log('About text updated.');
  await request('setMyCommands', { commands, language_code: '' });
  logger.log('Commands updated: /start, /app.');
  await request('setChatMenuButton', { menu_button: {
    type: 'web_app', text: 'Открыть дневник', web_app: { url: new URL(miniAppUrl).href },
  } });
  logger.log('Default Mini App menu button updated.');

  const actualName = await request('getMyName', { language_code: '' });
  const actualDescription = await request('getMyDescription', { language_code: '' });
  const actualShortDescription = await request('getMyShortDescription', { language_code: '' });
  const actualCommands = await request('getMyCommands', { language_code: '' });
  const actualMenu = await request('getChatMenuButton');
  if (actualName?.name !== name || actualDescription?.description !== description
    || actualShortDescription?.short_description !== shortDescription
    || !Array.isArray(actualCommands) || actualCommands.map(item => item.command).join(',') !== 'start,app'
    || actualMenu?.type !== 'web_app' || actualMenu?.web_app?.url !== new URL(miniAppUrl).href) {
    throw new Error('Telegram accepted the settings but the read-back check did not match.');
  }
  logger.log('Telegram settings verified by read-back.');
}

async function profilePhotoForm() {
  const image = await readFile(photoPath);
  const form = new FormData();
  form.append('photo', JSON.stringify({ type: 'static', photo: 'attach://profile_photo' }));
  form.append('profile_photo', new Blob([image], { type: 'image/jpeg' }), 'gym-statsbot-avatar.jpg');
  return form;
}

async function main() {
  const envText = await readFile(new URL('../.env', import.meta.url), 'utf8');
  const localEnv = Object.fromEntries(envText.split(/\r?\n/).flatMap(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return [];
    const separator = trimmed.indexOf('=');
    if (separator < 1) return [];
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    return [[key, value]];
  }));
  await configureBot({ token: process.env.TELEGRAM_BOT_TOKEN ?? localEnv.TELEGRAM_BOT_TOKEN,
    miniAppUrl: process.env.TELEGRAM_MINI_APP_URL ?? localEnv.TELEGRAM_MINI_APP_URL });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : 'Bot configuration failed; details withheld.');
    process.exitCode = 1;
  });
}
