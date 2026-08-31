import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { streamAudioDownload } from "../src/download.mjs";

test("MP3 download streams to a part file and reports its hash", async (context) => {
    const payload = Buffer.concat([Buffer.from("ID3"), Buffer.alloc(128 * 1024, 0x5a)]);
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

for (const [format, extension, payload] of [
    ["flac", ".flac", Buffer.concat([Buffer.from("fLaC"), Buffer.alloc(128, 0x11)])],
    ["wav", ".wav", Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WAVE"), Buffer.alloc(128, 0x22)])],
]) {
    test(`${format.toUpperCase()} download is detected from its bytes`, async (context) => {
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
    });
}

function listen(server) {
    return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
    });
}
