import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { Companion } from "../src/companion.mjs";
import { createDefaultState } from "../src/default-state.mjs";

test("companion persists download settings in status", async (context) => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "bitedj-edmc-data-"));
    const usbRoot = await fs.mkdtemp(path.join(os.tmpdir(), "bitedj-edmc-destination-"));
    context.after(() => Promise.all([
        fs.rm(dataDir, { recursive: true, force: true }),
        fs.rm(usbRoot, { recursive: true, force: true }),
    ]));

    const companion = new Companion({
        dataDir,
        chromiumExecutable: "not-launched-by-this-test",
        origin: "http://127.0.0.1:17642",
        storageOptions: { pin: false, enumerate: async () => [{ rootPath: usbRoot, id: "test-usb", instance: "test-usb:1", kind: "usb", writable: true }] },
    });
    await companion.initialize();
    await companion.setStorage(usbRoot);
    await companion.setSettings({
        downloadFolder: "Music/Downloads",
        organizeByGenre: false,
    });

    assert.deepEqual(companion.status().settings, {
        downloadFolder: "Music/Downloads",
        organizeByGenre: false,
        fallbackToSd: true,
    });
});

test("parser migration invalidates stale options once and preserves downloaded files", async t => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "edmc-parser-migrate-"));
    t.after(()=>fs.rm(dataDir, { recursive:true, force:true }));
    const state = createDefaultState();
    const download = { providerId:"known", relativePath:"Music/track.mp3", storageId:"offline-usb" };
    state.releases = [{ topicId:42, download, providers:[{providerId:"known",label:"Wrong old label"}], resolvedAt:new Date().toISOString() }];
    state.catalog = [{name:"Old menu",genres:[]}];
    await fs.writeFile(path.join(dataDir,"state.json"), JSON.stringify(state));
    const c = new Companion({ dataDir, chromiumExecutable:"unused" });
    c.refreshStorage = async()=>{}; // This test concerns migration, not drive mounting.
    await c.initialize();
    assert.deepEqual(c.findRelease(42).download, download);
    assert.deepEqual(c.findRelease(42).providers, []);
    assert.deepEqual(c.catalog(), []);
    await c.stateStore.update(s=>{s.releases[0].providers=[{providerId:"fresh",label:"WAV"}];});
    await c.initialize();
    assert.equal(c.findRelease(42).providers[0].label,"WAV");
});
