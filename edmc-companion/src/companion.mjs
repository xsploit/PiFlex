import fs from "node:fs/promises";
import path from "node:path";

import { BrowserSession } from "./browser-session.mjs";
import { APP_VERSION, API_VERSION } from "./config.mjs";
import { streamAudioDownload, inspectSupportedAudio } from "./download.mjs";
import { ensureAudioProbe } from "./audio-probe.mjs";
import { JobQueue } from "./job-queue.mjs";
import { normalizeSettings } from "./settings.mjs";
import { StateStore } from "./state-store.mjs";
import { UsbLibrary } from "./usb-library.mjs";
import { Storage } from "./storage.mjs";
import { assertProviderId, readFileMetadata, resolveOfficialDownload } from "./providers/beatexs.mjs";
import { assertEdmcGenreUrl, readGenreListing, readGenrePage, readMusicCatalog, readMusicSearch, readRelease } from "./providers/edmc.mjs";

const AUTH_PROBE_URL = "https://edmc.to/genre/jump-up-145/";

export class Companion {
    constructor({ dataDir, chromiumExecutable, usbRoot = null, origin, storageOptions }) {
        this.dataDir = dataDir;
        this.origin = origin;
        this.stateStore = new StateStore(dataDir);
        this.usbLibrary = new UsbLibrary(usbRoot);
        this.storage = new Storage(dataDir, storageOptions);
        this.initialRoot = usbRoot;
        this.activeVolume = null;
        this.storageMessage = "";
        this.storageBusy = false;
        this.activeDownload = null;
        this.browser = new BrowserSession({
            executablePath: chromiumExecutable,
            profileDirectory: path.join(dataDir, "chromium-profile"),
        });
        this.jobs = new JobQueue();
    }

    async initialize() {
        const state = await this.stateStore.load();
        if (state.providerSchemaVersion !== 2) {
            // Re-resolve stale labels once; keep all downloaded-track metadata.
            await this.stateStore.update((s) => {
                for (const release of s.releases) {
                    release.providers = [];
                    delete release.resolvedAt;
                }
                s.catalog = [];
                s.providerSchemaVersion = 2;
            });
        }
        this.usbLibrary.setSettings(state.settings);
        // A missing remembered drive must not prevent the HTTP server starting.
        if (this.initialRoot) {
            await this.stateStore.update((s) => { s.usbRoot = this.initialRoot; s.storageId = null; });
        }
        await this.refreshStorage();
    }

    status() {
        return {
            appVersion: APP_VERSION,
            apiVersion: API_VERSION,
            auth: this.stateStore.value.auth,
            storage: {
                usbRoot: this.activeVolume?.rootPath || null,
                selected: Boolean(this.activeVolume),
                requestedRoot: this.stateStore.value.usbRoot,
                kind: this.activeVolume?.kind || null,
                id: this.activeVolume?.id || null,
                message: this.storageMessage,
                state: !this.activeVolume ? "unavailable" :
                    (this.activeVolume.kind === "sd" && this.stateStore.value.usbRoot &&
                        this.stateStore.value.usbRoot !== this.storage.localRoot ? "fallback" : "ready"),
                volumes: this.storageVolumes || [],
            },
            settings: this.settings(),
            browser: this.browser.status(),
            activeJobs: this.jobs.list().filter((job) => ["queued", "running"].includes(job.state)),
        };
    }

    subscriptions() {
        return structuredClone(this.stateStore.value.subscriptions);
    }

    settings() {
        return structuredClone(this.stateStore.value.settings);
    }

    async setSettings(value) {
        const settings = normalizeSettings(value, this.stateStore.value.settings);
        await this.stateStore.update((state) => {
            state.settings = settings;
        });
        this.usbLibrary.setSettings(settings);
        return this.settings();
    }

    releases() {
        return structuredClone(this.stateStore.value.releases);
    }

    catalog() {
        return structuredClone(this.stateStore.value.catalog || []);
    }

    browse() {
        const browse = this.stateStore.value.browse;
        if (!browse) {
            return null;
        }
        const releasesByTopic = new Map(this.stateStore.value.releases.map((release) => [release.topicId, release]));
        return structuredClone({
            ...browse,
            releases: browse.topicIds.map((topicId) => releasesByTopic.get(topicId)).filter(Boolean),
        });
    }

