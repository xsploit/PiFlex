const BEATEXS_ORIGIN = "https://beatexs.com";
const FINAL_DOWNLOAD_PATTERN = /^https:\/\/se\d+\.7btx\.com\/cgi-bin\/dl\.cgi\//;

export function assertProviderId(providerId) {
    if (!/^[a-zA-Z0-9]+$/.test(providerId)) {
        throw new Error("Invalid BeatEXS provider ID");
    }
}

export async function readPreview(page, providerId) {
    assertProviderId(providerId);
    await page.goto(`${BEATEXS_ORIGIN}/embed/${providerId}`, { waitUntil: "domcontentloaded" });
    return page.evaluate(() => {
        const sources = [...document.querySelectorAll("audio, audio source")]
            .map((element) => element.currentSrc || element.src)
            .filter(Boolean);
        return sources.find((url) => /\.mp3(?:$|[?#])/.test(url)) || null;
    });
}

export async function resolveOfficialDownload(page, providerId, timeoutMs = 30_000) {
    assertProviderId(providerId);
    await page.goto(`${BEATEXS_ORIGIN}/${providerId}`, { waitUntil: "domcontentloaded" });
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
