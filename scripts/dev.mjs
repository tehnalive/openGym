import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
// This is a browser-only local preview. Keep its data separate and never read deployment
// credentials from .env or pass a Telegram bot token into the local API process.
const data = path.join(root, '.cache', 'telegram-local-preview');
mkdirSync(data, { recursive: true });
const apiDir = path.join(root, 'api');
const frontendDir = path.join(root, 'frontend');
if (!existsSync(path.join(apiDir, 'node_modules')) || !existsSync(path.join(frontendDir, 'node_modules'))) {
  console.error('Install dependencies using integration/LOCAL_DEV.md first.');
  process.exit(1);
}
const origin = 'http://localhost:8080';
const env = { ...process.env, DATA_DIR: data, PORT: '3000', RP_ID: 'localhost',
  ORIGIN: origin, COACH_DISABLED: '1', MEDIA_UPLOADS: '0', INVITE_ONLY: '0', ALLOW_GUEST: '1',
  PASSWORD_LOGIN: '0', FIRST_USER_ADMIN: '0', TRUST_PROXY: '0', TELEGRAM_BOT_TOKEN: '',
  TELEGRAM_ALLOWED_IDS: '', TELEGRAM_MINI_APP_URL: '' };
const children = [
  spawn(process.execPath, ['server.js'], { cwd: apiDir, env, stdio: 'inherit' }),
  spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5174', '--strictPort'],
    { cwd: frontendDir, env: { ...env, APP_HOST: '', API_ORIGIN: env.ORIGIN }, stdio: 'inherit' }),
];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  children.forEach(child => { if (child.exitCode === null) child.kill('SIGTERM'); });
  process.exitCode = code;
}
for (const child of children) {
  child.on('error', () => { console.error('Could not start a local service.'); stop(1); });
  child.on('exit', code => { if (!stopping) stop(code || 0); });
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
console.log('Local preview: http://localhost:5174 (guest mode; no Telegram bot or Bot API calls).');