    async setStorage(rootPath) {
        if (this.storageBusy || this.jobs.list().some((j) => j.kind === "download" && ["queued", "running"].includes(j.state))) {
            throw new Error("Finish or cancel downloads before changing the destination");
        }
        this.storageBusy = true;
        let session;
        try {
            const volume = await this.storage.resolve(rootPath === "sd" ? this.storage.localRoot : rootPath);
            session = await this.storage.open(volume, this.settings());
            const result = await session.library.reconcile();
            const volumes = await this.storage.volumes();
            await session.check();
            await this.stateStore.update((state) => {
                state.usbRoot = volume.rootPath;
                state.storageId = volume.id;
                this.applyStorageEntries(state, result.tracks, volume);
            });
            this.activeVolume = volume;
            this.usbLibrary = new UsbLibrary(volume.rootPath, this.settings());
            this.storageMessage = "";
            this.storageVolumes = volumes;
            return { usbRoot: volume.rootPath, kind: volume.kind };
        } finally {
            try { await session?.close(); }
            finally { this.storageBusy = false; }
        }
    }

    applyStorageEntries(state, tracks, volume) {
        for (const release of state.releases) {
            const entry = tracks.find((t) => (release.providers || []).some((p) => p.providerId === t.providerId) ||
                (t.topicId && t.topicId === release.topicId));
            if (entry) release.download = { ...entry, storageRoot: volume.rootPath, storageId: volume.id };
            // Selecting B must not erase a download still stored on A. Keep
            // its provenance; clients check that volume before loading it.
            else if (!release.download?.storageId || release.download.storageId === volume.id) {
                delete release.download;
            }
        }
    }

    async refreshStorage() {
        if (this.storageBusy || this.activeDownload) return;
        this.storageBusy = true;
        let session;
        try {
            this.storageVolumes = await this.storage.volumes();
            const state = this.stateStore.value;
            let volume;
            try {
                volume = await this.storage.resolve(state.usbRoot || this.storage.localRoot, state.storageId);
                this.storageMessage = "";
            } catch (error) {
                this.storageMessage = error.message;
                if (state.settings.fallbackToSd) {
                    volume = await this.storage.resolve(this.storage.localRoot);
                    this.storageMessage += "; using SD card for new downloads";
                }
            }
            if (!volume) { this.activeVolume = null; return; }
            if (this.activeVolume?.instance === volume.instance && this.activeVolume?.rootPath === volume.rootPath) return;
            session = await this.storage.open(volume, this.settings());
            const entries = state.releases.map((r) => r.download).filter((t) => t &&
                (t.storageId ? t.storageId === volume.id : state.usbRoot === volume.rootPath));
            const result = await session.library.reconcile(entries);
            await this.stateStore.update((s) => this.applyStorageEntries(s, result.tracks, volume));
            this.activeVolume = volume;
            this.usbLibrary = new UsbLibrary(volume.rootPath, this.settings());
        } catch (error) {
            this.activeVolume = null;
            this.storageMessage = error.message;
        } finally {
            try { await session?.close(); }
            finally { this.storageBusy = false; }
        }
    }

    async reconcileStorage() {
        this.activeVolume = null;
        await this.refreshStorage();
    }

    async prepareEject(rootPath) {
        if (this.storageBusy) throw new Error("Storage operation in progress; retry eject");
        const volume = (await this.storage.volumes()).find((v) => v.rootPath === rootPath && v.kind === "usb");
        if (!volume) return { ready: true };
        this.storage.blocked.add(volume.instance);
        const running = this.activeDownload;
        if (running?.volume.instance === volume.instance) {
            this.jobs.cancel(running.id);
            await running.done;
        }
        await this.refreshStorage();
        return { ready: true };
    }

    async cancelEject(rootPath) {
        for (const volume of await this.storage.volumes()) {
            if (volume.rootPath === rootPath) this.storage.blocked.delete(volume.instance);
        }
        await this.refreshStorage();
        return { ready: true };
    }

    async setSubscriptions(subscriptions) {
        if (!Array.isArray(subscriptions)) {
            throw new Error("subscriptions must be an array");
        }
        const currentById = new Map(this.stateStore.value.subscriptions.map((entry) => [entry.id, entry]));
        const normalized = subscriptions.map((entry) => {
            const current = currentById.get(entry.id);
            if (!current) {
                throw new Error(`Unknown subscription: ${entry.id}`);
            }
            assertEdmcGenreUrl(entry.url || current.url);
            return {
                ...current,
                enabled: Boolean(entry.enabled),
            };
        });
        if (normalized.length !== currentById.size) {
            throw new Error("The complete subscription list is required");
        }
        await this.stateStore.update((state) => {
            state.subscriptions = normalized;
        });
        return this.subscriptions();
    }

