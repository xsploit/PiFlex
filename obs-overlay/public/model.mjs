// Shared validation/selection contract. Never render untrusted metadata as HTML.
export function normalizeState(input) {
  if (input?.version !== 1 || !Array.isArray(input.decks) || input.decks.length > 8) {
    throw new Error('Unsupported BiteDJ metadata schema');
  }
  const text = value => typeof value === 'string' ? value.slice(0, 512) : '';
  const seen = new Set();
  const decks = input.decks.map(d => {
    if (!d || !/^\[Channel[1-8]\]$/.test(d.group) || seen.has(d.group)) {
      throw new Error('Invalid or duplicate deck');
    }
    seen.add(d.group);
    const loaded = d.loaded === true;
    const playing = d.playing === true;
    const fader = Number.isFinite(d.channel_fader) ? Math.max(0, Math.min(1, d.channel_fader)) : 0;
    return { group: d.group, loaded, playing, channel_fader: fader, main_mix: d.main_mix === true,
      on_air_candidate: loaded && playing && fader > 0.0001 && d.main_mix === true && d.on_air_candidate === true,
      title: text(d.title), artist: text(d.artist), key: text(d.key),
      bpm: Number.isFinite(d.bpm) && d.bpm > 0 && d.bpm < 1000 ? d.bpm : null };
  });
  return { version: 1, decks };
}

export function selectDecks(state, mode = 'mix') {
  const decks = (state?.decks ?? []).filter(d => d.loaded);
  if (mode === 'loaded') return decks;
  if (/^deck[1-8]$/.test(mode)) return decks.filter(d => d.group === `[Channel${mode.slice(4)}]`);
  const active = decks.filter(d => d.on_air_candidate);
  if (mode === 'dominant') {
    // Stable tie-break by deck number, never by fluctuating update arrival order.
    return active.sort((a, b) => b.channel_fader - a.channel_fader || a.group.localeCompare(b.group)).slice(0, 1);
  }
  return active.sort((a, b) => a.group.localeCompare(b.group));
}

export function optionsFrom(search) {
  const p = new URLSearchParams(search);
  const modes = ['mix', 'dominant', 'loaded', 'deck1', 'deck2', 'deck3', 'deck4'];
  return { mode: modes.includes(p.get('mode')) ? p.get('mode') : 'mix',
    accent: /^#[0-9a-f]{6}$/i.test(p.get('accent') ?? '') ? p.get('accent') : '#67ead4',
    theme: p.get('theme') === 'glass' ? 'glass' : 'minimal',
    details: p.get('details') !== '0', demo: p.get('demo') === '1' };
}
