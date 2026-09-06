import { normalizeState, selectDecks, optionsFrom } from './model.mjs';
const options = optionsFrom(location.search);
document.documentElement.style.setProperty('--accent', options.accent);
document.body.dataset.theme = options.theme;
const root = document.querySelector('#tracks');
const templateResponse = await fetch('/now-playing.svg');
if (!templateResponse.ok) throw new Error('SVG template unavailable');
const template = new DOMParser().parseFromString(await templateResponse.text(), 'image/svg+xml').documentElement;
let lastKey = '', watchdog;
function report(status) { if (parent !== window) parent.postMessage({ type: 'bitedj-overlay-status', status }, location.origin); }
function fitText(node, value, maxWidth) {
  if (node.dataset.full === value) return;
  node.dataset.full = value; node.textContent = value;
  if (node.getComputedTextLength() <= maxWidth) return;
  const chars = Array.from(value); let low = 0, high = chars.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    node.textContent = chars.slice(0, middle).join('') + '…';
    if (node.getComputedTextLength() <= maxWidth) low = middle; else high = middle - 1;
  }
  node.textContent = chars.slice(0, low).join('') + '…';
}
function render(state) {
  const decks = selectDecks(state, options.mode);
  const key = JSON.stringify(decks);
  if (key === lastKey) return;
  lastKey = key;
  const existing = new Map([...root.children].map(el => [el.dataset.deck, el]));
  for (const deck of decks) {
    let card = existing.get(deck.group);
    if (!card) {
      card = document.createElement('article'); card.className = 'track'; card.dataset.deck = deck.group;
      const svg = document.importNode(template, true);
      const prefix = deck.group.replace(/[^a-z0-9]/gi, '') + '-';
      for (const node of svg.querySelectorAll('[id]')) node.id = prefix + node.id;
      for (const node of svg.querySelectorAll('*')) {
        for (const attr of ['filter', 'clip-path', 'stroke']) {
          if (node.getAttribute(attr)?.startsWith('url(#')) node.setAttribute(attr, node.getAttribute(attr).replace('url(#', `url(#${prefix}`));
        }
      }
      card.append(svg);
      root.append(card);
    }
    existing.delete(deck.group);
    const set = (selector, text) => { const node = card.querySelector(selector); if (node.textContent !== text) node.textContent = text; };
    set('.eyebrow', options.demo ? 'NOW PLAYING · PREVIEW' : deck.on_air_candidate ? 'NOW PLAYING' : 'LOADED');
    set('.deck-label', decks.length > 1 || options.mode.startsWith('deck') ? `DECK 0${deck.group.match(/\d/)[0]}` : '');
    fitText(card.querySelector('.title'), deck.title || 'Untitled track', 844);
    fitText(card.querySelector('.artist'), deck.artist || 'Unknown artist', 632);
    set('.details', options.details ? [deck.bpm ? `${Number(deck.bpm.toFixed(1))} BPM` : '', deck.key].filter(Boolean).join('  ·  ') : '');
    card.title = `${deck.artist} — ${deck.title}`;
    card.querySelector('svg').setAttribute('aria-label', card.title);
  }
  for (const card of existing.values()) card.remove();
  // Keep deterministic deck order even after decks enter/leave independently.
  decks.forEach((d, i) => { const card = [...root.children].find(c => c.dataset.deck === d.group); card.style.order = i; });
}
function hide() { render(null); report('offline'); }
if (options.demo) {
  document.querySelector('#demo-label').hidden = false;
  render(normalizeState({ version: 1, decks: [
    { group: '[Channel1]', loaded: true, playing: true, on_air_candidate: true, channel_fader: 1, main_mix: true, title: 'Midnight Transmission', artist: 'Example Artist', bpm: 140, key: '8A' },
    { group: '[Channel2]', loaded: true, playing: true, on_air_candidate: true, channel_fader: 0.7, main_mix: true, title: 'Into the Static', artist: 'Second Artist', bpm: 140, key: '9A' }
  ] }));
} else {
  const source = new EventSource('/events');
  const touch = () => { clearTimeout(watchdog); watchdog = setTimeout(hide, 45000); };
  source.addEventListener('overlay', event => {
    touch();
    try { const message = JSON.parse(event.data); render(message.status === 'live' ? normalizeState(message.state) : null); report(message.status); }
    catch { hide(); }
  });
  // Browser transport failure hides stale titles immediately. Server liveness
  // events cover quiet tracks where production metadata only emits comments.
  source.addEventListener('pulse', touch);
  source.onerror = hide;
  window.addEventListener('pagehide', () => { source.close(); clearTimeout(watchdog); });
}
