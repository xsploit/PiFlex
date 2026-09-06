// Manual browser integration fixture, never used by npm start or install-obs.
import http from 'node:http';
import readline from 'node:readline';
import { createOverlay } from '../server.mjs';
const clients = new Set(); let offline = false;
const deck = (id, title) => ({ group: `[Channel${id}]`, title, artist: 'TEST FIXTURE', key: '8A', bpm: 140,
  loaded: true, playing: true, channel_fader: 1, main_mix: true, on_air_candidate: true });
let state = { version: 1, decks: [deck(1, 'FIXTURE — First track')] };
function send(res) { res.write(`event: state\ndata: ${JSON.stringify(state)}\n\n`); }
const upstream = http.createServer((req, res) => {
  if (offline) { res.writeHead(503); res.end(); return; }
  res.writeHead(200, { 'Content-Type': 'text/event-stream' }); clients.add(res);
  res.on('close', () => clients.delete(res)); send(res);
});
await new Promise(r => upstream.listen(0, '127.0.0.1', r));
const app = createOverlay({ source: `http://127.0.0.1:${upstream.address().port}`, retryMs: 100, idleMs: 40000 });
await new Promise(r => app.server.listen(8797, '127.0.0.1', r));
const pulse = setInterval(() => { for (const res of clients) res.write(': keepalive\n\n'); }, 10000);
console.log('TEST FIXTURE ONLY: http://127.0.0.1:8797/overlay');
console.log('stdin: solo | mix | paused | unsafe | offline | online | quit');
const lines = readline.createInterface({ input: process.stdin });
lines.on('line', async command => {
  if (command === 'quit') { clearInterval(pulse); lines.close(); await app.close(); upstream.closeAllConnections(); upstream.close(); return; }
  if (command === 'offline') { offline = true; for (const res of clients) res.destroy(); }
  else {
    if (command === 'online') offline = false;
    if (command === 'solo') state = { version: 1, decks: [deck(1, 'FIXTURE — First track')] };
    if (command === 'mix') state = { version: 1, decks: [deck(1, 'FIXTURE — First track'), deck(2, 'FIXTURE — Incoming track')] };
    if (command === 'paused') state = { version: 1, decks: [{ ...deck(1, 'FIXTURE — First track'), playing: false }] };
    if (command === 'unsafe') state = { version: 1, decks: [deck(1, '<img src=x onerror=alert(1)> 音 — A very long title '.repeat(8))] };
    for (const res of clients) send(res);
  }
  console.log(command);
});