    ensureNoActiveJob(action) {
        if (this.jobs.hasActiveJobs()) {
            throw new Error(`Cannot ${action} while a browser job is active`);
        }
    }

    async openUi() {
        this.ensureNoActiveJob("open the visible UI");
        await this.browser.open(this.origin);
        return this.browser.status();
    }

    async openAuthentication() {
        this.ensureNoActiveJob("open authentication");
        await this.browser.open(AUTH_PROBE_URL);
        return this.browser.status();
    }

    async closeBrowser() {
        this.ensureNoActiveJob("close Chromium");
        await this.browser.close();
        return this.browser.status();
    }

    enqueueAuthCheck() {
        return this.jobs.enqueue("auth-check", {}, async ({ update }) => {
            update(0.1, "Checking the saved EDMC session");
            const page = await this.browser.page();
            try {
                const tracks = await readGenrePage(page, AUTH_PROBE_URL);
                const signedIn = tracks.length > 0;
                const auth = {
                    state: signedIn ? "signed-in" : "sign-in-required",
                    checkedAt: new Date().toISOString(),
                    message: signedIn ? "Saved EDMC session is working" : "Open sign-in on the Pi",
                };
                await this.stateStore.update((state) => {
                    state.auth = auth;
                });
                return auth;
            } finally {
                await page.close().catch(() => undefined);
                await this.closeHeadlessBrowser();
            }
        });
    }

    enqueueRefresh(subscriptionId) {
        return this.jobs.enqueue("refresh", { subscriptionId }, async ({ update }) => {
            const subscription = this.stateStore.value.subscriptions.find((entry) => entry.id === subscriptionId);
            if (!subscription) {
                throw new Error(`Unknown subscription: ${subscriptionId}`);
            }
            if (!subscription.enabled) {
                throw new Error(`${subscription.name} is not enabled`);
            }

            update(0.1, `Loading ${subscription.name}`);
            const page = await this.browser.page();
            try {
                const tracks = await readGenrePage(page, subscription.url);
                if (tracks.length === 0) {
                    throw new Error("No EDMC releases were returned; the saved login may have expired");
                }
                const knownId = Number(subscription.newestSeenTopicId) || null;
                const newTracks = [];
                for (const track of tracks) {
                    if (knownId && track.topicId === knownId) {
                        break;
                    }
                    newTracks.push(track);
                }

                await this.stateStore.update((state) => {
                    const stateSubscription = state.subscriptions.find((entry) => entry.id === subscriptionId);
                    stateSubscription.newestSeenTopicId = tracks[0].topicId;
                    const existingByTopic = new Map(state.releases.map((release) => [release.topicId, release]));
                    for (const track of tracks) {
                        existingByTopic.set(track.topicId, {
                            ...existingByTopic.get(track.topicId),
                            topicId: track.topicId,
                            title: track.title,
                            url: track.url,
                            subscriptionId: subscription.id,
                            subscriptionName: subscription.name,
                            providers: existingByTopic.get(track.topicId)?.providers || [],
                            discoveredAt: existingByTopic.get(track.topicId)?.discoveredAt || new Date().toISOString(),
                        });
                    }
                    state.releases = [...existingByTopic.values()].sort((left, right) => right.topicId - left.topicId).slice(0, 500);
                    state.auth = {
                        state: "signed-in",
                        checkedAt: new Date().toISOString(),
                        message: "Saved EDMC session is working",
                    };
                });
                update(1, `Found ${newTracks.length} new release(s)`);
                return { subscriptionId, found: newTracks.length, totalOnPage: tracks.length };
            } finally {
                await page.close().catch(() => undefined);
                await this.closeHeadlessBrowser();
            }
        });
    }

