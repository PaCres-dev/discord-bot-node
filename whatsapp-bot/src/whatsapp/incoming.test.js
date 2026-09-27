import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { getText, isSelfChat, toIncoming } from './incoming.js';

const ME = { id: '5491100000000:66@s.whatsapp.net', lid: '111111111111111:66@lid' };
const SELF_PN = '5491100000000@s.whatsapp.net';
const SELF_LID = '111111111111111@lid';
const OTHER = '5491199999999@s.whatsapp.net';
const GROUP = '120363000000000000@g.us';

describe('isSelfChat', () => {
  test('reconoce mi chat por número y por @lid', () => {
    assert.equal(isSelfChat(ME, SELF_PN), true);
    assert.equal(isSelfChat(ME, SELF_LID), true);
  });
  test('rechaza otros chats y grupos', () => {
    assert.equal(isSelfChat(ME, OTHER), false);
    assert.equal(isSelfChat(ME, GROUP), false);
    assert.equal(isSelfChat(undefined, SELF_PN), false);
  });
});

describe('getText', () => {
  test('lee texto simple, extendido y de mensajes temporales', () => {
    assert.equal(getText({ conversation: 'hola' }), 'hola');
    assert.equal(getText({ extendedTextMessage: { text: 'hola' } }), 'hola');
    assert.equal(getText({ ephemeralMessage: { message: { conversation: 'hola' } } }), 'hola');
    assert.equal(getText({ imageMessage: {} }), '');
  });
});

describe('toIncoming', () => {
  test('convierte un mensaje de Baileys en un objeto simple', () => {
    const raw = { key: { remoteJid: SELF_LID, fromMe: true, id: 'ID1' }, messageTimestamp: 123, message: { conversation: '  !img gato ' } };
    assert.deepEqual(toIncoming(raw, ME), {
      id: 'ID1',
      chatId: SELF_LID,
      fromMe: true,
      isSelfChat: true,
      text: '!img gato',
      timestamp: 123,
    });
  });
  test('fromMe e isSelfChat son false salvo que se cumplan', () => {
    const raw = { key: { remoteJid: OTHER, id: 'ID2' }, messageTimestamp: 1, message: { conversation: 'x' } };
    const inc = toIncoming(raw, ME);
    assert.equal(inc.fromMe, false);
    assert.equal(inc.isSelfChat, false);
  });
  test('mensajes sin contenido devuelven null', () => {
    assert.equal(toIncoming({ key: { remoteJid: SELF_LID, id: 'X' } }, ME), null);
    assert.equal(toIncoming(undefined, ME), null);
  });
});
