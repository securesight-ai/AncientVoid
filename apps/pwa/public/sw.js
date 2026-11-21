/*
 * AncientVoid service worker — K10: offline tolerance.
 * Network-first for API projections; on failure serve the cached projection
 * with an X-AncientVoid-Cached-At timestamp so the UI can badge "Daten vom <ts>".
 * Versioned cache — hard-bust by bumping CACHE_VERSION on deploy.
 */
// BUG-0186: v6, weil jede frühere Version das Manifest vorgeladen hat — dieses
// vorgeladene Exemplar war die alte, auf Hochformat gesperrte Fassung, und ohne
// Byte-Änderung an dieser Datei installiert Chrome niemals einen neuen Worker,
// der den alten Cache räumen könnte.
const CACHE_VERSION = "ancientvoid-v6";
// T8.2: API projections live apart from the shell, so a token change can
// drop them without touching the app itself.
const API_CACHE = "ancientvoid-api";
// Das Manifest bleibt aus dem Vorlade-Set draußen: Android liest die
// Fenster-Ausrichtung aus dem Manifest, und ein vorgeladenes Exemplar
// sperrt die installierte App sonst auf eine Ausrichtung ein, die das
// Netz längst freigegeben hat (BUG-0186, BUG-0181).
const SHELL = ["/", "/index.html", "/icons/icon-192.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION && k !== API_CACHE).map((k) => caches.delete(k))))
      .then(dropCachedManifest)
      .then(() => self.clients.claim()),
  );
});

/**
 * BUG-0186: ein Manifest, das je in einen Cache geraten ist, wird rausgeworfen.
 * Android liest die Fenster-Ausrichtung aus dem Manifest — ein zwischengelagertes
 * Exemplar sperrt die installierte App sonst auf eine Ausrichtung, die das Netz
 * laengst freigegeben hat. Aktiv wird das bei jedem Worker-Wechsel geraeumt.
 */
async function dropCachedManifest() {
  const keys = await caches.keys();
  await Promise.all(
    keys.map(async (name) => {
      const cache = await caches.open(name);
      const entries = await cache.keys();
      await Promise.all(
        entries.filter((req) => new URL(req.url).pathname.endsWith("/manifest.webmanifest")).map((req) => cache.delete(req)),
      );
    }),
  );
}

/**
 * Diagnose fuer die Oberflaeche (BUG-0186): „welcher Stand liegt auf dem Geraet?“
 * soll ablesbar sein, nicht gefuehlt. Antwort geht an den anfragenden Client zurueck.
 */
self.addEventListener("message", (event) => {
  if (!event.data || event.data.type !== "ancientvoid:sw-info") return;
  const answer = { type: "ancientvoid:sw-info", cache: CACHE_VERSION };
  if (event.source) event.source.postMessage(answer);
  else self.clients.matchAll().then((all) => all.forEach((c) => c.postMessage(answer)));
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(networkFirstApi(req, url));
    return;
  }
  if (url.origin === self.location.origin) {
    // BUG-0186: das Manifest wird NIE eingelagert. Android steuert aus dem Manifest die
    // Fenster-Ausrichtung einer installierten App; ein Exemplar im Cache sperrt das
    // Fenster auf eine Ausrichtung, die das Netz laengst freigegeben hat — genau der
    // Zustand, den dropCachedManifest beim activate geraeumt hatte, nur um ihn beim
    // naechsten Laden wieder zu erzeugen (live auf dem Geraet so gemessen).
    if (url.pathname.endsWith("/manifest.webmanifest")) {
      event.respondWith(fetch(req));
      return;
    }
    // Real bug, found via a live report ("UI shows old colors/layout after
    // a rebuild"): this used to be cache-first (`caches.match(req).then(hit
    // => hit || fetch(...))`), so once the app shell (/, /index.html, the
    // hashed JS/CSS bundle) was cached once, a phone would NEVER see a
    // newer build again — every subsequent load served the frozen-in-time
    // cache, silently, forever, regardless of how many times the PWA was
    // rebuilt. Network-first (mirroring networkFirstApi below) fixes that:
    // the shell only falls back to cache when actually offline, which is
    // K10's real purpose, not "prefer stale over fresh while online".
    event.respondWith(networkFirstShell(req));
  }
});

async function networkFirstShell(req) {
  try {
    const res = await fetch(req);
    if (res.ok) {
      const copy = res.clone();
      caches.open(CACHE_VERSION).then((c) => c.put(req, copy));
    }
    return res;
  } catch {
    const cached = await caches.match(req);
    if (cached) return cached;
    throw new Error("offline and nothing cached for " + req.url);
  }
}

