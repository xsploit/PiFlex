import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { streamAudioDownload, inspectSupportedAudio } from "../src/download.mjs";
import { audioFixture } from "./helpers/audio.mjs";

test("MP3 download streams to a part file and reports its hash", async (context) => {
    const payload = await audioFixture("mp3");
    const server = http.createServer((request, response) => {
        response.writeHead(200, {
            "content-type": "audio/mpeg",
            "content-length": payload.length,
        });
        response.end(payload);
    });
    await listen(server);
    context.after(() => new Promise((resolve) => server.close(resolve)));

    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "bitedj-edmc-download-"));
    context.after(() => fs.rm(directory, { recursive: true, force: true }));
    const partPath = path.join(directory, "track.part");
    const address = server.address();
    const result = await streamAudioDownload({
        url: `http://127.0.0.1:${address.port}/track.mp3`,
        partPath,
    });

    assert.equal(result.bytes, payload.length);
    assert.equal(result.format, "mp3");
    assert.equal(result.extension, ".mp3");
    assert.equal(result.sha256, crypto.createHash("sha256").update(payload).digest("hex").toUpperCase());
    assert.deepEqual(await fs.readFile(partPath), payload);
});

test("invalid media is rejected and its part file is removed", async (context) => {
    const server = http.createServer((request, response) => response.end("not an mp3"));
    await listen(server);
    context.after(() => new Promise((resolve) => server.close(resolve)));

    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "bitedj-edmc-invalid-"));
    context.after(() => fs.rm(directory, { recursive: true, force: true }));
    const partPath = path.join(directory, "bad.part");
    const address = server.address();
    await assert.rejects(
        streamAudioDownload({ url: `http://127.0.0.1:${address.port}/bad`, partPath }),
        /supported MP3, FLAC, or WAV/,
    );
    await assert.rejects(fs.access(partPath), { code: "ENOENT" });
});

for (const [format, extension] of [
    ["flac", ".flac"],
    ["wav", ".wav"],
]) {
    test(`${format.toUpperCase()} download is detected from its bytes`, async (context) => {
        const payload = await audioFixture(format);
        const server = http.createServer((request, response) => response.end(payload));
        await listen(server);
        context.after(() => new Promise((resolve) => server.close(resolve)));
        const directory = await fs.mkdtemp(path.join(os.tmpdir(), `bitedj-edmc-${format}-`));
        context.after(() => fs.rm(directory, { recursive: true, force: true }));
        const result = await streamAudioDownload({
            url: `http://127.0.0.1:${server.address().port}/track`,
            partPath: path.join(directory, "track.part"),
        });
        assert.equal(result.format, format);
        assert.equal(result.extension, extension);
        assert.equal(result.sampleRate, 44100);
        assert.equal(result.channels, 2);
        assert(result.duration > 0);
    });
}

test("signature-only files and AAC are never accepted as MP3/FLAC/WAV", async t => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "edmc-bad-audio-"));
    t.after(() => fs.rm(dir, { recursive: true, force: true }));
    for (const bytes of [Buffer.from("ID3"), Buffer.from("fLaC"), Buffer.from("RIFF0000WAVE"),
        Buffer.from([0xff, 0xf1, 0x50, 0x80, 0, 0xff, 0xfc]), await audioFixture("aac")]) {
        const filename = path.join(dir, "bad.part");
        await fs.writeFile(filename, bytes);
        await assert.rejects(inspectSupportedAudio(filename), /audio|supported/);
    }
});

test("idle timeout aborts the transfer and removes its partial file", async t => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "edmc-idle-"));
    t.after(() => fs.rm(dir, { recursive: true, force: true }));
    const server = http.createServer((req, res) => { res.writeHead(200); res.write("ID3"); });
    await listen(server);
    t.after(() => { server.closeAllConnections(); server.close(); });
    const filename = path.join(dir, "stalled.part");
    await assert.rejects(streamAudioDownload({ url: `http://127.0.0.1:${server.address().port}/`,
        partPath: filename, idleTimeoutMs: 50 }), /abort|stalled/i);
    await assert.rejects(fs.access(filename), { code: "ENOENT" });
});

test("truncated WAV payload fails even if some packets are still readable", async t => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "edmc-truncated-wav-"));
    t.after(() => fs.rm(dir, { recursive: true, force: true }));
    const payload = await audioFixture("wav");
    const filename = path.join(dir, "cut.wav");
    await fs.writeFile(filename, payload.subarray(0, Math.floor(payload.length / 2)));
    await assert.rejects(inspectSupportedAudio(filename), /truncated/);
});

test("connection/header timeout stops a server that never sends headers", async t => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "edmc-no-headers-"));
    t.after(() => fs.rm(dir, { recursive: true, force: true }));
    const server = http.createServer(()=>{});
    await listen(server);
    t.after(() => { server.closeAllConnections(); server.close(); });
    const filename = path.join(dir, "pending.part");
    await assert.rejects(streamAudioDownload({ url:`http://127.0.0.1:${server.address().port}/`,
        partPath:filename, connectTimeoutMs:50 }), /stalled/);
    await assert.rejects(fs.access(filename), {code:"ENOENT"});
});

test("malformed audio is removed after transfer, not marked ready", async t => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "edmc-bad-stream-"));
    t.after(() => fs.rm(dir, { recursive: true, force: true }));
    const server = http.createServer((req, res) => res.end("fLaC"));
    await listen(server);
    t.after(() => new Promise(resolve => server.close(resolve)));
    const filename = path.join(dir, "bad.part");
    await assert.rejects(streamAudioDownload({ url: `http://127.0.0.1:${server.address().port}/`, partPath: filename }), /audio/);
    await assert.rejects(fs.access(filename), { code: "ENOENT" });
});

test("probe reads pinned Linux storage paths through an inherited descriptor", { skip: process.platform !== "linux" }, async t => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "edmc-probe-fd-"));
    t.after(() => fs.rm(dir, { recursive: true, force: true }));
    await fs.writeFile(path.join(dir, "track.wav"), await audioFixture("wav"));
    const handle = await fs.open(dir, "r");
    try {
        const result = await inspectSupportedAudio(`/proc/self/fd/${handle.fd}/track.wav`);
        assert.equal(result.format, "wav");
        assert.equal(result.channels, 2);
    } finally { await handle.close(); }
});

function listen(server) {
    return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
    });
}
