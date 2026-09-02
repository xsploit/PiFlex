import assert from "node:assert/strict";
import test from "node:test";

import { normalizeDownloadFolder, normalizeSettings } from "../src/settings.mjs";

test("download folder accepts a safe USB-relative path", () => {
    assert.equal(normalizeDownloadFolder(" Music\\Fresh Tracks/EDMC "), "Music/Fresh Tracks/EDMC");
});

test("download folder rejects absolute and parent paths", () => {
    assert.throws(() => normalizeDownloadFolder("/media/usb/Music"), /relative folder/);
    assert.throws(() => normalizeDownloadFolder("Music/../Elsewhere"), /relative folder/);
});

test("partial settings updates retain the other current value", () => {
    assert.deepEqual(
        normalizeSettings({ organizeByGenre: false }, {
            downloadFolder: "Music/Downloads",
            organizeByGenre: true,
        }),
        { downloadFolder: "Music/Downloads", organizeByGenre: false },
    );
});