// T1.5-3: the account-level usage/quota endpoint (ADR-0004) needs the same
// offline tolerance as the session list — an adapter's usage doesn't
// change per session, so a stale-but-labeled value is still useful.
// T8.2: everything the overview and an opened session need to be shown
// offline — reads only; a write offline fails visibly, it is never queued.
const CACHEABLE_API_PATTERNS = [
  /^\/api\/sessions$/,
  /^\/api\/sessions\/[^/]+$/,
  /^\/api\/adapters$/,
  /^\/api\/adapters\/[^/]+\/usage$/,
  /^\/api\/fleet$/,
  /^\/api\/fleet\/hello$/,
  /^\/api\/notifications$/,
];

async function networkFirstApi(req, url) {
  try {
    const res = await fetch(req);
    if (res.ok && CACHEABLE_API_PATTERNS.some((p) => p.test(url.pathname))) {
      // Keep when it was fetched: offline, the UI says "Daten vom <that>".
      const body = await res.clone().blob();
      const headers = new Headers(res.headers);
      headers.set("X-AncientVoid-Stored-At", new Date().toISOString());
      caches.open(API_CACHE).then((c) => c.put(req, new Response(body, { status: res.status, statusText: res.statusText, headers })));
    }
    return res;
  } catch {
    const cached = await caches.open(API_CACHE).then((c) => c.match(req));
    if (cached) {
      return new Response(cached.body, {
        status: cached.status,
        statusText: cached.statusText,
        headers: {
          ...Object.fromEntries(cached.headers.entries()),
          "X-AncientVoid-Cached-At": cached.headers.get("X-AncientVoid-Stored-At") ?? new Date(0).toISOString(),
        },
      });
    }
    return new Response(JSON.stringify({ error: "offline", noCache: true }), {
      status: 503,
      headers: { "content-type": "application/json" },
    });
  }
}

// T8.3 (ADR-0026): a push is only a hint — an opaque id and a category.
// The text is fixed here; what happened is loaded after login in the app.
const PUSH_TEXT = {
  approval: { title: "AncientVoid — Freigabe nötig", body: "Eine Session wartet auf deine Entscheidung." },
  error: { title: "AncientVoid — Fehler", body: "In einer Session ist etwas schiefgegangen." },
  done: { title: "AncientVoid — Zug fertig", body: "Eine Session wartet auf deinen nächsten Schritt." },
};

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  // EPIC-P61 / ADR-0101: der Hub rendert die Push-Texte selbst (pro Abo-Sprache)
  und schickt sie mit; die feste Tabelle bleibt der Fallback für ältere Hubs.
  const text = (data.title ? { title: data.title, body: data.body ?? "" } : null)
    ?? (data.test ? { title: "AncientVoid — Test", body: "Push kommt auf diesem Gerät an." } : PUSH_TEXT[data.category] ?? PUSH_TEXT.error);
  const host = data.hostId && data.hostId !== "local" ? `/hosts/${encodeURIComponent(data.hostId)}` : "";
  const url = data.sessionId ? `/#${host}/sessions/${encodeURIComponent(data.sessionId)}` : "/#/";
  // BUG-0223: ist ein App-Fenster sichtbar, übernimmt der In-App-Toast —
  // die OS-Meldung käme auf demselben Gerät sonst doppelt. Verdeckte oder
  // geschlossene Fenster bekommen weiterhin Push (dort sieht niemand den
  // Toast). Der Test-Push bleibt ausgenommen: der Testknopf in den
  // Einstellungen soll die OS-Auslieferung gerade mit offener App prüfen.
  const sichtbar = data.test
    ? Promise.resolve(false)
    : self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => wins.some((w) => w.visibilityState === "visible"));
  event.waitUntil(
    sichtbar.then((offen) => {
      if (offen) return;
      return self.registration.showNotification(text.title, {
        body: text.body,
        // One notification per hub notification, even if it arrives twice.
        tag: data.id ? `ancientvoid-${data.hostId ?? ""}-${data.id}` : "ancientvoid-test",
        data: { url },
        icon: "/icons/icon-192.png",
        badge: "/icons/favicon-32.png",
        // Approvals block an agent: stay on screen and buzz; finished turns stay quiet.
        vibrate: data.category === "approval" ? [200, 100, 200] : data.category === "error" ? [120, 60, 120] : [80],
        requireInteraction: data.category === "approval",
        renotify: true,
        timestamp: Date.now(),
      });
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url ?? "/#/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      const win = wins.find((w) => new URL(w.url).origin === self.location.origin);
      // navigate() fails on some mobile PWAs: tell the app to route, fall back to opening a window.
      if (win) {
        return win
          .focus()
          .then(() => {
            win.postMessage({ type: "ancientvoid:navigate", url });
            return win.navigate(url).catch(() => undefined);
          })
          .catch(() => self.clients.openWindow(url));
      }
      return self.clients.openWindow(url);
    }),
  );
});

// The browser rotated the subscription: the app re-registers it on its
// next start (it holds the token, this worker does not).
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    self.clients.matchAll({ type: "window" }).then((wins) => wins.forEach((w) => w.postMessage({ type: "ancientvoid:push-resubscribe" }))),
  );
});
