export const DEFAULT_SUBSCRIPTIONS = Object.freeze([
    { id: "jump-up", name: "Jump-Up", url: "https://edmc.to/genre/jump-up-145/", enabled: true, newestSeenTopicId: null },
    { id: "jungle-ragga", name: "Jungle / Ragga", url: "https://edmc.to/genre/jungleragga-122/", enabled: false, newestSeenTopicId: null },
    { id: "neurofunk-dark", name: "Neurofunk / Dark", url: "https://edmc.to/genre/neurofunkdark-164/", enabled: false, newestSeenTopicId: null },
    { id: "deep-techstep", name: "Deep / Techstep", url: "https://edmc.to/genre/deeptechstep-176/", enabled: false, newestSeenTopicId: null },
    { id: "riddim", name: "Riddim", url: "https://edmc.to/genre/riddim-177/", enabled: false, newestSeenTopicId: null },
    { id: "deep-dubstep", name: "Deep Dubstep", url: "https://edmc.to/genre/deep-dubstep-103/", enabled: false, newestSeenTopicId: null }
]);

export function createDefaultState() {
    return {
        version: 1,
        usbRoot: null,
        auth: {
            state: "unknown",
            checkedAt: null,
            message: "Not checked"
        },
        catalog: [],
        browse: null,
        subscriptions: structuredClone(DEFAULT_SUBSCRIPTIONS),
        releases: []
    };
}
