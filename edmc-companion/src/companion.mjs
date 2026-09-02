import fs from "node:fs/promises";
import path from "node:path";

import { BrowserSession } from "./browser-session.mjs";
import { APP_VERSION, API_VERSION } from "./config.mjs";
import { streamAudioDownload } from "./download.mjs";
import { JobQueue } from "./job-queue.mjs";
import { normalizeSettings } from "./settings.mjs";
import { StateStore } from "./state-store.mjs";
import { UsbLibrary } from "./usb-library.mjs";
import { assertProviderId, readPreview, resolveOfficialDownload } from "./providers/beatexs.mjs";
import { assertEdmcGenreUrl, readGenreListing, readGenrePage, readMusicCatalog, readRelease } from "./providers/edmc.mjs";

const AUTH_PROBE_URL = "https://edmc.to/genre/jump-up-145/";

export class Companion {
    constructor({ dataDir, chromiumExecutable, usbRoot = null, origin }) {
        this.dataDir = dataDir;
        this.origin = origin;
        this.stateStore = new StateStore(dataDir);
        this.usbLibrary = new UsbLibrary(usbRoot);
        this.browser = new BrowserSession({
            executablePath: chromiumExecutable,
            profileDirectory: path.join(dataDir, "chromium-profile"),
        });
        this.jobs = new JobQueue();
    }

    async initialize() {
        const state = await this.stateStore.load();
        this.usbLibrary.setSettings(state.settings);
        if (this.usbLibrary.rootPath) {
            await this.setStorage(this.usbLibrary.rootPath);
        } else if (state.usbRoot) {
            this.usbLibrary.setRoot(state.usbRoot);
            await this.usbLibrary.verifyWritable();
            await this.reconcileStorage();
        }
    }

    status() {
        return {
            appVersion: APP_VERSION,
            apiVersion: API_VERSION,
            auth: this.stateStore.value.auth,
            storage: {
                usbRoot: this.stateStore.value.usbRoot,
                selected: Boolean(this.stateStore.value.usbRoot),
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
        this.ensureNoActiveJob("change settings");
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
        this.usbLibrary.setRoot(rootPath);
        const verifiedRoot = await this.usbLibrary.verifyWritable();
        await this.stateStore.update((state) => {
            state.usbRoot = verifiedRoot;
        });
        await this.reconcileStorage();
        return { usbRoot: verifiedRoot };
    }

    async reconcileStorage() {
        const result = await this.usbLibrary.reconcile(
            this.stateStore.value.releases.map((release) => release.download).filter(Boolean),
        );
        const validProviders = new Set(result.tracks.map((track) => track.providerId));
        const staleDownloads = this.stateStore.value.releases.filter(
            (release) => release.download && !validProviders.has(release.download.providerId),
        );
        if (staleDownloads.length > 0) {
            await this.stateStore.update((state) => {
                for (const release of state.releases) {
                    if (release.download && !validProviders.has(release.download.providerId)) {
                        delete release.download;
                    }
                }
            });
        }
        return result;
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

    enqueueResolve(topicId) {
        return this.jobs.enqueue("resolve", { topicId }, async ({ update }) => {
            const release = this.findRelease(topicId);
            update(0.1, `Resolving ${release.title}`);
            const page = await this.browser.page();
            try {
                const details = await readRelease(page, release.url);
                const providers = [];
                for (let index = 0; index < details.providers.length; index += 1) {
                    const providerDetails = details.providers[index];
                    const { providerId } = providerDetails;
                    update(0.25 + (index / Math.max(details.providers.length, 1)) * 0.65, `Reading provider ${index + 1}`);
                    providers.push({
                        provider: "BeatEXS",
                        providerId,
                        label: providerDetails.label,
                        hintedFormat: providerDetails.hintedFormat,
                        previewUrl: await readPreview(page, providerId),
                    });
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
        return this.jobs.enqueue("download", { topicId, providerId: requestedProviderId }, async (job) => {
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
            assertProviderId(provider.providerId);

            const duplicate = await this.usbLibrary.findByProviderId(provider.providerId);
            if (duplicate) {
                return { duplicate: true, track: duplicate };
            }

            job.update(0.2, "Requesting the authorized download");
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

            const paths = await this.usbLibrary.allocateDownload(release, provider.providerId, job.id);
            job.update(0.3, "Streaming to the selected USB");
            const downloaded = await streamAudioDownload({
                url: resolvedUrl,
                partPath: paths.partPath,
                cookies,
                signal: job.signal,
                onProgress: (bytes, expectedBytes) => {
                    const fraction = expectedBytes ? bytes / expectedBytes : Math.min(bytes / 20_000_000, 0.95);
                    job.update(0.3 + Math.min(fraction, 1) * 0.55, `${Math.round(bytes / 1_048_576)} MB downloaded`);
                },
            });

            const finalPath = await this.usbLibrary.allocateFinalPath(paths, downloaded.extension);
            await this.usbLibrary.finalizeDownload(
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
                relativePath: this.usbLibrary.relativePath(finalPath),
                format: downloaded.format,
                sourceLabel: provider.label || null,
                bytes: downloaded.bytes,
                sha256: downloaded.sha256,
                downloadedAt: new Date().toISOString(),
            };

            try {
                await this.usbLibrary.commitTrack(entry);
            } catch (error) {
                await fs.rename(finalPath, paths.partPath).catch(() => undefined);
                throw error;
            }
            await this.stateStore.update((state) => {
                const stateRelease = state.releases.find((candidate) => candidate.topicId === release.topicId);
                stateRelease.download = entry;
            });
            job.update(1, "Ready in BiteDJ's removable-device browser");
            return { duplicate: false, track: entry };
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
            const providers = [];
            for (const providerDetails of details.providers) {
                const { providerId } = providerDetails;
                providers.push({
                    provider: "BeatEXS",
                    providerId,
                    label: providerDetails.label,
                    hintedFormat: providerDetails.hintedFormat,
                    previewUrl: await readPreview(page, providerId),
                });
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

    async closeHeadlessBrowser() {
        if (this.browser.status().mode === "headless") {
            await this.browser.close();
        }
    }
}
