const EDMC_ORIGIN = "https://edmc.to";

export async function readMusicCatalog(page) {
    await page.goto(`${EDMC_ORIGIN}/`, { waitUntil: "domcontentloaded" });
    return page.evaluate(() => {
        // The legacy IPS menu is still in the DOM, but misses newer genres.
        // Prefer the current header's grouped genre navigation; legacy is an
        // explicit compatibility path only when the new structure is absent.
        const current = [...document.querySelectorAll('#ipsLayout_header li[aria-haspopup="true"]')]
            .filter((item) => item.querySelector(':scope > div a[href*="/genre/"]'));
        const legacy = document.querySelector("#elNavigation_40_menu");
        const categories = current.length ? current :
            [...(legacy?.querySelectorAll(":scope > li.ipsMenu_subItems") || [])];
        if (!categories.length) {
            throw new Error("EDMC music menu was not found");
        }
        return categories
            .map((category) => {
                const categoryLink = category.querySelector(":scope > a");
                const nestedMenu = category.querySelector(":scope > div, :scope > ul");
                const genres = nestedMenu
                    ? [...nestedMenu.querySelectorAll('a[href*="/genre/"]')]
                        .map((link) => ({
                            name: (link.textContent || "").replace(/\s+/g, " ").trim(),
                            url: new URL(link.getAttribute("href"), location.href).href,
                        }))
                        .filter((genre) => genre.name && /^https:\/\/edmc\.to\/genre\/[^/]+-\d+\/$/.test(genre.url))
                    : [];
                return {
                    name: (categoryLink?.textContent || "").replace(/\s+/g, " ").trim(),
                    genres: [...new Map(genres.map((genre) => [genre.url.match(/-(\d+)\/$/)[1], genre])).values()],
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
            name: document.querySelector("h1.ipsType_pageTitle, #ipsLayout_mainArea h1")?.textContent?.replace(/\s+/g, " ").trim() || document.title,
            url: canonical,
            page: currentPage,
            lastPage: Number.isFinite(lastPage) && lastPage > 0 ? lastPage : currentPage,
            hasPrevious: currentPage > 1,
            hasNext: currentPage < lastPage,
            tracks: uniqueTracks,
        };
    });
}

export async function readMusicSearch(page, query, nodeIds) {
    const normalizedQuery = assertEdmcSearchQuery(query);
    const normalizedNodeIds = [...new Set(nodeIds.map((value) => Number(value)))]
        .filter((value) => Number.isSafeInteger(value) && value > 0);
    if (normalizedNodeIds.length === 0) {
        throw new Error("EDMC music categories have not been loaded yet");
    }

    await page.goto(`${EDMC_ORIGIN}/search/?type=forums_topic`, { waitUntil: "domcontentloaded" });
    return page.evaluate(async ({ searchQuery, musicNodeIds }) => {
        const input = document.querySelector("#elMainSearchInput");
        const form = input?.closest("form");
        const nodeInput = form?.querySelector('input[name="forums_topic_node"]');
        const titleRadio = form?.querySelector('input[name="search_in"][value="titles"]');
        if (!input || !form || !nodeInput || !titleRadio) {
            throw new Error("EDMC search form was not found");
        }
        input.value = searchQuery;
        nodeInput.value = musicNodeIds.join(",");
        titleRadio.checked = true;

        const response = await fetch(form.action, {
            method: "POST",
            body: new FormData(form),
            credentials: "include",
        });
        if (!response.ok) {
            throw new Error(`EDMC search returned HTTP ${response.status}`);
        }
        const resultDocument = new DOMParser().parseFromString(
            await response.text(), "text/html");
        const tracks = [...resultDocument.querySelectorAll(
            '.ipsStreamItem_title a[href*="/music/"]')]
            .map((link) => {
                const url = new URL(link.getAttribute("href"), response.url);
                url.search = "";
                url.hash = "";
                const match = url.pathname.match(/-(\d+)\/$/);
                return {
                    title: (link.textContent || "").replace(/\s+/g, " ").trim(),
                    url: url.href,
                    topicId: match ? Number(match[1]) : null,
                };
            })
            .filter((track) => track.title && track.topicId &&
                /^https:\/\/edmc\.to\/music\//.test(track.url));
        return {
            query: searchQuery,
            url: response.url,
            tracks: [...new Map(tracks.map((track) => [track.topicId, track])).values()],
        };
    }, { searchQuery: normalizedQuery, musicNodeIds: normalizedNodeIds });
}

export async function readRelease(page, releaseUrl) {
    assertEdmcReleaseUrl(releaseUrl);
    await page.goto(releaseUrl, { waitUntil: "domcontentloaded" });
    return page.evaluate(() => {
        const canonicalUrl = document.querySelector('link[rel="canonical"]')?.href || location.href;
        const providers = [...document.querySelectorAll('iframe[src^="https://beatexs.com/embed/"]')]
            .map((frame, index) => {
                const providerId = frame.src.match(/\/embed\/([^/?#]+)/)?.[1] || null;
                const paragraph = frame.closest("p") || frame.parentElement;
                const ownText = (paragraph?.textContent || "").replace(/\s+/g, " ").trim();
                const previousText = (paragraph?.previousElementSibling?.textContent || "")
                    .replace(/\s+/g, " ")
                    .trim();
                const formatOf = (text) => {
                    const match = text.match(/(?:^|[\s.(])(?:format\s*[:=-]?\s*)?(mp3|flac|wav)(?=$|[\s.)])/i);
                    return match?.[1].toLowerCase() || (/^320\s*(?:kbps|kb\/s|k)?$/i.test(text) ? "mp3" : null);
                };
                // Commentary often shares the iframe's paragraph. A labelled
                // previous paragraph is more useful than unrelated own text.
                const previous = paragraph?.previousElementSibling;
                const previousFormat = previous?.querySelector("iframe") ? null : formatOf(previousText);
                const hintedFormat = formatOf(ownText) || previousFormat;
                const label = hintedFormat ? hintedFormat.toUpperCase() : `File option ${index + 1}`;
                return { providerId, label, hintedFormat };
            })
            .filter((provider) => provider.providerId);
        return {
            title: document.querySelector("h1.ipsType_pageTitle, #ipsLayout_mainArea h1")?.textContent?.trim() || document.title,
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

export function assertEdmcSearchQuery(value) {
    const query = String(value || "").replace(/\s+/g, " ").trim();
    if (query.length < 2 || query.length > 120) {
        throw new Error("EDMC search must be between 2 and 120 characters");
    }
    return query;
}

export { EDMC_ORIGIN };
