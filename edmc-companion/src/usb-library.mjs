import fs from "node:fs/promises";
import path from "node:path";

import { readJson, writeJsonAtomic } from "./atomic-json.mjs";
import { assertSupportedAudio } from "./download.mjs";

const EMPTY_LIBRARY = Object.freeze({ version: 1, updatedAt: null, tracks: [] });

export function safePathSegment(value, fallback = "Unknown") {
    const cleaned = String(value || "")
        .normalize("NFKC")
        .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
        .replace(/\s+/g, " ")
        .replace(/[. ]+$/g, "")
        .trim();
    return (cleaned || fallback).slice(0, 120);
}

export function isPathInside(rootPath, candidatePath) {
    const relative = path.relative(path.resolve(rootPath), path.resolve(candidatePath));
    return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
}

export class UsbLibrary {
    constructor(rootPath = null) {
        this.rootPath = rootPath ? path.resolve(rootPath) : null;
    }

    setRoot(rootPath) {
        this.rootPath = path.resolve(rootPath);
    }

    requireRoot() {
        if (!this.rootPath) {
            throw new Error("Select a USB root first");
        }
        return this.rootPath;
    }

    get metadataRoot() {
        return path.join(this.requireRoot(), ".bitedj", "edmc");
    }

    get incomingRoot() {
        return path.join(this.metadataRoot, "incoming");
    }

    get libraryPath() {
        return path.join(this.metadataRoot, "library.json");
    }

    async verifyWritable() {
        const root = this.requireRoot();
        const stats = await fs.stat(root);
        if (!stats.isDirectory()) {
            throw new Error(`USB root is not a directory: ${root}`);
        }
        await fs.access(root, fs.constants.R_OK | fs.constants.W_OK);
        await fs.mkdir(this.incomingRoot, { recursive: true });
        return root;
    }

    async read() {
        const library = await readJson(this.libraryPath, EMPTY_LIBRARY);
        if (library?.version !== 1 || !Array.isArray(library.tracks)) {
            throw new Error(`Unsupported EDMC USB library at ${this.libraryPath}`);
        }
        return library;
    }

    async reconcile(downloadEntries = []) {
        const root = this.requireRoot();
        let library;
        let recovered = false;
        try {
            library = await this.read();
        } catch (error) {
            if (!(error instanceof SyntaxError)) {
                throw error;
            }
            const corruptPath = `${this.libraryPath}.corrupt-${Date.now()}`;
            await fs.rename(this.libraryPath, corruptPath).catch(() => undefined);
            library = structuredClone(EMPTY_LIBRARY);
            recovered = true;
        }

        const tracksByProvider = new Map();
        const candidatesByProvider = new Map(
            library.tracks
                .filter((track) => track?.providerId)
                .map((track) => [track.providerId, track]),
        );
        for (const entry of downloadEntries.filter(Boolean)) {
            if (entry.providerId) {
                candidatesByProvider.set(entry.providerId, entry);
            }
        }
        for (const entry of candidatesByProvider.values()) {
            const absolutePath = path.resolve(root, entry.relativePath || "");
            if (!entry.relativePath || !isPathInside(root, absolutePath)) {
                continue;
            }
            try {
                const stats = await fs.stat(absolutePath);
                if (!stats.isFile() || stats.size <= 0 ||
                        (Number(entry.bytes) > 0 && stats.size !== Number(entry.bytes))) {
                    continue;
                }
                await assertSupportedAudio(absolutePath);
            } catch {
                continue;
            }
            tracksByProvider.set(entry.providerId, entry);
        }

        const tracks = [...tracksByProvider.values()];
        if (recovered || JSON.stringify(tracks) !== JSON.stringify(library.tracks)) {
            await writeJsonAtomic(this.libraryPath, {
                version: 1,
                updatedAt: new Date().toISOString(),
                tracks,
            });
        }
        return { recovered, tracks };
    }

    async finalizeDownload(partPath, finalPath, expectedBytes) {
        await fs.rename(partPath, finalPath);
        const handle = await fs.open(finalPath, "r");
        try {
            const stats = await handle.stat();
            if (stats.size <= 0 || stats.size !== expectedBytes) {
                throw new Error(
                    `Downloaded file size changed while committing to USB (${stats.size}/${expectedBytes})`,
                );
            }
            await handle.sync();
        } catch (error) {
            await fs.rm(finalPath, { force: true });
            throw error;
        } finally {
            await handle.close();
        }
        try {
            await assertSupportedAudio(finalPath);
        } catch (error) {
            await fs.rm(finalPath, { force: true });
            throw error;
        }

        // Make the filename/rename durable as well as the file contents. This
        // matters on removable exFAT media if the Pi is powered down soon after
        // a download finishes.
        const directoryHandle = await fs.open(path.dirname(finalPath), "r").catch(() => null);
        if (directoryHandle) {
            try {
                await directoryHandle.sync();
            } catch {
                // Unsupported by this filesystem.
            } finally {
                await directoryHandle.close();
            }
        }
    }

    async findByProviderId(providerId) {
        const library = await this.read();
        return library.tracks.find((track) => track.providerId === providerId) || null;
    }

    async allocateDownload(release, providerId, jobId) {
        await this.verifyWritable();
        const subsectionName = safePathSegment(release.subscriptionName, "EDMC");
        const finalDirectory = path.join(this.requireRoot(), "Music", "EDMC", subsectionName);
        await fs.mkdir(finalDirectory, { recursive: true });

        const partPath = path.join(this.incomingRoot, `${safePathSegment(jobId, "download")}.part`);
        if (!isPathInside(this.requireRoot(), finalDirectory) || !isPathInside(this.requireRoot(), partPath)) {
            throw new Error("Resolved download path escaped the selected USB root");
        }
        return {
            partPath,
            finalDirectory,
            baseName: safePathSegment(release.title, `EDMC-${release.topicId}`),
            providerId,
        };
    }

    async allocateFinalPath(allocation, extension) {
        if (![".mp3", ".flac", ".wav"].includes(extension)) {
            throw new Error(`Unsupported audio extension: ${extension}`);
        }
        let finalPath = path.join(allocation.finalDirectory, `${allocation.baseName}${extension}`);
        let suffix = 2;
        while (await exists(finalPath)) {
            finalPath = path.join(allocation.finalDirectory, `${allocation.baseName} (${suffix})${extension}`);
            suffix += 1;
        }
        if (!isPathInside(this.requireRoot(), finalPath)) {
            throw new Error("Resolved download path escaped the selected USB root");
        }
        return finalPath;
    }

    async commitTrack(entry) {
        const library = await this.read();
        const withoutDuplicate = library.tracks.filter(
            (track) => track.providerId !== entry.providerId && track.sha256 !== entry.sha256,
        );
        const next = {
            version: 1,
            updatedAt: new Date().toISOString(),
            tracks: [...withoutDuplicate, entry],
        };
        await writeJsonAtomic(this.libraryPath, next);
        return entry;
    }

    relativePath(filePath) {
        if (!isPathInside(this.requireRoot(), filePath)) {
            throw new Error("Track path is outside the selected USB root");
        }
        return path.relative(this.requireRoot(), filePath).split(path.sep).join("/");
    }
}

async function exists(filePath) {
    try {
        await fs.access(filePath);
        return true;
    } catch (error) {
        if (error.code === "ENOENT") {
            return false;
        }
        throw error;
    }
}
