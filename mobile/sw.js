/* Ice Maker Field Guide — service worker.
   The whole point of this app is a basement kitchen or a walk-in with no bars,
   so the shell and the catalog both have to survive with the radio off.

   VERSION is rewritten by _Tools/build_public_bundles.py at publish time, so a
   new deploy always lands in a fresh cache rather than serving last week's
   catalog out of a stale one. */
"use strict";

const VERSION = "eb9cd452c51d";
const SHELL_CACHE = "fieldguide-shell-" + VERSION;
const DATA_CACHE = "fieldguide-data-" + VERSION;

// Also rewritten at publish time (the bundle reads the slim rows the builder
// already emits for the other tools; locally we read the Compare app's copy).
const DATA_PATH = "../data/products_slim.json.enc";

// Relative so the same file works at /mobile/ on Pages and at / on a dev server.
// p/index.enc is the password gate's encrypted app shell (issue #93) — it only
// exists in the published build; the one-at-a-time install below tolerates the
// 404 on a dev server.
const SHELL = [
  "./",
  "./index.html",
  "./p/index.enc",
  "./app.js",
  "./styles.css",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-180.png",
];

// .enc: the published catalog ships encrypted (issue #93); dev reads plaintext.
const isData = (url) => /products(_slim)?\.json(\.enc)?$/.test(url.pathname);

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(SHELL_CACHE);
    // Two things going on here:
    //  - one at a time, tolerating failures: addAll is all-or-nothing, so a
    //    single missing icon would abort the install and leave the app with no
    //    offline support whatsoever;
    //  - cache: "reload", so a deploy can't be defeated by the HTTP cache
    //    handing us back the previous build's app.js under a new cache name.
    await Promise.all(SHELL.map(async (u) => {
      try {
        const r = await fetch(u, { cache: "reload" });
        if (r && (r.ok || r.type === "opaque")) await c.put(u, r);
      } catch (err) { /* offline install of a missing asset — skip it */ }
    }));

    // Pull the catalog down during install too. On a first visit the page's own
    // fetch starts before this worker controls anything, so without this the
    // first trip caches the shell and NOTHING else — open it once in the truck,
    // walk into the basement, and you get an app with no specs in it. The
    // second visit would have fixed itself, which is exactly the visit you
    // don't get underground.
    const d = await caches.open(DATA_CACHE);
    await d.add(DATA_PATH).catch(() => {});

    self.skipWaiting();
  })());
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    const keep = new Set([SHELL_CACHE, DATA_CACHE]);
    for (const k of await caches.keys()) {
      if (k.startsWith("fieldguide-") && !keep.has(k)) await caches.delete(k);
    }
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== location.origin) return;   // hub links go straight to the network

  // Navigations: network first so a deploy is picked up, cached shell when the
  // signal is gone. Without this an offline launch from the home screen shows
  // the browser's error page instead of the app.
  if (req.mode === "navigate") {
    e.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const c = await caches.open(SHELL_CACHE);
        c.put("./index.html", fresh.clone());
        return fresh;
      } catch (err) {
        return (await caches.match("./index.html")) || Response.error();
      }
    })());
    return;
  }

  // The catalog: serve the saved copy immediately, refresh it in the background.
  // At ~2 MB a network-first fetch would stall the first paint on a weak signal,
  // and the specs on it change on a publish cadence, not a per-minute one.
  if (isData(url)) {
    e.respondWith((async () => {
      const c = await caches.open(DATA_CACHE);
      const hit = await c.match(req);
      const net = fetch(req).then((r) => {
        if (r && r.ok) c.put(req, r.clone());
        return r;
      }).catch(() => null);
      return hit || (await net) || Response.error();
    })());
    return;
  }

  // Everything else (shell assets): cache first, fall back to the network.
  e.respondWith((async () => {
    const hit = await caches.match(req);
    if (hit) return hit;
    try {
      const fresh = await fetch(req);
      if (fresh && fresh.ok && fresh.type === "basic") {
        const c = await caches.open(SHELL_CACHE);
        c.put(req, fresh.clone());
      }
      return fresh;
    } catch (err) {
      return Response.error();
    }
  })());
});
