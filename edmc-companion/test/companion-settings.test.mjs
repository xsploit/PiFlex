import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { Companion } from "../src/companion.mjs";

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
    });
});
