import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deleteSession, loadSession, saveSession } from './session.js';
import { createSeenStore } from '../shared/seen-store.js';

async function tempDir() {
  return mkdtemp(join(tmpdir(), 'x-test-'));
}

describe('sesión de X', () => {
  test('guarda solo auth_token y ct0, con permisos 600', async () => {
    const dir = await tempDir();
    const file = join(dir, 'x-session.json');
    await saveSession(file, { auth_token: 'A', ct0: 'C', password: 'no-debe-guardarse' });
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { auth_token: 'A', ct0: 'C' });
    assert.equal((await stat(file)).mode & 0o777, 0o600);
    assert.deepEqual(await loadSession(file), { auth_token: 'A', ct0: 'C' });
    await deleteSession(file);
    assert.equal(await loadSession(file), null);
    await rm(dir, { recursive: true });
  });

  test('sin archivo o incompleta devuelve null', async () => {
    assert.equal(await loadSession('/no/existe.json'), null);
  });
});

describe('tweets ya enviados', () => {
  test('se recuerdan entre reinicios', async () => {
    const dir = await tempDir();
    const file = join(dir, 'x-seen.json');
    const store = await createSeenStore(file);
    await store.add(['1', '2']);
    const again = await createSeenStore(file);
    assert.equal(again.has('1'), true);
    assert.equal(again.has('3'), false);
    await rm(dir, { recursive: true });
  });

  test('guarda solo los más recientes', async () => {
    const dir = await tempDir();
    const file = join(dir, 'x-seen.json');
    const store = await createSeenStore(file, { max: 3 });
    await store.add(['1', '2', '3']);
    await store.add(['4', '2']);
    assert.equal(store.has('1'), false);
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), ['2', '3', '4']);
    await rm(dir, { recursive: true });
  });
});
