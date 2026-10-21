import test from 'node:test';
import assert from 'node:assert/strict';
import { configureBot } from './configure-telegram-bot.mjs';

const token = '123456789:synthetic_telegram_test_token_not_a_secret';
const miniAppUrl = 'https://local.example.test/';
const quiet = { log() {} };
function fakeBot(username = 'Gym_statsbot', wrongName = false) {
  const saved = {}, calls = [];
  const fetchImpl = async (url, options) => {
    const method = url.split('/').at(-1); calls.push(method);
    const body = options.headers?.['Content-Type'] === 'application/json' && options.body ? JSON.parse(options.body) : {};
    let result = true;
    if (method === 'getMe') result = { username };
    else if (method.startsWith('set')) saved[method] = body;
    else if (method === 'getMyName') result = { name: wrongName ? 'wrong' : saved.setMyName.name };
    else if (method === 'getMyDescription') result = saved.setMyDescription;
    else if (method === 'getMyShortDescription') result = saved.setMyShortDescription;
    else if (method === 'getMyCommands') result = saved.setMyCommands.commands;
    else if (method === 'getChatMenuButton') result = saved.setChatMenuButton.menu_button;
    return new Response(JSON.stringify({ ok: true, result }), { headers: { 'Content-Type': 'application/json' } });
  };
  return { fetchImpl, saved, calls };
}

test('local Bot API receives and reads back branded name, descriptions, commands and menu', async () => {
  const bot = fakeBot();
  await configureBot({ token, miniAppUrl, fetchImpl: bot.fetchImpl, logger: quiet });
  assert.equal(bot.saved.setMyName.name, 'Жимолость');
  assert.match(bot.saved.setMyDescription.description, /Жимолость/);
  assert.match(bot.saved.setMyShortDescription.short_description, /Жимолость/);
  assert.equal(bot.saved.setChatMenuButton.menu_button.web_app.url, miniAppUrl);
  assert.deepEqual(bot.saved.setMyCommands.commands.map(c => c.command), ['start', 'app']);
  assert.ok(bot.calls.includes('getMyName'));
  assert.ok(!bot.calls.includes('getUpdates') && !bot.calls.includes('sendMessage'));
});

test('wrong configured bot causes no mutations', async () => {
  const bot = fakeBot('other_bot');
  await assert.rejects(configureBot({ token, miniAppUrl, fetchImpl: bot.fetchImpl, logger: quiet }), /does not belong/);
  assert.deepEqual(bot.calls, ['getMe']);
});

test('an incorrect read-back never reports success', async () => {
  const bot = fakeBot('Gym_statsbot', true);
  await assert.rejects(configureBot({ token, miniAppUrl, fetchImpl: bot.fetchImpl, logger: quiet }), /read-back/);
});