    enqueueCatalogRefresh() {
        return this.jobs.enqueue("catalog", {}, async ({ update }) => {
            update(0.1, "Reading EDMC music folders");
            const page = await this.browser.page();
            try {
                const catalog = await readMusicCatalog(page);
                if (catalog.length === 0) {
                    throw new Error("EDMC returned no music categories");
                }
                await this.stateStore.update((state) => {
                    state.catalog = catalog;
                    state.auth = {
                        state: "signed-in",
                        checkedAt: new Date().toISOString(),
                        message: "Saved EDMC session is working",
                    };
                });
                update(1, `Found ${catalog.length} music categories`);
                return { categories: catalog.length };
            } finally {
                await page.close().catch(() => undefined);
                await this.closeHeadlessBrowser();
            }
        });
    }

    enqueueBrowse({ genreUrl, genreName = null, page: requestedPage = 1 }) {
        assertEdmcGenreUrl(genreUrl);
        return this.jobs.enqueue("browse", { genreUrl, genreName, page: requestedPage }, async ({ update }) => {
            update(0.1, `Loading ${genreName || "EDMC releases"}`);
            const browserPage = await this.browser.page();
            try {
                const listing = await readGenreListing(browserPage, genreUrl, requestedPage);
                if (listing.tracks.length === 0) {
                    throw new Error("No EDMC releases were returned; the saved login may have expired");
                }
                await this.stateStore.update((state) => {
                    const existingByTopic = new Map(state.releases.map((release) => [release.topicId, release]));
                    for (const track of listing.tracks) {
                        const existing = existingByTopic.get(track.topicId);
                        existingByTopic.set(track.topicId, {
                            ...existing,
                            topicId: track.topicId,
                            title: track.title,
                            url: track.url,
                            genreUrl: listing.url,
                            genreName: genreName || listing.name,
                            providers: existing?.providers || [],
                            discoveredAt: existing?.discoveredAt || new Date().toISOString(),
                        });
                    }
                    state.releases = [...existingByTopic.values()]
                        .sort((left, right) => right.topicId - left.topicId)
                        .slice(0, 2000);
                    state.browse = {
                        genreUrl: listing.url,
                        genreName: genreName || listing.name,
                        page: listing.page,
                        lastPage: listing.lastPage,
                        hasPrevious: listing.hasPrevious,
                        hasNext: listing.hasNext,
                        topicIds: listing.tracks.map((track) => track.topicId),
                    };
                    state.auth = {
                        state: "signed-in",
                        checkedAt: new Date().toISOString(),
                        message: "Saved EDMC session is working",
                    };
                });
                update(1, `Loaded page ${listing.page} of ${listing.lastPage}`);
                return this.browse();
            } finally {
                await browserPage.close().catch(() => undefined);
                await this.closeHeadlessBrowser();
            }
        });
    }

    enqueueSearch({ query }) {
        return this.jobs.enqueue("search", { query }, async ({ update }) => {
            update(0.1, `Searching EDMC Music for ${query}`);
            const musicNodeIds = this.catalog()
                .flatMap((category) => category.genres || [])
                .map((genre) => String(genre.url || "").match(/-(\d+)\/$/)?.[1])
                .filter(Boolean);
            const browserPage = await this.browser.page();
            try {
                const listing = await readMusicSearch(browserPage, query, musicNodeIds);
                await this.stateStore.update((state) => {
                    const existingByTopic = new Map(
                        state.releases.map((release) => [release.topicId, release]));
                    for (const track of listing.tracks) {
                        const existing = existingByTopic.get(track.topicId);
                        existingByTopic.set(track.topicId, {
                            ...existing,
                            topicId: track.topicId,
                            title: track.title,
                            url: track.url,
                            genreName: "EDMC Music search",
                            providers: existing?.providers || [],
                            discoveredAt: existing?.discoveredAt || new Date().toISOString(),
                        });
                    }
                    state.releases = [...existingByTopic.values()]
                        .sort((left, right) => right.topicId - left.topicId)
                        .slice(0, 2000);
                    state.browse = {
                        mode: "search",
                        query: listing.query,
                        searchUrl: listing.url,
                        topicIds: listing.tracks.map((track) => track.topicId),
                    };
                    state.auth = {
                        state: "signed-in",
                        checkedAt: new Date().toISOString(),
                        message: "Saved EDMC session is working",
                    };
                });
                update(1, `Found ${listing.tracks.length} release(s)`);
                return this.browse();
            } finally {
                await browserPage.close().catch(() => undefined);
                await this.closeHeadlessBrowser();
            }
        });
    }

