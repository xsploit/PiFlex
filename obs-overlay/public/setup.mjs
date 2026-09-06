const form = document.querySelector('#options');
window.addEventListener('message', event => {
  if (event.origin !== location.origin || event.source !== document.querySelector('#preview').contentWindow || event.data?.type !== 'bitedj-overlay-status') return;
  const labels = { live: 'Connected to live metadata. Empty overlay means no matching decks.', connecting: 'Connecting to BiteDJ…', offline: 'Metadata unavailable. Check the Pi address and Stream settings.', idle: 'Waiting for metadata…' };
  document.querySelector('#status').textContent = labels[event.data.status] || 'Waiting for metadata…';
});
function update() {
  const data = new FormData(form);
  const p = new URLSearchParams({ mode: data.get('mode'), theme: data.get('theme'), accent: data.get('accent'), details: data.has('details') ? '1' : '0' });
  document.querySelector('#url').value = `${location.origin}/overlay?${p}`;
  if (document.querySelector('#demo').checked) p.set('demo', '1');
  document.querySelector('#status').textContent = p.has('demo') ? 'Example preview only · no live metadata connection' : 'Connecting to BiteDJ…';
  document.querySelector('#preview').src = `/overlay?${p}`;
  try { localStorage.setItem('bitedj-overlay-options-v1', JSON.stringify(Object.fromEntries(data))); } catch {}
}
try {
  const saved = JSON.parse(localStorage.getItem('bitedj-overlay-options-v1') || 'null');
  if (saved) for (const name of ['mode', 'theme', 'accent', 'details']) {
    const field = form.elements.namedItem(name);
    if (field.type === 'checkbox') field.checked = saved[name] === 'on';
    else if (typeof saved[name] === 'string') {
      field.value = name === 'theme' && saved[name] === 'panel' ? 'minimal' : saved[name];
      if (field.tagName === 'SELECT' && !field.value) field.selectedIndex = 0;
    }
  }
} catch {}
form.addEventListener('submit', event => event.preventDefault());
form.addEventListener('input', update); update();
document.querySelector('#copy').onclick = async () => {
  try { await navigator.clipboard.writeText(document.querySelector('#url').value); document.querySelector('#copy').textContent = 'Copied'; }
  catch { document.querySelector('#url').select(); document.querySelector('#copy').textContent = 'Press Ctrl+C'; }
};
// One setup-only health request. Preview/live subscribers use SSE, not polling.
try {
  const health = await fetch('/health').then(res => res.json());
  document.querySelector('#status').textContent = `Bridge ready · source ${health.upstream}. Uncheck example preview to test live data.`;
} catch { document.querySelector('#status').textContent = 'Bridge is not reachable.'; }
