// NoteTaker service worker.
// Sole purpose: receive audio shared from the phone's native recorder via the
// Web Share Target API and store it for the app to upload. It does NOT cache the
// app shell, so updates to index.html are always fetched fresh from the network.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", event => {
    const url = new URL(event.request.url);
    if (event.request.method === "POST" && url.pathname.endsWith("/share-target")) {
        event.respondWith(handleShare(event.request));
    }
    // All other requests fall through to the network (no caching).
});

async function handleShare(request) {
    try {
        const form = await request.formData();
        let file = form.get("audio");
        if (!(file instanceof File)) {
            for (const v of form.values()) { if (v instanceof File) { file = v; break; } }
        }
        if (file instanceof File) await saveShared(file);
    } catch (e) { /* swallow: still redirect so the user lands back in the app */ }
    return Response.redirect(new URL("./?shared=1", self.registration.scope).href, 303);
}

function idbOpen() {
    return new Promise((res, rej) => {
        const r = indexedDB.open("notetaker", 1);
        r.onupgradeneeded = e => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains("recordings")) db.createObjectStore("recordings", { keyPath: "id" });
            if (!db.objectStoreNames.contains("chunks")) {
                const cs = db.createObjectStore("chunks", { keyPath: "k", autoIncrement: true });
                cs.createIndex("recId", "recId", { unique: false });
            }
        };
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
    });
}

async function saveShared(file) {
    const db = await idbOpen();
    const ct = (/(mp4|m4a|aac)/i.test(file.type) || /\.(m4a|mp4|aac)$/i.test(file.name || "")) ? "audio/mp4" : "audio/webm";
    const rec = {
        id: (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + "-" + Math.random().toString(16).slice(2)),
        project: "", projectName: "", contentType: ct, status: "unassigned",
        createdAt: Date.now(), startedAt: Date.now(), attempts: 0, lastError: null,
        durationMs: 0, size: file.size, blob: file, source: "share"
    };
    await new Promise((res, rej) => {
        const tx = db.transaction("recordings", "readwrite");
        tx.objectStore("recordings").put(rec);
        tx.oncomplete = () => res();
        tx.onerror = () => rej(tx.error);
    });
}
