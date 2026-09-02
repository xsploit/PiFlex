export const DEFAULT_SETTINGS = Object.freeze({
    downloadFolder: "Music/EDMC",
    organizeByGenre: true,
});

export function normalizeDownloadFolder(value) {
    if (typeof value !== "string") {
        throw new Error("downloadFolder must be a relative folder on the selected USB");
    }
    const candidate = value.trim().replaceAll("\\", "/");
    if (candidate.startsWith("/") || /^[A-Za-z]:/.test(candidate)) {
        throw new Error("downloadFolder must be a safe relative folder on the selected USB");
    }
    const normalized = candidate.replace(/\/+$/g, "");
    const segments = normalized.split("/");
    if (!normalized || normalized.length > 180 ||
            segments.some((segment) => !segment || segment === "." || segment === ".." ||
                /[<>:"|?*\u0000-\u001f]/.test(segment))) {
        throw new Error("downloadFolder must be a safe relative folder on the selected USB");
    }
    return segments.join("/");
}

export function normalizeSettings(value = {}, current = DEFAULT_SETTINGS) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("settings must be an object");
    }
    const unknown = Object.keys(value).filter(
        (key) => !["downloadFolder", "organizeByGenre"].includes(key),
    );
    if (unknown.length) {
        throw new Error(`Unknown setting: ${unknown[0]}`);
    }
    return {
        downloadFolder: normalizeDownloadFolder(
            value.downloadFolder ?? current.downloadFolder ?? DEFAULT_SETTINGS.downloadFolder,
        ),
        organizeByGenre: value.organizeByGenre === undefined
            ? Boolean(current.organizeByGenre)
            : Boolean(value.organizeByGenre),
    };
}
