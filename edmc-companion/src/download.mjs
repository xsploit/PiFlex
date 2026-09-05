import crypto from "node:crypto";
import fs from "node:fs/promises";
import { Transform, Readable, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { probeAudio } from "./audio-probe.mjs";

export async function streamAudioDownload(options) {
    const controller = new AbortController();
    const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
    let timer;
    const arm = (ms) => {
        clearTimeout(timer);
        timer = setTimeout(() => controller.abort(new Error("Download stalled; please retry")), ms);
    };
    arm(options.connectTimeoutMs ?? 30_000);
    try {
        return await streamDownload({ ...options, signal,
            activity: () => arm(options.idleTimeoutMs ?? 30_000),
            transferFinished: () => clearTimeout(timer) });
    } finally {
        clearTimeout(timer);
    }
}

async function streamDownload({ url, partPath, cookies = [], signal, activity, transferFinished, onProgress = () => {}, checkStorage = async () => {} }) {
    const headers = {
        "user-agent": "Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 Chrome/128 Safari/537.36",
    };
    if (cookies.length > 0) {
        headers.cookie = cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
    }
    const response = await fetch(url, { headers, redirect: "follow", signal });
    activity();
    if (!response.ok || !response.body) {
        await response.body?.cancel();
        throw new Error(`Download failed with HTTP ${response.status}`);
    }

    const expectedBytes = Number(response.headers.get("content-length")) || null;
    try {
        await checkStorage(expectedBytes || 0);
    } catch (error) {
        await response.body.cancel();
        throw error;
    }
    const hash = crypto.createHash("sha256");
    let bytes = 0;
    let lastProgress = 0;
    const meter = new Transform({
        transform(chunk, encoding, callback) {
            bytes += chunk.length;
            hash.update(chunk);
            activity();
            if (Date.now() - lastProgress >= 200) {
                onProgress(bytes, expectedBytes);
                lastProgress = Date.now();
            }
            callback(null, chunk);
        },
    });

    let handle;
    try { handle = await fs.open(partPath, "wx", 0o600); }
    catch (error) { await response.body.cancel(); throw error; }
    try {
        let position = 0;
        let lastStorageCheck = 0;
        const output = new Writable({
            write(chunk, encoding, callback) {
                (async () => {
                    if (Date.now() - lastStorageCheck > 1000) {
                        await checkStorage(Math.max(0, (expectedBytes || 0) - position));
                        lastStorageCheck = Date.now();
                    }
                    return handle.write(chunk, 0, chunk.length, position);
                })().then(({ bytesWritten }) => {
                    if (bytesWritten !== chunk.length) {
                        callback(new Error("Short write while saving the download"));
                        return;
                    }
                    position += bytesWritten;
                    callback();
                }, callback);
            },
        });
        await pipeline(Readable.fromWeb(response.body), meter, output, { signal });
        await handle.sync();
        onProgress(bytes, expectedBytes);
        transferFinished();
    } catch (error) {
        await handle.close();
        await fs.rm(partPath, { force: true });
        throw error;
    } finally {
        await handle.close();
    }

    try {
        const audio = await inspectSupportedAudio(partPath, { signal });
        return {
            bytes,
            sha256: hash.digest("hex").toUpperCase(),
            contentType: response.headers.get("content-type"),
            ...audio,
        };
    } catch (error) {
        await fs.rm(partPath, { force: true });
        throw error;
    }
}

export async function inspectSupportedAudio(filePath, options) {
    const audio = await inspectAudioSignature(filePath);
    if (audio.format === "wav") {
        const handle = await fs.open(filePath, "r");
        try {
            const header = Buffer.alloc(12);
            await handle.read(header, 0, 12, 0);
            const size = (await handle.stat()).size;
            if (header.readUInt32LE(4) + 8 > size) {
                throw new Error("Downloaded WAV audio is truncated");
            }
        } finally { await handle.close(); }
    }
    return { ...audio, ...await probeAudio(filePath, audio.format, options) };
}

// Cheap inventory/rename check ONLY. New downloads must pass the full probe.
export async function inspectAudioSignature(filePath) {
    const handle = await fs.open(filePath, "r");
    let format;
    try {
        const header = Buffer.alloc(12);
        const { bytesRead } = await handle.read(header, 0, header.length, 0);
        const id3 = bytesRead >= 3 && header.subarray(0, 3).toString("ascii") === "ID3";
        const frameSync = bytesRead >= 4 && header[0] === 0xff && (header[1] & 0xe0) === 0xe0 &&
            (header[1] & 0x06) === 0x02 && (header[1] & 0x18) !== 0x08;
        if (id3 || frameSync) {
            format = "mp3";
        }
        if (bytesRead >= 4 && header.subarray(0, 4).toString("ascii") === "fLaC") {
            format = "flac";
        }
        if (bytesRead >= 12 &&
                header.subarray(0, 4).toString("ascii") === "RIFF" &&
                header.subarray(8, 12).toString("ascii") === "WAVE") {
            format = "wav";
        }
        if (!format) throw new Error("Downloaded file is not a supported MP3, FLAC, or WAV audio file");
    } finally {
        await handle.close();
    }
    return { format, extension: `.${format}` };
}

export async function assertSupportedAudio(filePath) {
    return inspectSupportedAudio(filePath);
}

// Compatibility for older callers while the companion API migrates.
export const streamMp3Download = streamAudioDownload;
export async function assertMp3(filePath) {
    const audio = await inspectSupportedAudio(filePath);
    if (audio.format !== "mp3") {
        throw new Error("Downloaded file does not have an MP3 header");
    }
}
