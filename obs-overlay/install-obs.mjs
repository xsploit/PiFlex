// Optional Windows installer using OBS's bundled WebSocket v5 interface.
// No stream/record start, scene switch, credential output, or config-file edits.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const configPath = process.env.OBS_WEBSOCKET_CONFIG || `${process.env.APPDATA}/obs-studio/plugin_config/obs-websocket/config.json`;
const sourceName = 'BiteDJ - Now Playing';
const port = Number(process.env.BITEDJ_OVERLAY_PORT || 8795);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid overlay port');
const url = `http://127.0.0.1:${port}/overlay`;
const config = JSON.parse(await readFile(configPath, 'utf8'));
const socket = new WebSocket(`ws://127.0.0.1:${config.server_port}`);
const hash = s => createHash('sha256').update(s).digest('base64');
const pending = new Map(); let count = 0;
function call(requestType, requestData = {}) {
  return new Promise((resolve, reject) => {
    const requestId = String(++count);
    const timer = setTimeout(() => { pending.delete(requestId); reject(new Error(`${requestType} timed out`)); }, 8000);
    pending.set(requestId, { resolve, reject, timer });
    socket.send(JSON.stringify({ op: 6, d: { requestType, requestId, requestData } }));
  });
}
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('OBS connection timed out')), 8000);
    socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('OBS WebSocket unavailable. Open OBS and enable its WebSocket server.')); });
    socket.addEventListener('close', () => {
      clearTimeout(timer); reject(new Error('OBS disconnected before identification'));
      for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(new Error('OBS disconnected')); } pending.clear();
    });
    socket.addEventListener('message', event => {
      const m = JSON.parse(event.data);
      if (m.op === 0) {
        const auth = m.d.authentication;
        socket.send(JSON.stringify({ op: 1, d: { rpcVersion: 1, eventSubscriptions: 0,
          ...(auth ? { authentication: hash(hash(config.server_password + auth.salt) + auth.challenge) } : {}) } }));
      }
      if (m.op === 2) { clearTimeout(timer); resolve(); }
      if (m.op === 7) {
        const entry = pending.get(m.d.requestId);
        if (entry) { pending.delete(m.d.requestId); clearTimeout(entry.timer);
          if (m.d.requestStatus.result) entry.resolve(m.d.responseData || {});
          else entry.reject(new Error(`${m.d.requestType}: ${m.d.requestStatus.comment || 'failed'}`));
        }
      }
    });
  });
  const sceneName = (await call('GetSceneList')).currentProgramSceneName;
  const inputs = (await call('GetInputList')).inputs;
  if (process.argv.includes('--inspect')) {
    console.log(JSON.stringify({ sceneName, installed: inputs.some(i => i.inputName === sourceName), url }));
  } else {
    const health = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(3000) });
    if (!health.ok) throw new Error('Start the overlay bridge first');
    if ((await call('GetStreamStatus')).outputActive || (await call('GetRecordStatus')).outputActive) throw new Error('Stop streaming/recording before adding the overlay');
    if (inputs.some(i => i.inputName === sourceName)) {
      console.log('BiteDJ source already exists; settings and position preserved. Add Existing in another scene if needed.');
    } else {
      const video = await call('GetVideoSettings');
      const inputSettings = { url, width: 900, height: 320, fps: 30,
        is_local_file: false, shutdown: true, restart_when_active: false };
      const created = await call('CreateInput', { sceneName, inputName: sourceName, inputKind: 'browser_source', inputSettings, sceneItemEnabled: false });
      const scale = Math.min(1, video.baseWidth / 1200, video.baseHeight / 700);
      await call('SetSceneItemTransform', { sceneName, sceneItemId: created.sceneItemId,
        sceneItemTransform: { positionX: 24, positionY: Math.max(0, video.baseHeight - 320 * scale - 24), scaleX: scale, scaleY: scale } });
      await call('SetSceneItemEnabled', { sceneName, sceneItemId: created.sceneItemId, sceneItemEnabled: true });
      console.log(`Added ${sourceName} to ${sceneName}. Existing sources were not changed. No output started.`);
    }
  }
} finally { socket.close(); }
