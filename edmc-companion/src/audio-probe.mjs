import fs from "node:fs/promises";
import { spawn } from "node:child_process";

// Probe packet structure, not a full decode/analysis competing with the decks.
// The command is fixed; labels and filenames never become shell commands.
export async function probeAudio(filePath, format, { signal, timeoutMs = 30_000 } = {}) {
    signal?.throwIfAborted();
    const handle = await fs.open(filePath, "r");
    try {
        // Linux storage paths may live below a pinned /proc/self/fd directory.
        // Inherit the already-open file rather than resolving that path in a
        // child process (or reopening a potentially replaced mountpoint).
        const inherited = process.platform === "linux";
        const output = await runProbe([
            "-v", "error", "-protocol_whitelist", "file", "-f", format,
            "-count_packets", "-show_error", "-show_entries",
            "stream=codec_name,codec_type,sample_rate,channels,duration,nb_read_packets:format=format_name,duration,bit_rate",
            "-of", "json", "-i", inherited ? "/proc/self/fd/3" : filePath,
        ], { signal, timeoutMs, fd: inherited ? handle.fd : undefined });
        const data = JSON.parse(output);
        const audio = data.streams?.find((s) => s.codec_type === "audio");
        const codec = audio?.codec_name || "";
        const supported = format === "mp3" ? codec === "mp3" :
            format === "flac" ? codec === "flac" : /^(pcm_|adpcm_)/.test(codec);
        const duration = Number(audio?.duration || data.format?.duration);
        const sampleRate = Number(audio?.sample_rate);
        const channels = Number(audio?.channels);
        if (data.error || !supported || !(Number(audio?.nb_read_packets) > 0) ||
                !Number.isFinite(duration) || duration <= 0 ||
                !Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 768000 ||
                !Number.isInteger(channels) || channels < 1 || channels > 32) {
            throw new Error("Downloaded audio has no valid supported audio stream");
        }
        return { codec, duration, sampleRate, channels,
            bitrate: Number(data.format?.bit_rate) || null };
    } finally {
        await handle.close();
    }
}

let availability;
export function ensureAudioProbe() {
    availability ||= runProbe(["-version"], { timeoutMs: 5000 }).catch((error) => {
        availability = null;
        throw error;
    });
    return availability;
}

function runProbe(args, { signal, timeoutMs, fd } = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(process.env.BITEDJ_EDMC_FFPROBE || "ffprobe", args, {
            windowsHide: true, signal,
            stdio: fd === undefined ? ["ignore", "pipe", "pipe"] : ["ignore", "pipe", "pipe", fd],
        });
        let stdout = "", stderr = "", failure;
        const timer = setTimeout(() => {
            failure = new Error("Audio validation timed out");
            child.kill("SIGKILL");
        }, timeoutMs);
        const collect = (stream, isError) => stream.on("data", (chunk) => {
            if (isError) stderr += chunk; else stdout += chunk;
            if (stdout.length + stderr.length > 262144) {
                failure = new Error("Audio validation output exceeded its limit");
                child.kill("SIGKILL");
            }
        });
        collect(child.stdout, false); collect(child.stderr, true);
        child.on("error", (error) => {
            failure = error.code === "ENOENT" ?
                new Error("Audio validation requires ffprobe; install the ffmpeg runtime package") : error;
        });
        child.on("close", (code) => {
            clearTimeout(timer);
            if (failure) reject(failure);
            else if (code !== 0 || stderr.trim()) reject(new Error("Downloaded audio is invalid or incomplete"));
            else resolve(stdout);
        });
    });
}