    enqueueResolve(topicId) {
        return this.jobs.enqueue("resolve", { topicId }, async ({ update }) => {
            const release = this.findRelease(topicId);
            if (release.providers.length && Date.now() - Date.parse(release.resolvedAt) < 15 * 60_000) {
                return { topicId: release.topicId, providers: release.providers, cached: true };
            }
            update(0.1, `Resolving ${release.title}`);
            const page = await this.browser.page();
            try {
                const details = await readRelease(page, release.url);
                if (!details.providers.length) throw new Error("No supported BeatEXS file options found; check the release or EDMC login");
                const providers = [];
                for (let index = 0; index < details.providers.length; index += 1) {
                    const providerDetails = details.providers[index];
                    const { providerId } = providerDetails;
                    update(0.25 + (index / Math.max(details.providers.length, 1)) * 0.65, `Reading provider ${index + 1}`);
                    providers.push(await this.describeProvider(page, providerDetails));
                }
                await this.stateStore.update((state) => {
                    const stateRelease = state.releases.find((entry) => entry.topicId === release.topicId);
                    stateRelease.providers = providers;
                    stateRelease.resolvedAt = new Date().toISOString();
                });
                return { topicId: release.topicId, providers };
            } finally {
                await page.close().catch(() => undefined);
                await this.closeHeadlessBrowser();
            }
        });
    }

    enqueueDownload(topicId, requestedProviderId = null) {
        if (this.storageBusy) throw new Error("Storage is changing; retry the download");
        return this.jobs.enqueue("download", { topicId, providerId: requestedProviderId }, async (job) => {
            await this.refreshStorage();
            if (this.storageBusy || !this.activeVolume) throw new Error(this.storageMessage || "No destination available");
            this.storageBusy = true;
            let session;
            let resolveDone;
            try {
                session = await this.storage.open(this.activeVolume, this.settings());
                const library = session.library;
                const volume = session.volume;
                this.activeDownload = { id: job.id, volume, done: new Promise((resolve) => { resolveDone = resolve; }) };
                this.storageBusy = false;
                let release = this.findRelease(topicId);
                if (release.providers.length === 0) {
                    job.update(0.05, "Resolving providers");
                    await this.resolveReleaseInline(release, job);
                    release = this.findRelease(topicId);
                }
                const provider = requestedProviderId
                    ? release.providers.find((entry) => entry.providerId === requestedProviderId)
                    : release.providers[0];
                if (!provider) {
                    throw new Error("No supported provider was found for this release");
                }
                if (provider.hintedFormat && !["mp3", "flac", "wav"].includes(provider.hintedFormat)) {
                    throw new Error(`Unsupported file type ${provider.hintedFormat.toUpperCase()}; choose MP3, FLAC, or WAV`);
                }
                assertProviderId(provider.providerId);

                // Validate the on-drive index before trusting a duplicate entry.
                const reconciled = await library.reconcile();
                const duplicate = reconciled.tracks.find((t) => t.providerId === provider.providerId);
                if (duplicate) {
                    await inspectSupportedAudio(path.join(library.rootPath, duplicate.relativePath), { signal: job.signal });
                    const track = { ...duplicate, storageRoot: volume.rootPath, storageId: volume.id };
                    await this.stateStore.update((state) => {
                        const target = state.releases.find((r) => r.topicId === release.topicId);
                        if (target) target.download = track;
                    });
                    return { duplicate: true, track };
                }

                job.update(0.2, "Requesting the authorized download");
                await ensureAudioProbe();
                const page = await this.browser.page();
                let resolvedUrl;
                let cookies;
                try {
                    resolvedUrl = await resolveOfficialDownload(page, provider.providerId);
                    cookies = await page.context().cookies(resolvedUrl);
                } finally {
                    await page.close().catch(() => undefined);
                    await this.closeHeadlessBrowser();
                }

                job.signal.throwIfAborted();
                await session.check(0);
                const paths = await library.allocateDownload(release, provider.providerId, job.id);
                job.update(0.3, `Streaming to ${volume.kind === "sd" ? "SD card" : volume.label || "selected USB"}`);
                const downloaded = await streamAudioDownload({
                    url: resolvedUrl,
                    partPath: paths.partPath,
                    cookies,
                    signal: job.signal,
                    checkStorage: session.check,
                    onProgress: (bytes, expectedBytes) => {
                        const fraction = expectedBytes ? bytes / expectedBytes : Math.min(bytes / 20_000_000, 0.95);
                        job.update(0.3 + Math.min(fraction, 1) * 0.55, `${Math.round(bytes / 1_048_576)} MB downloaded`);
                    },
                });

                job.signal.throwIfAborted();
                await session.check();
                const finalPath = await library.allocateFinalPath(paths, downloaded.extension);
                await library.finalizeDownload(
                    paths.partPath,
                    finalPath,
                    downloaded.bytes,
                );
                const entry = {
                    id: `beatexs:${provider.providerId}`,
                    title: release.title,
                    topicId: release.topicId,
                    sourceUrl: release.url,
                    provider: "BeatEXS",
                    providerId: provider.providerId,
                    subscriptionId: release.subscriptionId,
                    subscriptionName: release.subscriptionName,
                    relativePath: library.relativePath(finalPath),
                    storageRoot: volume.rootPath,
                    storageId: volume.id,
                    format: downloaded.format,
                    codec: downloaded.codec,
                    duration: downloaded.duration,
                    sampleRate: downloaded.sampleRate,
                    channels: downloaded.channels,
                    bitrate: downloaded.bitrate,
                    sourceLabel: provider.label || null,
                    bytes: downloaded.bytes,
                    sha256: downloaded.sha256,
                    audioValidationVersion: 1,
                    downloadedAt: new Date().toISOString(),
                };

                try {
                    await session.check();
                    await library.commitTrack(entry);
                } catch (error) {
                    await fs.rename(finalPath, paths.partPath).catch(() => undefined);
                    throw error;
                }
                await this.stateStore.update((state) => {
                    const stateRelease = state.releases.find((candidate) => candidate.topicId === release.topicId);
                    if (stateRelease) stateRelease.download = entry;
                });
                job.update(1, "Ready to load in BiteDJ");
                return { duplicate: false, track: entry };
            } finally {
                try {
                    await session?.close();
                } finally {
                    this.activeDownload = null;
                    this.storageBusy = false;
                    resolveDone?.();
                }
            }
        });
    }

