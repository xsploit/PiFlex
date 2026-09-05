import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { parseHTML } from "linkedom";
import { readMusicCatalog, readRelease, readGenreListing } from "../src/providers/edmc.mjs";
import { readFileMetadata } from "../src/providers/beatexs.mjs";
import { Companion } from "../src/companion.mjs";

function fixturePage(html) {
    const { document } = parseHTML(`<html><head><title>Fixture</title></head><body>${html}</body></html>`);
    const page = { visits: [], async goto(url) { this.url = url; this.visits.push(url); },
        async evaluate(fn) { return JSON.parse(JSON.stringify(vm.runInNewContext(`(${fn.toString()})()`,
            { document, URL, location: { href: this.url } }))); } };
    return page;
}

test("current grouped catalog includes newer genres and deduplicates numeric IDs", async () => {
    const page = fixturePage(`<header id="ipsLayout_header"><li aria-haspopup="true"><a>House</a><div><ul>
        <li><a href="https://edmc.to/genre/afro-house-327/">Afro House</a></li>
        <li><a href="https://edmc.to/genre/other-slug-327/">Afro House</a></li></ul></div></li></header>
        <ul id="elNavigation_40_menu"><li class="ipsMenu_subItems"><a>Old</a><ul>
        <li><a href="https://edmc.to/genre/house-48/">House</a></li></ul></li></ul>`);
    const catalog = await readMusicCatalog(page);
    assert.equal(catalog.length, 1); assert.equal(catalog[0].name, "House");
    assert.equal(catalog[0].genres.length, 1); assert(catalog[0].genres[0].url.endsWith("-327/"));
});

test("legacy menu is supported only when current structure is absent; missing menu fails", async () => {
    const page = fixturePage(`<ul id="elNavigation_40_menu"><li class="ipsMenu_subItems"><a>Old</a><ul>
        <li><a href="https://edmc.to/genre/house-48/">House</a></li></ul></li></ul>`);
    assert.equal((await readMusicCatalog(page))[0].name, "Old");
    await assert.rejects(readMusicCatalog(fixturePage("<h1>Sign in</h1>")), /menu/);
});

test("release selects page title and WAV label before unrelated iframe commentary", async () => {
    const page = fixturePage(`<h1 class="logo_text">EDMC</h1><h1 class="ipsType_pageTitle">Real title</h1>
        <p>MP3<iframe src="https://beatexs.com/embed/mp3file"></iframe></p>
        <p>WAV</p><p><iframe src="https://beatexs.com/embed/wavfile"></iframe>My new music!</p>`);
    const release = await readRelease(page, "https://edmc.to/music/real-title-42/");
    assert.equal(release.title, "Real title");
    assert.deepEqual(release.providers.map(p=>p.hintedFormat), ["mp3", "wav"]);
    assert.deepEqual(release.providers.map(p=>p.label), ["MP3", "WAV"]);
});

test("unknown option does not inherit previous iframe's format or artist word", async () => {
    const release = await readRelease(fixturePage(`<p>MP3<iframe src="https://beatexs.com/embed/first"></iframe></p>
        <p><iframe src="https://beatexs.com/embed/second"></iframe>Wavelength artist</p>`), "https://edmc.to/music/real-title-42/");
    assert.equal(release.providers[1].hintedFormat, null);
});

test("listing ignores logo and preserves last page boundary", async () => {
    const listing = await readGenreListing(fixturePage(`<h1>EDMC</h1><h1 class="ipsType_pageTitle">Drum &amp; Bass</h1>
        <div class="ipsPagination"><a rel="last" href="https://edmc.to/genre/drum-bass-37/?page=407">Last</a></div>
        <a href="https://edmc.to/music/test-42/" data-ipshover-target="?preview=1">Track</a>`),
        "https://edmc.to/genre/drum-bass-37/", 407);
    assert.equal(listing.name, "Drum & Bass"); assert.equal(listing.lastPage, 407);
    assert.equal(listing.hasNext, false); assert.equal(listing.tracks.length, 1);
});

test("WAV source metadata is never inferred from its MP3 preview", async () => {
    const metadata = await readFileMetadata(fixturePage(`<div>Actual song.wav</div><div>114.1 MB</div>
        <audio src="https://example.com/preview.mp3"></audio>`), "wavfile");
    assert.equal(metadata.hintedFormat, "wav"); assert.equal(metadata.filename, "Actual song.wav");
    assert.equal(metadata.sizeLabel, "114.1 MB"); assert(metadata.previewUrl.endsWith(".mp3"));
});

test("labelled formats need zero extra visits; unknown format gets one metadata visit", async () => {
    const c = new Companion({ dataDir: "unused", chromiumExecutable: "unused" });
    const page = fixturePage(`<div>Actual song.flac</div><div>23.1 MB</div>`);
    assert.equal((await c.describeProvider(page, { providerId:"known", hintedFormat:"mp3", label:"MP3" })).hintedFormat, "mp3");
    assert.equal(page.visits.length, 0);
    assert.equal((await c.describeProvider(page, { providerId:"unknown", hintedFormat:null })).hintedFormat, "flac");
    assert.equal(page.visits.length, 1);
});

test("metadata outage preserves downloadable option with explicit unknown format", async () => {
    const c = new Companion({ dataDir: "unused", chromiumExecutable: "unused" });
    const provider = await c.describeProvider({ goto: async()=>{throw new Error("timeout");} }, { providerId:"unknown", hintedFormat:null });
    assert.equal(provider.hintedFormat, null); assert.equal(provider.metadataUnavailable, true);
});

test("resolve needs one page for two labelled options and zero for a warm cache", async () => {
    const c = new Companion({ dataDir: "unused", chromiumExecutable: "unused" });
    c.stateStore.value.releases = [{ topicId: 42, title: "Track", url: "https://edmc.to/music/test-42/", providers: [] }];
    c.stateStore.update = async fn => fn(c.stateStore.value);
    const page = fixturePage(`<p>MP3<iframe src="https://beatexs.com/embed/mp3file"></iframe></p>
        <p>WAV</p><p><iframe src="https://beatexs.com/embed/wavfile"></iframe>Commentary</p>`);
    page.close = async()=>{};
    c.browser.page = async()=>page;
    c.enqueueResolve(42);
    while (c.jobs.hasActiveJobs()) await new Promise(r=>setTimeout(r, 5));
    assert.equal(c.jobs.list()[0].state, "completed");
    assert.equal(page.visits.length, 1);
    assert.equal(c.findRelease(42).providers.length, 2);
    c.enqueueResolve(42);
    while (c.jobs.hasActiveJobs()) await new Promise(r=>setTimeout(r, 5));
    assert.equal(c.jobs.list()[0].result.cached, true);
    assert.equal(page.visits.length, 1);
});
