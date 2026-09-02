import assert from "node:assert/strict";
import test from "node:test";

import { assertProviderId } from "../src/providers/beatexs.mjs";
import { assertEdmcGenreUrl, assertEdmcReleaseUrl, assertEdmcSearchQuery } from "../src/providers/edmc.mjs";

test("provider IDs reject path injection", () => {
    assert.doesNotThrow(() => assertProviderId("moivo1mapbvk"));
    assert.throws(() => assertProviderId("../bad"));
});

test("EDMC search terms are normalized and bounded", () => {
    assert.equal(assertEdmcSearchQuery("  Rise   Again  "), "Rise Again");
    assert.throws(() => assertEdmcSearchQuery("x"));
    assert.throws(() => assertEdmcSearchQuery("x".repeat(121)));
});

test("EDMC URLs are constrained to known route shapes", () => {
    assert.doesNotThrow(() => assertEdmcGenreUrl("https://edmc.to/genre/jump-up-145/"));
    assert.doesNotThrow(() => assertEdmcReleaseUrl("https://edmc.to/music/blank-canvas-char-call-me-708681/"));
    assert.throws(() => assertEdmcGenreUrl("https://example.com/genre/jump-up-145/"));
    assert.throws(() => assertEdmcReleaseUrl("https://edmc.to/genre/jump-up-145/"));
});
