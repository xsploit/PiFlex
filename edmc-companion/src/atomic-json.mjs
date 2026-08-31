import fs from "node:fs/promises";
import path from "node:path";

export async function readJson(filePath, fallback) {
    try {
        return JSON.parse(await fs.readFile(filePath, "utf8"));
    } catch (error) {
        if (error.code === "ENOENT") {
            return structuredClone(fallback);
        }
        // Removable media can be unplugged after the directory entry is
        // created but before its contents reach the device. Prefer the last
        // fully parsed snapshot rather than turning one zero-byte index into a
        // permanent download failure.
        try {
            return JSON.parse(await fs.readFile(`${filePath}.bak`, "utf8"));
        } catch {
            throw error;
        }
    }
}

export async function writeJsonAtomic(filePath, value) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    const handle = await fs.open(temporaryPath, "wx", 0o600);
    try {
        await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
        await handle.sync();
    } finally {
        await handle.close();
    }

    try {
        // Preserve only a known-good previous generation. Never replace the
        // backup with a truncated or otherwise invalid primary file.
        try {
            JSON.parse(await fs.readFile(filePath, "utf8"));
            const backupTemporaryPath = `${filePath}.bak.${process.pid}.${Date.now()}.tmp`;
            await fs.copyFile(filePath, backupTemporaryPath);
            await fs.rename(backupTemporaryPath, `${filePath}.bak`);
        } catch {
            // First write or corrupt primary: the new validated snapshot below
            // becomes the recovery point.
        }
        await fs.rename(temporaryPath, filePath);
        // Best-effort directory sync makes the rename durable on Linux. Some
        // removable filesystems reject fsync on directories, so that case is
        // deliberately non-fatal.
        const directoryHandle = await fs.open(path.dirname(filePath), "r").catch(() => null);
        if (directoryHandle) {
            try {
                await directoryHandle.sync();
            } catch {
                // Unsupported by this filesystem.
            } finally {
                await directoryHandle.close();
            }
        }
    } catch (error) {
        await fs.rm(temporaryPath, { force: true });
        throw error;
    }
}
