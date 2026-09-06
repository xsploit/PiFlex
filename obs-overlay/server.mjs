import http from 'node:http';
import https from 'node:https';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { SseParser } from './sse.mjs';
import { normalizeState } from './public/model.mjs';

export function validateSource(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('Source must be an HTTP(S) origin, e.g. http://192.168.1.80:8794');
  }
  return url;
}

export function createOverlay({ source = 'http://127.0.0.1:8794', retryMs = 1000, idleMs = 40000 } = {}) {
  const upstream = new URL('/v1/events', validateSource(source));
  const clients = new Set();
  let request, retry, keepalive, lastState = null, status = 'idle', closed = false, failures = 0, generation = 0;
  const envelope = () => ({ status, state: lastState });
  function send(client) {
    if (client.destroyed || client.writableLength > 65536) { client.destroy(); return; }
    client.write(`event: overlay\ndata: ${JSON.stringify(envelope())}\n\n`);
  }
  function broadcast() { for (const client of clients) send(client); }
  function connect() {
    if (closed || !clients.size || request) return;
    status = 'connecting'; lastState = null; broadcast();
    let finished = false;
    const epoch = ++generation;
    const req = (upstream.protocol === 'https:' ? https : http).get(upstream, {
      headers: { Accept: 'text/event-stream' }, agent: false
    });
    request = req;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(firstStateTimer);
      if (epoch !== generation) { req.destroy(); return; }
      if (request === req) request = null;
      req.destroy();
      lastState = null;
      status = clients.size && !closed ? 'offline' : 'idle'; broadcast();
      if (clients.size && !closed) {
        const delay = Math.min(30000, retryMs * 2 ** Math.min(failures++, 5));
        retry = setTimeout(() => { retry = null; connect(); }, delay);
      }
    };
    const firstStateTimer = setTimeout(finish, Math.min(idleMs, 10000));
    req.setTimeout(idleMs, finish);
    req.on('error', finish);
    req.on('response', res => {
      if (res.statusCode !== 200 || !res.headers['content-type']?.startsWith('text/event-stream')) {
        res.destroy(); finish(); return;
      }
      const parser = new SseParser((event, data) => {
        if (event !== 'state') return;
        lastState = normalizeState(JSON.parse(data));
        clearTimeout(firstStateTimer);
        failures = 0; status = 'live'; broadcast();
      });
      res.setEncoding('utf8');
      res.on('data', text => { try { parser.push(text); } catch { res.destroy(); finish(); } });
      res.on('end', finish); res.on('error', finish); res.on('close', finish);
    });
  }
  function release(client) {
    clients.delete(client);
    if (!clients.size) {
      clearTimeout(retry); retry = null;
      clearInterval(keepalive); keepalive = null;
      ++generation; request?.destroy(); request = null;
      status = 'idle'; lastState = null; failures = 0;
    }
  }
  const files = { '/': ['index.html', 'text/html'], '/overlay': ['overlay.html', 'text/html'],
    '/app.mjs': ['app.mjs', 'text/javascript'], '/model.mjs': ['model.mjs', 'text/javascript'],
    '/setup.mjs': ['setup.mjs', 'text/javascript'], '/style.css': ['style.css', 'text/css'],
    '/now-playing.svg': ['now-playing.svg', 'image/svg+xml'] };
  const server = http.createServer(async (req, res) => {
    const port = server.address()?.port;
    if (![ `127.0.0.1:${port}`, `localhost:${port}` ].includes(req.headers.host)) {
      res.writeHead(403); res.end(); return;
    }
    const origin = req.headers.origin;
    if (origin && ![`http://127.0.0.1:${port}`, `http://localhost:${port}`].includes(origin)) {
      res.writeHead(403); res.end(); return;
    }
    if (req.method !== 'GET') { res.writeHead(405, { Allow: 'GET' }); res.end(); return; }
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'self'");
    const path = new URL(req.url, 'http://localhost').pathname;
    if (path === '/events') {
      if (clients.size >= 16) { res.writeHead(503); res.end(); return; }
      res.writeHead(200, { 'Content-Type': 'text/event-stream', Connection: 'keep-alive' });
      res.flushHeaders(); clients.add(res); send(res);
      res.on('close', () => release(res));
      if (!keepalive) keepalive = setInterval(() => {
        for (const client of clients) {
          if (client.writableLength > 65536) client.destroy();
          else client.write('event: pulse\ndata: {}\n\n');
        }
      }, 15000);
      if (!request && !retry) connect();
      return;
    }
    if (path === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status, clients: clients.size, upstream: upstream.origin })); return;
    }
    const entry = files[path];
    if (!entry) { res.writeHead(404); res.end('Not found'); return; }
    try {
      const data = await readFile(new URL(`./public/${entry[0]}`, import.meta.url));
      res.writeHead(200, { 'Content-Type': `${entry[1]}; charset=utf-8` }); res.end(data);
    } catch { res.writeHead(500); res.end('Asset unavailable'); }
  });
  server.requestTimeout = 10000; server.headersTimeout = 10000;
  return { server, close: async () => {
    closed = true; clearTimeout(retry); clearInterval(keepalive); request?.destroy();
    for (const client of clients) client.destroy();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  } };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const source = process.env.BITEDJ_SOURCE || 'http://127.0.0.1:8794';
  const port = Number(process.env.BITEDJ_OVERLAY_PORT || 8795);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid overlay port');
  const app = createOverlay({ source });
  app.server.on('error', error => { console.error(`Overlay: ${error.code || error.message}`); process.exitCode = 1; });
  app.server.listen(port, '127.0.0.1', () => console.log(`BiteDJ overlay: http://127.0.0.1:${port}/ (source ${validateSource(source).origin})`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => app.close());
}
