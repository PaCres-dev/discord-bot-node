import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createNewsCommand, formatNews, parseNewsArgs } from './news.command.js';
import { SECTIONS, resolveSection } from '../../news/google-news.js';

describe('parseNewsArgs', () => {
  test('cantidad (1-5), sección opcional y tema', () => {
    assert.deepEqual(parseNewsArgs('rust', resolveSection), { count: 1, section: null, query: 'rust' });
    assert.deepEqual(parseNewsArgs('tech rust', resolveSection), { count: 1, section: 'tech', query: 'rust' });
    assert.deepEqual(parseNewsArgs('3 tech rust async', resolveSection), { count: 3, section: 'tech', query: 'rust async' });
    assert.deepEqual(parseNewsArgs('9 deportes', resolveSection), { count: 5, section: 'deportes', query: '' });
    assert.deepEqual(parseNewsArgs('2026', resolveSection), { count: 1, section: null, query: '2026' });
  });
});

describe('formatNews', () => {
  const news = { title: 'Rust avanza', source: 'InfoQ', date: new Date('2026-09-27T10:00:00Z'), summary: 'Resumen.', url: 'https://infoq.com/x' };
  test('título, medio · fecha, resumen y link', () => {
    assert.equal(formatNews(news), '📰 *Rust avanza*\nInfoQ · 27 sep\nResumen.\nhttps://infoq.com/x');
  });
  test('sin resumen ni fecha', () => {
    assert.equal(formatNews({ ...news, summary: null, date: null }), '📰 *Rust avanza*\nInfoQ\nhttps://infoq.com/x');
  });
});

describe('!noticias', () => {
  function ctx(args) {
    const replies = [];
    return { replies, args, prefix: '!', logger: { info() {}, warn() {}, error() {} }, reply: { text: async (t) => replies.push(t) } };
  }
  function feed({ items = 3, fail = false } = {}) {
    const calls = { requests: [], sent: [] };
    return {
      calls,
      getNews: async (req) => {
        calls.requests.push(req);
        if (fail) throw new Error('caído');
        return Array.from({ length: Math.min(items, req.count) }, (_, i) => ({ id: `n${i}`, title: `N${i}`, source: 'M', date: null, summary: null, url: `https://m.com/${i}` }));
      },
      markSent: async (n) => calls.sent.push(n.id),
    };
  }
  const command = (f) => createNewsCommand({ feed: f, sections: SECTIONS, resolveSection });

  test('envía una noticia por mensaje y las marca como enviadas', async () => {
    const c = ctx('2 tech rust');
    const f = feed();
    await command(f).run(c);
    assert.deepEqual(f.calls.requests, [{ count: 2, section: 'tech', query: 'rust' }]);
    assert.deepEqual(c.replies, ['📰 *N0*\nM\nhttps://m.com/0', '📰 *N1*\nM\nhttps://m.com/1']);
    assert.deepEqual(f.calls.sent, ['n0', 'n1']);
  });

  test('si hay menos de las pedidas, avisa', async () => {
    const c = ctx('4 tech rust');
    await command(feed({ items: 1 })).run(c);
    assert.equal(c.replies.at(-1), 'Solo encontré 1 de 4 noticias nuevas en tech sobre "rust".');
  });

  test('sin noticias nuevas o si falla, avisa', async () => {
    let c = ctx('rust');
    await command(feed({ items: 0 })).run(c);
    assert.deepEqual(c.replies, ['No hay noticias nuevas sobre "rust" de la última semana.']);
    c = ctx('rust');
    await command(feed({ fail: true })).run(c);
    assert.deepEqual(c.replies, ['No pude traer noticias ahora. Prueba de nuevo en un rato.']);
  });

  test('sin tema ni sección: uso y secciones', async () => {
    const c = ctx('');
    await command(feed()).run(c);
    assert.match(c.replies[0], /^Uso: !noticias \[1-5\] \[sección\] <tema>\nSecciones: tech, ciencia/);
  });

  test('si falla el envío, esa noticia no queda marcada', async () => {
    const c = ctx('rust');
    c.reply.text = async () => {
      throw new Error('WhatsApp caído');
    };
    const f = feed();
    await assert.rejects(command(f).run(c), /WhatsApp caído/);
    assert.deepEqual(f.calls.sent, []);
  });
});
