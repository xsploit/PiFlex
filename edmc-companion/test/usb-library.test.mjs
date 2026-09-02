import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { isPathInside, safePathSegment, UsbLibrary } from "../src/usb-library.mjs";

test("safePathSegment removes path syntax", () => {
    assert.equal(safePathSegment('  Blank Canvas & CHAR: Call/Me?  '), "Blank Canvas & CHAR Call Me");
    assert.equal(safePathSegment("..."), "Unknown");
});

test("isPathInside rejects sibling paths", () => {
    const root = path.resolve("usb");
    assert.equal(isPathInside(root, path.join(root, "Music", "track.mp3")), true);
    assert.equal(isPathInside(root, path.resolve(root, "..", "other", "track.mp3")), false);
});

test("USB library allocates and atomically indexes a portable track", async (context) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "bitedj-edmc-usb-"));
    context.after(() => fs.rm(root, { recursive: true, force: true }));
    const library = new UsbLibrary(root);
    const release = {
        topicId: 708681,
        title: "Blank Canvas & CHAR - Call Me",
        subscriptionName: "Jump-Up",
    };
    const allocation = await library.allocateDownload(release, "moivo1mapbvk", "job-1");
    const finalPath = await library.allocateFinalPath(allocation, ".flac");
    assert.equal(finalPath.endsWith(path.join("Music", "EDMC", "Jump-Up", "Blank Canvas & CHAR - Call Me.flac")), true);
    assert.equal(allocation.partPath.endsWith(path.join(".bitedj", "edmc", "incoming", "job-1.part")), true);

    const entry = {
        providerId: "moivo1mapbvk",
        sha256: "ABC",
        relativePath: library.relativePath(finalPath),
    };
    await library.commitTrack(entry);
    assert.deepEqual((await library.read()).tracks, [entry]);
    assert.deepEqual(await library.findByProviderId("moivo1mapbvk"), entry);
});

test("USB library honors a custom flat download folder", async (context) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "bitedj-edmc-usb-custom-"));
    context.after(() => fs.rm(root, { recursive: true, force: true }));
    const library = new UsbLibrary(root, {
        downloadFolder: "Music/Fresh",
        organizeByGenre: false,
    });
    const allocation = await library.allocateDownload({
        topicId: 1,
        title: "Custom Destination",
        subscriptionName: "Jump-Up",
    }, "provider", "job-custom");
    const finalPath = await library.allocateFinalPath(allocation, ".wav");
    assert.equal(finalPath, path.join(root, "Music", "Fresh", "Custom Destination.wav"));
});

test("USB library rebuilds a zero-byte index from existing state downloads", async (context) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "bitedj-edmc-usb-recover-"));
    context.after(() => fs.rm(root, { recursive: true, force: true }));
    const library = new UsbLibrary(root);
    await library.verifyWritable();
    const relativePath = path.join("Music", "EDMC", "Jump-Up", "Recovered.mp3");
    const absolutePath = path.join(root, relativePath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, Buffer.from("ID3audio"));
    await fs.writeFile(library.libraryPath, "");
    const entry = { providerId: "recovered1", sha256: "ABC", relativePath };

    const result = await library.reconcile([entry]);
    assert.equal(result.recovered, true);
    assert.deepEqual((await library.read()).tracks, [entry]);
});

test("USB library rejects an indexed zero-byte track", async (context) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "bitedj-edmc-usb-zero-"));
    context.after(() => fs.rm(root, { recursive: true, force: true }));
    const library = new UsbLibrary(root);
    await library.verifyWritable();
    const relativePath = path.join("Music", "EDMC", "Jump-Up", "Empty.mp3");
    const absolutePath = path.join(root, relativePath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, "");
    const entry = { providerId: "empty1", bytes: 100, relativePath };
    await library.commitTrack(entry);

    const result = await library.reconcile([entry]);
    assert.deepEqual(result.tracks, []);
    assert.deepEqual((await library.read()).tracks, []);
});
