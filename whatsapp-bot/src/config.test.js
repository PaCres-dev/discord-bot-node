import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from './config.js';

test('valores por defecto', () => {
  const { x, ...rest } = loadConfig({});
  assert.deepEqual(rest, { phoneNumber: '', authDir: './auth', logLevel: 'warn', ffmpegPath: 'ffmpeg', ytdlpPath: 'yt-dlp', prefix: '!' });
  assert.deepEqual({ ...x }, { username: '', password: '', email: '' });
});

test('limpia el número y lee las variables', () => {
  const config = loadConfig({ PHONE_NUMBER: '+54 9 11 2233-4455', AUTH_DIR: '/app/auth', LOG_LEVEL: 'info' });
  assert.equal(config.phoneNumber, '5491122334455');
  assert.equal(config.authDir, '/app/auth');
  assert.equal(config.logLevel, 'info');
});

test('rechaza un número inválido', () => {
  assert.throws(() => loadConfig({ PHONE_NUMBER: '123' }), /PHONE_NUMBER inválido/);
});

test('la configuración no se puede modificar', () => {
  assert.ok(Object.isFrozen(loadConfig({})));
});

test('lee la cuenta de X', () => {
  const { x } = loadConfig({ X_USERNAME: 'yo', X_PASSWORD: 'secreto', X_EMAIL: 'yo@mail.com' });
  assert.deepEqual({ ...x }, { username: 'yo', password: 'secreto', email: 'yo@mail.com' });
  assert.ok(Object.isFrozen(x));
});