    findRelease(topicId) {
        const numericTopicId = Number(topicId);
        const release = this.stateStore.value.releases.find((entry) => entry.topicId === numericTopicId);
        if (!release) {
            throw new Error(`Unknown EDMC topic: ${topicId}`);
        }
        return release;
    }

    async resolveReleaseInline(release, job) {
        const page = await this.browser.page();
        try {
            const details = await readRelease(page, release.url);
            if (!details.providers.length) throw new Error("No supported BeatEXS file options found; check the release or EDMC login");
            const providers = [];
            for (const providerDetails of details.providers) {
                const { providerId } = providerDetails;
                job.signal.throwIfAborted();
                providers.push(await this.describeProvider(page, providerDetails));
            }
            await this.stateStore.update((state) => {
                const stateRelease = state.releases.find((entry) => entry.topicId === release.topicId);
                stateRelease.providers = providers;
                stateRelease.resolvedAt = new Date().toISOString();
            });
        } finally {
            await page.close().catch(() => undefined);
            // A failed provider parse or duplicate-track early return must not
            // leave Chromium resident beside the real-time DJ application.
            await this.closeHeadlessBrowser();
        }
        job.update(0.15, "Provider resolved");
    }

    async describeProvider(page, details) {
        const provider = { provider: "BeatEXS", ...details };
        // Formats already labelled in the post require no preview navigation.
        // BiteDJ previews the downloaded file; preview URLs are not needed here.
        if (provider.hintedFormat) return provider;
        try {
            const metadata = await readFileMetadata(page, provider.providerId);
            provider.hintedFormat = metadata.hintedFormat;
            provider.filename = metadata.filename;
            provider.sizeLabel = metadata.sizeLabel;
            provider.label = metadata.hintedFormat ?
                `${metadata.hintedFormat.toUpperCase()}${metadata.sizeLabel ? ` · ${metadata.sizeLabel}` : ""}` :
                "Unknown format (verified on download)";
        } catch {
            // A preview/metadata endpoint outage must not disable an otherwise
            // valid official download. Never invent its type from an MP3 preview.
            provider.label = "Unknown format (verified on download)";
            provider.metadataUnavailable = true;
        }
        return provider;
    }

    async closeHeadlessBrowser() {
        if (this.browser.status().mode === "headless") {
            await this.browser.close();
        }
    }
}
