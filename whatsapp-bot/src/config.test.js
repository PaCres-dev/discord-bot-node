import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from './config.js';

test('valores por defecto', () => {
  assert.deepEqual({ ...loadConfig({}) }, { phoneNumber: '', authDir: './auth', logLevel: 'warn', ffmpegPath: 'ffmpeg', prefix: '!' });
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
