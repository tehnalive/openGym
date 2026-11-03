// Preloaded into a test server (node --import): every call to api.telegram.org is answered here, with ok, and written as
// one JSON line to the file named by TG_STUB_LOG, so a test can say what the bot was asked to send. Nothing leaves the machine.
import fs from 'node:fs';

const real = globalThis.fetch;
const log = process.env.TG_STUB_LOG;

globalThis.fetch = async (input, init) => {
  const url = String((input && input.url) || input);
  if (!url.startsWith('https://api.telegram.org/')) return real(input, init);
  if (log) {
    let body = {};
    try { body = JSON.parse(init && typeof init.body === 'string' ? init.body : '{}'); } catch { /* a form: no text to record */ }
    fs.appendFileSync(log, JSON.stringify({ method: url.split('/').pop(), chat_id: body.chat_id, text: body.text }) + '\n');
  }
  return new Response(JSON.stringify({ ok: true, result: {} }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};
