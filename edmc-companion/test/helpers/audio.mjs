import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execute = promisify(execFile);
const cache = new Map();
export function audioFixture(format) {
    if (!cache.has(format)) cache.set(format, generate(format));
    return cache.get(format);
}
async function generate(format) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "edmc-encoded-fixture-"));
    try {
        const filename = path.join(directory, `tone.${format}`);
        await execute("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100",
            "-t", "1", "-ac", "2", filename], { windowsHide: true });
        return await fs.readFile(filename);
    } finally {
        await fs.rm(directory, { recursive: true, force: true });
    }
}
