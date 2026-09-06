import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { setTimeout as sleep } from 'node:timers/promises';
import { createOverlay, validateSource } from '../server.mjs';
import { SseParser } from '../sse.mjs';
import { normalizeState, selectDecks, optionsFrom } from '../public/model.mjs';

const deck = (number, extra = {}) => ({ group: `[Channel${number}]`, loaded: true, playing: true,
  channel_fader: 1, main_mix: true, on_air_candidate: true, title: 'Signal 音', artist: 'Artist', bpm: 140, key: '8A', ...extra });
const snapshot = (...decks) => ({ version: 1, timestamp_ms: Date.now(), decks });
async function waitFor(fn) { for (let i = 0; i < 160; ++i) { if (fn()) return; await sleep(10); } throw new Error('Timed out waiting for condition'); }
async function listen(server) { await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); return `http://127.0.0.1:${server.address().port}`; }
function subscribe(url) {
  const events = []; let response;
  const req = http.get(url, res => {
    response = res; res.setEncoding('utf8');
    const parser = new SseParser((type, data) => { if (type === 'overlay') events.push(JSON.parse(data)); });
    res.on('data', text => parser.push(text)); res.on('error', () => {});
  });
  req.on('error', () => {});
  return { events, close: () => { response?.destroy(); req.destroy(); } };
}

