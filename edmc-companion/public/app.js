const elements = Object.fromEntries([
    "overallStatus", "usbRoot", "saveUsb", "storageStatus", "signIn", "checkAuth",
    "downloadFolder", "organizeByGenre", "saveSettings", "closeBrowser", "authStatus",
    "subscriptions", "releases", "jobs", "refreshView", "toast",
].map((id) => [id, document.getElementById(id)]));

let subscriptions = [];

async function api(path, options = {}) {
    const response = await fetch(path, {
        ...options,
        headers: options.body ? { "content-type": "application/json", ...options.headers } : options.headers,
    });
    const value = await response.json();
    if (!response.ok) {
        throw new Error(value.error || `HTTP ${response.status}`);
    }
    return value;
}

function showToast(message) {
    elements.toast.textContent = message;
    elements.toast.classList.add("visible");
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => elements.toast.classList.remove("visible"), 3500);
}

async function action(callback) {
    try {
        await callback();
        await refresh();
    } catch (error) {
        showToast(error.message);
    }
}

async function refresh() {
    const [status, nextSubscriptions, releases, jobs] = await Promise.all([
        api("/v1/status"), api("/v1/subscriptions"), api("/v1/releases"), api("/v1/jobs"),
    ]);
    subscriptions = nextSubscriptions;
    renderStatus(status);
    renderSubscriptions();
    renderReleases(releases);
    renderJobs(jobs);
}

function renderStatus(status) {
    elements.overallStatus.textContent = status.activeJobs.length
        ? `${status.activeJobs.length} job(s) active`
        : `Chromium: ${status.browser.mode}`;
    elements.authStatus.textContent = status.auth.message;
    elements.authStatus.className = status.auth.state === "signed-in" ? "downloaded" : "muted";
    elements.storageStatus.textContent = status.storage.usbRoot || "No USB selected.";
    if (status.storage.usbRoot && document.activeElement !== elements.usbRoot) {
        elements.usbRoot.value = status.storage.usbRoot;
    }
    if (status.settings && document.activeElement !== elements.downloadFolder) {
        elements.downloadFolder.value = status.settings.downloadFolder;
        elements.organizeByGenre.checked = status.settings.organizeByGenre;
    }
}

function renderSubscriptions() {
    elements.subscriptions.replaceChildren(...subscriptions.map((subscription) => {
        const row = document.createElement("div");
        row.className = "subscription";
        const label = document.createElement("label");
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = subscription.enabled;
        checkbox.addEventListener("change", () => action(async () => {
            const next = subscriptions.map((entry) => ({ ...entry, enabled: entry.id === subscription.id ? checkbox.checked : entry.enabled }));
            await api("/v1/subscriptions", { method: "PUT", body: JSON.stringify({ subscriptions: next }) });
        }));
        label.append(checkbox, document.createTextNode(subscription.name));
        const refreshButton = document.createElement("button");
        refreshButton.textContent = "Refresh";
        refreshButton.disabled = !subscription.enabled;
        refreshButton.addEventListener("click", () => action(async () => {
            const job = await api("/v1/refresh", { method: "POST", body: JSON.stringify({ subscriptionId: subscription.id }) });
            showToast(`Refresh queued: ${job.id.slice(0, 8)}`);
        }));
        row.append(label, refreshButton);
        return row;
    }));
}

function renderReleases(releases) {
    if (releases.length === 0) {
        elements.releases.innerHTML = '<p class="muted">Refresh an enabled subsection to list releases.</p>';
        return;
    }
    elements.releases.replaceChildren(...releases.map((release) => {
        const row = document.createElement("article");
        row.className = "release";
        const copy = document.createElement("div");
        const title = document.createElement("h3");
        title.textContent = release.title;
        const meta = document.createElement("p");
        meta.textContent = `${release.subscriptionName} · topic ${release.topicId}`;
        if (release.download) {
            meta.textContent += ` · ${release.download.relativePath}`;
            meta.className = "downloaded";
        } else if (release.providers?.length) {
            meta.textContent += ` · ${release.providers.length} provider option(s)`;
        }
        copy.append(title, meta);

        const actions = document.createElement("div");
        actions.className = "releaseActions";
        const resolve = document.createElement("button");
        resolve.textContent = "Resolve";
        resolve.disabled = Boolean(release.download);
        resolve.addEventListener("click", () => queue("/v1/resolve", { topicId: release.topicId }));
        const download = document.createElement("button");
        download.className = "primary";
        download.textContent = release.download ? "Downloaded" : "Download";
        download.disabled = Boolean(release.download);
        download.addEventListener("click", () => queue("/v1/download", {
            topicId: release.topicId,
            providerId: release.providers?.[0]?.providerId || null,
        }));
        actions.append(resolve, download);
        row.append(copy, actions);
        return row;
    }));
}

function renderJobs(jobs) {
    const shown = jobs.slice(0, 12);
    if (shown.length === 0) {
        elements.jobs.innerHTML = '<p class="muted">No work queued.</p>';
        return;
    }
    elements.jobs.replaceChildren(...shown.map((job) => {
        const row = document.createElement("div");
        row.className = "job";
        const copy = document.createElement("div");
        const heading = document.createElement("strong");
        heading.textContent = `${job.kind} · ${job.state}`;
        const detail = document.createElement("p");
        detail.textContent = job.error || job.message;
        detail.className = job.state === "failed" ? "failed" : "";
        copy.append(heading, detail);
        const progress = document.createElement("progress");
        progress.max = 1;
        progress.value = job.progress;
        row.append(copy, progress);
        return row;
    }));
}

async function queue(path, body) {
    return action(async () => {
        const job = await api(path, { method: "POST", body: JSON.stringify(body) });
        showToast(`Queued: ${job.id.slice(0, 8)}`);
    });
}

elements.saveUsb.addEventListener("click", () => action(() => api("/v1/storage", {
    method: "POST", body: JSON.stringify({ path: elements.usbRoot.value.trim() }),
})));
elements.saveSettings.addEventListener("click", () => action(() => api("/v1/settings", {
    method: "PUT",
    body: JSON.stringify({
        downloadFolder: elements.downloadFolder.value.trim(),
        organizeByGenre: elements.organizeByGenre.checked,
    }),
})));
elements.signIn.addEventListener("click", () => action(() => api("/v1/auth/open", { method: "POST" })));
elements.checkAuth.addEventListener("click", () => queue("/v1/auth/check", {}));
elements.closeBrowser.addEventListener("click", () => action(() => api("/v1/browser/close", { method: "POST" })));
elements.refreshView.addEventListener("click", refresh);

refresh().catch((error) => showToast(error.message));
setInterval(() => refresh().catch(() => undefined), 2000);
