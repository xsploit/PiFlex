const EDMC_ORIGIN = "https://edmc.to";

export async function readMusicCatalog(page) {
    await page.goto(`${EDMC_ORIGIN}/`, { waitUntil: "domcontentloaded" });
    return page.evaluate(() => {
        const menu = document.querySelector("#elNavigation_40_menu");
        if (!menu) {
            throw new Error("EDMC music menu was not found");
        }
        return [...menu.querySelectorAll(":scope > li.ipsMenu_subItems")]
            .map((category) => {
                const categoryLink = category.querySelector(":scope > a");
                const nestedMenu = category.querySelector(":scope > ul");
                const genres = nestedMenu
                    ? [...nestedMenu.querySelectorAll(":scope > li.ipsMenu_item > a[href]")]
                        .map((link) => ({
                            name: (link.textContent || "").replace(/\s+/g, " ").trim(),
                            url: new URL(link.getAttribute("href"), location.href).href,
                        }))
                        .filter((genre) => genre.name && /^https:\/\/edmc\.to\/genre\//.test(genre.url))
                    : [];
                return {
                    name: (categoryLink?.textContent || "").replace(/\s+/g, " ").trim(),
                    genres: [...new Map(genres.map((genre) => [genre.url, genre])).values()],
                };
            })
            .filter((category) => category.name && category.genres.length);
    });
}

export async function readGenrePage(page, genreUrl) {
    return (await readGenreListing(page, genreUrl, 1)).tracks;
}

export async function readGenreListing(page, genreUrl, pageNumber = 1) {
    assertEdmcGenreUrl(genreUrl);
    const numericPage = Number(pageNumber);
    if (!Number.isSafeInteger(numericPage) || numericPage < 1 || numericPage > 10_000) {
        throw new Error(`Invalid EDMC page: ${pageNumber}`);
    }
    const target = new URL(genreUrl);
    if (numericPage > 1) {
        target.searchParams.set("page", String(numericPage));
    } else {
        target.searchParams.delete("page");
    }
    await page.goto(target.href, { waitUntil: "domcontentloaded" });
    return page.evaluate(() => {
        const trackPattern = /^https:\/\/edmc\.to\/music\/[^?#]+\/(?:$|\?)/;
        const tracks = [...document.querySelectorAll('a[href*="/music/"][data-ipshover-target*="?preview=1"]')]
            .map((link) => {
                const url = new URL(link.getAttribute("href"), location.href);
                url.search = "";
                url.hash = "";
                const match = url.pathname.match(/-(\d+)\/$/);
                return {
                    title: (link.textContent || "").trim(),
                    url: url.href,
                    topicId: match ? Number(match[1]) : null,
                };
            })
            .filter((track) => track.title && track.topicId && trackPattern.test(track.url));
        const uniqueTracks = [...new Map(tracks.map((track) => [track.topicId, track])).values()]
            .sort((left, right) => right.topicId - left.topicId);
        const canonical = document.querySelector('link[rel="canonical"]')?.href || location.href;
        const lastHref = document.querySelector('.ipsPagination a[rel="last"]')?.href;
        const lastPage = lastHref ? Number(new URL(lastHref).searchParams.get("page") || 1) : 1;
        const currentPage = Number(new URL(location.href).searchParams.get("page") || 1);
        return {
            name: document.querySelector("h1")?.textContent?.replace(/\s+/g, " ").trim() || document.title,
            url: canonical,
            page: currentPage,
            lastPage: Number.isFinite(lastPage) && lastPage > 0 ? lastPage : currentPage,
            hasPrevious: currentPage > 1,
            hasNext: currentPage < lastPage,
            tracks: uniqueTracks,
        };
    });
}

export async function readRelease(page, releaseUrl) {
    assertEdmcReleaseUrl(releaseUrl);
    await page.goto(releaseUrl, { waitUntil: "domcontentloaded" });
    return page.evaluate(() => {
        const canonicalUrl = document.querySelector('link[rel="canonical"]')?.href || location.href;
        const providers = [...document.querySelectorAll('iframe[src^="https://beatexs.com/embed/"]')]
            .map((frame, index) => {
                const providerId = frame.src.match(/\/embed\/([^/?#]+)/)?.[1] || null;
                const paragraph = frame.closest("p");
                const ownText = (paragraph?.textContent || "").replace(/\s+/g, " ").trim();
                const previousText = (paragraph?.previousElementSibling?.textContent || "")
                    .replace(/\s+/g, " ")
                    .trim();
                const label = ownText || previousText || `File option ${index + 1}`;
                const normalized = label.toLowerCase();
                const hintedFormat = normalized.includes("flac")
                    ? "flac"
                    : normalized.includes("wav")
                        ? "wav"
                        : (normalized.includes("mp3") || /\b320\b/.test(normalized))
                            ? "mp3"
                            : null;
                return { providerId, label, hintedFormat };
            })
            .filter((provider) => provider.providerId);
        return {
            title: document.querySelector("h1")?.textContent?.trim() || document.title,
            url: canonicalUrl,
            providers: [...new Map(providers.map((provider) => [provider.providerId, provider])).values()],
        };
    });
}

export function assertEdmcGenreUrl(value) {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== "edmc.to" || !url.pathname.startsWith("/genre/")) {
        throw new Error(`Invalid EDMC genre URL: ${value}`);
    }
}

export function assertEdmcReleaseUrl(value) {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== "edmc.to" || !/^\/music\/[^/]+-\d+\/$/.test(url.pathname)) {
        throw new Error(`Invalid EDMC release URL: ${value}`);
    }
}

export { EDMC_ORIGIN };
