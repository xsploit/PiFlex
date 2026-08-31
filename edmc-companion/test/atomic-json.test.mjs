import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { readJson, writeJsonAtomic } from "../src/atomic-json.mjs";

test("atomic JSON round trips without leftover temporary files", async (context) => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "bitedj-edmc-json-"));
    context.after(() => fs.rm(directory, { recursive: true, force: true }));
    const filePath = path.join(directory, "library.json");
    await writeJsonAtomic(filePath, { version: 1, tracks: [1] });
    assert.deepEqual(await readJson(filePath, null), { version: 1, tracks: [1] });
    assert.deepEqual(await fs.readdir(directory), ["library.json"]);
});

test("atomic JSON keeps and reads the last valid generation", async (context) => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "bitedj-edmc-json-backup-"));
    context.after(() => fs.rm(directory, { recursive: true, force: true }));
    const filePath = path.join(directory, "library.json");
    await writeJsonAtomic(filePath, { version: 1, tracks: ["first"] });
    await writeJsonAtomic(filePath, { version: 1, tracks: ["second"] });
    await fs.writeFile(filePath, "", "utf8");
    assert.deepEqual(await readJson(filePath, null), { version: 1, tracks: ["first"] });
});
