const BEATEXS_ORIGIN = "https://beatexs.com";
const FINAL_DOWNLOAD_PATTERN = /^https:\/\/se\d+\.7btx\.com\/cgi-bin\/dl\.cgi\//;

export function assertProviderId(providerId) {
    if (!/^[a-zA-Z0-9]+$/.test(providerId)) {
        throw new Error("Invalid BeatEXS provider ID");
    }
}

export async function readPreview(page, providerId) {
    return (await readFileMetadata(page, providerId)).previewUrl;
}

export async function readFileMetadata(page, providerId) {
    assertProviderId(providerId);
    await page.goto(`${BEATEXS_ORIGIN}/embed/${providerId}`, { waitUntil: "domcontentloaded", timeout: 12_000 });
    return page.evaluate(() => {
        const sources = [...document.querySelectorAll("audio, audio source")]
            .map((element) => element.currentSrc || element.src || element.getAttribute("src"))
            .filter(Boolean);
        const lines = (document.body.innerText || document.body.textContent || "")
            .split(/\n/).map((line) => line.trim()).filter(Boolean);
        const filename = lines.find((line) => /^.{1,240}\.(?:mp3|wav|flac|aiff?|m4a|ogg|zip|rar)$/i.test(line)) || null;
        const hintedFormat = filename?.match(/\.([a-z0-9]+)$/i)?.[1].toLowerCase() ||
            lines.find((line) => /^(MP3|FLAC|WAV)$/i.test(line))?.toLowerCase() || null;
        const sizeLabel = lines.find((line) => /^\d+(?:\.\d+)?\s*(?:KB|MB|GB)$/i.test(line)) || null;
        return { filename, hintedFormat, sizeLabel,
            previewUrl: sources.find((url) => /\.mp3(?:$|[?#])/.test(url)) || null };
    });
}

export async function resolveOfficialDownload(page, providerId, timeoutMs = 30_000) {
    assertProviderId(providerId);
    await page.goto(`${BEATEXS_ORIGIN}/${providerId}`, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    const form = page.locator("form").filter({ has: page.locator("#downloadbtn") });
    if ((await form.count()) !== 1) {
        throw new Error(`BeatEXS download form was not found for ${providerId}`);
    }
    const finalRequestPromise = page.waitForRequest(
        (request) => FINAL_DOWNLOAD_PATTERN.test(request.url()),
        { timeout: timeoutMs },
    );
    await page.locator("#downloadbtn").click().catch(() => undefined);
    return (await finalRequestPromise).url();
}

export { BEATEXS_ORIGIN };
