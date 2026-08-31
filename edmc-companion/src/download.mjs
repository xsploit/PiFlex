import crypto from "node:crypto";
import fs from "node:fs/promises";
import { Transform, Readable, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";

export async function streamAudioDownload({ url, partPath, cookies = [], signal, onProgress = () => {} }) {
    const headers = {
        "user-agent": "Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 Chrome/128 Safari/537.36",
    };
    if (cookies.length > 0) {
        headers.cookie = cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
    }
    const response = await fetch(url, { headers, redirect: "follow", signal });
    if (!response.ok || !response.body) {
        throw new Error(`Download failed with HTTP ${response.status}`);
    }

    const expectedBytes = Number(response.headers.get("content-length")) || null;
    const hash = crypto.createHash("sha256");
    let bytes = 0;
    const meter = new Transform({
        transform(chunk, encoding, callback) {
            bytes += chunk.length;
            hash.update(chunk);
            onProgress(bytes, expectedBytes);
            callback(null, chunk);
        },
    });

    const handle = await fs.open(partPath, "wx", 0o600);
    try {
        let position = 0;
        const output = new Writable({
            write(chunk, encoding, callback) {
                handle.write(chunk, 0, chunk.length, position).then(({ bytesWritten }) => {
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
    } catch (error) {
        await fs.rm(partPath, { force: true });
        throw error;
    } finally {
        await handle.close();
    }

    try {
        const audio = await inspectSupportedAudio(partPath);
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

export async function inspectSupportedAudio(filePath) {
    const handle = await fs.open(filePath, "r");
    try {
        const header = Buffer.alloc(12);
        const { bytesRead } = await handle.read(header, 0, header.length, 0);
        const id3 = bytesRead >= 3 && header.subarray(0, 3).toString("ascii") === "ID3";
        const frameSync = bytesRead >= 2 && header[0] === 0xff && (header[1] & 0xe0) === 0xe0;
        if (id3 || frameSync) {
            return { format: "mp3", extension: ".mp3" };
        }
        if (bytesRead >= 4 && header.subarray(0, 4).toString("ascii") === "fLaC") {
            return { format: "flac", extension: ".flac" };
        }
        if (bytesRead >= 12 &&
                header.subarray(0, 4).toString("ascii") === "RIFF" &&
                header.subarray(8, 12).toString("ascii") === "WAVE") {
            return { format: "wav", extension: ".wav" };
        }
        throw new Error("Downloaded file is not a supported MP3, FLAC, or WAV audio file");
    } finally {
        await handle.close();
    }
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