test('mix selects only loaded, playing, open, routed candidate decks; both during blend', () => {
  const state = normalizeState(snapshot(deck(1), deck(2, { channel_fader: .5 }), deck(3, { playing: false }), deck(4, { channel_fader: 0 })));
  assert.deepEqual(selectDecks(state).map(d => d.group), ['[Channel1]', '[Channel2]']);
  assert.deepEqual(normalizeState(state), state, 'browser revalidation preserves normalized state');
  assert.equal(selectDecks(normalizeState(snapshot(deck(1, { main_mix: false })))).length, 0);
  assert.equal(selectDecks(normalizeState(snapshot(deck(1, { loaded: false })))).length, 0);
});
test('dominant selection has stable ties; explicit deck/loaded modes include paused tracks', () => {
  const state = normalizeState(snapshot(deck(2), deck(1), deck(3, { playing: false })));
  assert.equal(selectDecks(state, 'dominant')[0].group, '[Channel1]');
  assert.equal(selectDecks(state, 'deck3').length, 1);
  assert.equal(selectDecks(state, 'loaded').length, 3);
});
test('malformed schema, duplicate groups and unknown versions fail closed', () => {
  for (const input of [null, { version: 2, decks: [] }, snapshot(deck(1), deck(1)), snapshot({ group: 'evil' })]) {
    assert.throws(() => normalizeState(input));
  }
  assert.equal(normalizeState(snapshot(deck(1, { title: 'x'.repeat(1000), bpm: Infinity }))).decks[0].title.length, 512);
});
test('query parameters constrain modes/colors and demo is explicit', () => {
  assert.equal(optionsFrom('?accent=url(evil)&mode=evil').accent, '#67ead4');
  assert.equal(optionsFrom('?demo=true').demo, false);
  assert.equal(optionsFrom('').theme, 'minimal');
  assert.equal(optionsFrom('?theme=panel').theme, 'minimal');
  assert.equal(optionsFrom('?demo=1&mode=dominant').mode, 'dominant');
});
test('source cannot carry credentials, paths, or arbitrary protocols', () => {
  assert.equal(validateSource('http://192.168.1.80:8794').port, '8794');
  for (const url of ['file:///etc/passwd', 'http://a:b@host/', 'http://host/v1/state', 'http://host/?url=evil']) assert.throws(() => validateSource(url));
});
test('SSE handles fragmented CRLF, multiline data, comments, multiple frames and size limits', () => {
  const events = []; const parser = new SseParser((...event) => events.push(event));
  for (const chunk of ['event: sta', 'te\r\ndata: one\r\ndata: two\r', '\n\r\n: keepalive\n\nevent: state\ndata: three\n\n']) parser.push(chunk);
  assert.deepEqual(events, [['state', 'one\ntwo'], ['state', 'three']]);
  assert.throws(() => new SseParser(() => {}).push('x'.repeat(65537)));
});
test('real HTTP bridge fans out one stream, forwards changes, reconnects and drops stale state', async t => {
  let connections = 0; const upstreamClients = new Set();
  const upstream = http.createServer((req, res) => {
    assert.equal(req.url, '/v1/events'); ++connections; upstreamClients.add(res);
    res.on('close', () => upstreamClients.delete(res));
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    // Deliberately split a multibyte character across TCP writes.
    const payload = Buffer.from(`event: state\ndata: ${JSON.stringify(snapshot(deck(1)))}\n\n`);
    const cut = payload.indexOf(Buffer.from('音')) + 1;
    res.write(payload.subarray(0, cut)); res.write(payload.subarray(cut));
  });
  const source = await listen(upstream);
  const app = createOverlay({ source, retryMs: 20, idleMs: 1500 }); const base = await listen(app.server);
  const a = subscribe(`${base}/events`), b = subscribe(`${base}/events`);
  t.after(async () => { a.close(); b.close(); await app.close(); upstream.closeAllConnections(); await new Promise(r => upstream.close(r)); });
  await waitFor(() => a.events.at(-1)?.status === 'live' && b.events.at(-1)?.status === 'live');
  assert.equal(connections, 1);
  assert.equal(a.events.at(-1).state.decks[0].title, 'Signal 音');
  for (const res of upstreamClients) res.write(`event: state\ndata: ${JSON.stringify(snapshot(deck(1), deck(2)))}\n\n`);
  await waitFor(() => a.events.at(-1)?.state?.decks.length === 2 && b.events.at(-1)?.state?.decks.length === 2);
  for (const res of upstreamClients) res.destroy();
  await waitFor(() => a.events.some(e => e.status === 'offline'));
  assert.equal(a.events.find(e => e.status === 'offline').state, null);
  await waitFor(() => connections === 2 && a.events.at(-1)?.status === 'live');
  for (const res of upstreamClients) res.write('event: state\ndata: {"version":99,"decks":[]}\n\n');
  await waitFor(() => a.events.filter(e => e.status === 'offline').length === 2);
  a.close(); b.close();
  await waitFor(() => upstreamClients.size === 0);
  const health = await fetch(`${base}/health`).then(r => r.json());
  assert.equal(health.status, 'idle'); assert.equal(health.clients, 0);
});
test('quiet comments keep live state; stalled socket clears state', async t => {
  let response; const upstream = http.createServer((req, res) => {
    response = res; res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write(`event: state\ndata: ${JSON.stringify(snapshot(deck(1)))}\n\n`);
  });
  const source = await listen(upstream); const app = createOverlay({ source, retryMs: 1000, idleMs: 120 });
  const base = await listen(app.server); const client = subscribe(`${base}/events`);
  t.after(async () => { client.close(); await app.close(); upstream.closeAllConnections(); await new Promise(r => upstream.close(r)); });
  await waitFor(() => client.events.at(-1)?.status === 'live');
  for (let i = 0; i < 5; ++i) { response.write(': keepalive\n\n'); await sleep(40); }
  assert.equal(client.events.at(-1).status, 'live');
  await waitFor(() => client.events.at(-1)?.status === 'offline');
  assert.equal(client.events.at(-1).state, null);
});
test('HTTP surface is read-only, host/origin constrained, serves assets and makes no idle upstream request', async t => {
  const app = createOverlay({ source: 'http://127.0.0.1:1' }); const base = await listen(app.server);
  t.after(() => app.close());
  assert.equal((await fetch(`${base}/health`).then(r => r.json())).status, 'idle');
  assert.equal((await fetch(base, { method: 'POST' })).status, 405);
  assert.equal((await fetch(base, { headers: { Origin: 'https://example.com' } })).status, 403);
  const badHostStatus = await new Promise((resolve, reject) => {
    http.get(base, { headers: { Host: 'example.com' } }, res => { res.resume(); resolve(res.statusCode); }).on('error', reject);
  });
  assert.equal(badHostStatus, 403);
  assert.equal((await fetch(`${base}/server.mjs`)).status, 404);
  for (const path of ['', '/overlay', '/app.mjs', '/model.mjs', '/setup.mjs', '/style.css', '/now-playing.svg']) assert.equal((await fetch(base + path)).status, 200);
  const svg = await fetch(base + '/now-playing.svg');
  assert.match(svg.headers.get('content-type'), /image\/svg\+xml/);
  assert.match(await svg.text(), /visibility="hidden"/);
});
