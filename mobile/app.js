/* Ice Maker Field Guide — phone-first lookup over the master product DB.
   Static, no build step, no framework. Issue #78. */
"use strict";

/* ---------------- config ---------------- */

// The published bundle sets MOBILE_DATA_URL to the slim rows the builder already
// emits for the other tools; locally we read the Compare app's copy so there is
// exactly one source of product truth either way.
const DATA_URL = window.MOBILE_DATA_URL || "../_Compare_App/products.json";

const HUB = "https://heathjaro.github.io/ice-maker-review/";

const F = {
  brand: "Brand",
  model: "Model Number",
  series: "Product Line / Series",
  itemType: "Item Type",
  desc: "Description",
  life: "Lifecycle Status",
  sheet: "Spec Sheet URL",
};

/* ---------------- the card a tech reads on site ----------------
   Ordered by what you need standing in front of the machine, which is not the
   order the Compare app uses (that one leads with price and production for a
   sales conversation). Power and refrigerant come first here; price is not on
   this screen at all — list price is reference-only and never comparable
   cross-brand, so it has no business on a service card. */

const SPEC_SECTIONS = [
  ["Electrical", [
    ["Voltage", "Voltage"],
    ["Phase", "Phase"],
    ["Amperage (MCA)", "Amperage (MCA)"],
    ["NEMA plug", "NEMA Plug"],
    ["HP / Watts", "HP / Watts"],
  ]],
  ["Refrigeration", [
    ["Refrigerant type", "Refrigerant Type"],
    ["Charge (oz)", "Refrigerant Charge (oz)"],
    ["Condenser type", "Condenser Type"],
    ["Compressor location", "Compressor Location"],
    ["Heat rejection (BTU/hr)", "Heat Rejection (BTU/hr)"],
  ]],
  ["Water", [
    ["Inlet connection", "Water Inlet Connection"],
    ["Usage (gal/100 lbs ice)", "Water Usage (gal/100 lbs ice)"],
    ["Water-cooled condenser (GPH)", "Water Cooled Condenser GPH"],
  ]],
  ["Dimensions & weight", [
    ["Width (in)", "Width (in)"],
    ["Depth (in)", "Depth (in)"],
    ["Height (in)", "Height (in)"],
    ["Net weight (lbs)", "Net Weight (lbs)"],
    ["Shipping weight (lbs)", "Shipping Weight (lbs)"],
  ]],
  ["Ice & capacity", [
    ["Ice type", "Ice Type"],
    ["Ice shape", "Ice Shape"],
    ["Ice dimensions", "Ice Dimensions"],
    ["Production @ 90°F/70°F (lbs/24hr)", "90F air / 70F water Production"],
    ["Production @ 70°F/50°F (lbs/24hr)", "70F air / 50F water Production (lbs/24hr)"],
    ["Energy (kWh/100 lbs @ 90/70)", "Energy Consumption (kWh/100 lbs ice @ 90F/70F)"],
    ["Built-in storage (lbs)", "Built-in Storage (lbs)"],
    ["Max bin capacity (lbs)", "Max Bin Capacity (lbs)"],
    ["Recommended bin(s)", "Recommended Bin(s)"],
  ]],
  ["Listings", [
    ["NSF listed", "NSF Listed"],
    ["ENERGY STAR", "ENERGY STAR"],
    ["AHRI certified", "AHRI Certified"],
  ]],
  ["Record", [
    ["Series", "Product Line / Series"],
    ["Lifecycle status", "Lifecycle Status"],
    ["Last validated", "Last Validated Date"],
    ["Validated against", "Last Validated Against"],
    ["Discontinued", "Discontinued Date"],
  ]],
];

/* ---------------- helpers ---------------- */

const $ = (s) => document.querySelector(s);
const has = (v) => v !== undefined && v !== null && v !== "";
const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;");

let products = [];
let byId = new Map();
let lastResults = [];

// Rows have no id of their own; brand+model is unique in practice and survives
// a rebuild, which a row index would not (deep links would silently retarget).
const pid = (p) => `${p[F.brand]}|${p[F.model]}`;

/* ---------------- search ----------------
   Ported from _Compare_App/app.js (PR #77, merged 2026-07-31). Kept
   deliberately identical so a tech and a salesperson typing the same thing get
   the same machine — if you change one, change both. */

const searchNorm = (s) => String(s == null ? "" : s).toLowerCase().replace(/[^a-z0-9]/g, "");

const normTokens = (s) =>
  String(s == null ? "" : s).toLowerCase().split(/\s+/).map(searchNorm).filter(Boolean).join(" ");

const SEARCH_ROLE_RANK = {
  "Modular Ice Maker": 3, "Self-contained Ice Maker": 3, "Ice Maker Dispenser": 3,
  "Ice Dispenser": 2, "Storage Bin": 2, "Remote Condenser": 2,
  // issue #103 -- keep in step with Compare (exact-match keys: "Ice Tote System"
  // must not be confused with the "Ice Tote" accessory)
  "Ice Transport Cart": 2, "Ice Bagger": 2, "Ice Tote System": 2,
};
const roleRank = (p) => SEARCH_ROLE_RANK[p[F.itemType]] || 1;

function searchIndex(p) {
  if (p.__six) return p.__six;
  const model = (p[F.model] || "").toLowerCase();
  const hay = `${p[F.brand]} ${p[F.model]} ${p[F.series] || ""} ${p[F.itemType] || ""} ${p[F.desc] || ""}`.toLowerCase();
  return (p.__six = {
    model,
    nModel: searchNorm(model),
    nBrand: searchNorm(p[F.brand]),
    nHay: normTokens(hay),
    rank: roleRank(p),
  });
}

let brandKeyCache = null;
function brandKeys() {
  if (!brandKeyCache) brandKeyCache = new Set(products.map((p) => searchNorm(p[F.brand])));
  return brandKeyCache;
}

function termScore(ix, t, nt) {
  if (ix.model === t || ix.nModel === nt) return 100;
  if (ix.nModel.startsWith(nt)) return 60;
  if (ix.nModel.includes(nt)) return 30;
  if (ix.nHay.includes(nt)) return 10;
  return -1;
}

function splitBrandTerm(rawTerms) {
  const brands = brandKeys();
  let brand = null;
  const terms = [];
  for (const t of rawTerms) {
    const nt = searchNorm(t);
    if (!nt) continue;
    if (!brand) {
      if (brands.has(nt)) { brand = nt; continue; }
      if (nt.length >= 4) {
        const hits = [...brands].filter((b) => b.startsWith(nt));
        if (hits.length === 1) { brand = hits[0]; continue; }
      }
    }
    terms.push([t, nt]);
  }
  if (!terms.length && brand) terms.push([brand, brand]);
  return { brand, terms };
}

function searchProducts(q) {
  const { brand, terms } = splitBrandTerm(q.toLowerCase().split(/\s+/).filter(Boolean));
  if (!terms.length) return [];
  const nQuery = searchNorm(q);
  const scored = [];
  for (const p of products) {
    const ix = searchIndex(p);
    if (brand && !ix.nBrand.startsWith(brand)) continue;
    let score = brand ? 20 : 0;
    if (nQuery && ix.nModel === nQuery) score += 200;
    let ok = true;
    for (const [t, nt] of terms) {
      const s = termScore(ix, t, nt);
      if (s < 0) { ok = false; break; }
      score += s;
    }
    if (!ok) continue;
    score += ix.rank * 25;
    scored.push([score, p]);
  }
  scored.sort((a, b) => b[0] - a[0]);
  return scored.slice(0, 40).map((x) => x[1]);
}

function suggestProducts(q) {
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean)
    .map((t) => [t, searchNorm(t)]).filter((x) => x[1]);
  if (!terms.length) return [];
  const scored = [];
  for (const p of products) {
    const ix = searchIndex(p);
    let best = 0, hits = 0;
    for (const [t, nt] of terms) {
      let s = termScore(ix, t, nt);
      if (s < 30) {
        for (let n = nt.length - 1; n >= 4; n--) {
          if (ix.nModel.startsWith(nt.slice(0, n))) { s = 30 + n; break; }
        }
      }
      if (s >= 30) { hits++; if (s > best) best = s; }
    }
    if (!hits) continue;
    scored.push([best + hits * 20 + ix.rank * 25, p]);
  }
  scored.sort((a, b) => b[0] - a[0]);
  return scored.slice(0, 10).map((x) => x[1]);
}

function runSearch(q) {
  const list = searchProducts(q);
  if (list.length) return { list, suggested: false };
  return { list: suggestProducts(q), suggested: true };
}

/* ---------------- rendering ---------------- */

function badge(p) {
  const life = p[F.life];
  if (life === "Discontinued") return '<span class="badge disc">Discontinued</span>';
  if (life === "Unknown") return '<span class="badge unk">Status unknown</span>';
  return "";
}

function cardHTML(p) {
  const bits = [];
  if (has(p[F.itemType])) bits.push(esc(p[F.itemType]));
  const prod = p["90F air / 70F water Production"] ?? p["70F air / 50F water Production (lbs/24hr)"];
  if (has(prod)) bits.push(`<b>${esc(prod)}</b> lbs/24hr`);
  if (has(p["Voltage"])) bits.push(`${esc(p["Voltage"])}V`);
  return `<button class="card" data-id="${esc(pid(p))}">
    <span class="card-top">
      <span class="model">${esc(p[F.model])}</span>
      ${badge(p)}
    </span>
    <span class="brand">${esc(p[F.brand])}</span>
    <span class="meta">${bits.join(" &middot; ")}</span>
  </button>`;
}

function renderList(el, list) {
  el.innerHTML = list.map(cardHTML).join("");
}

// A tile shows a value or says outright that we don't hold one. A blank cell on
// a phone in a mechanical room reads as "zero" or "not applicable"; both are
// wrong and both are dangerous when the number is an amp draw.
function tile(key, val, sub) {
  // "30 × 27.38 × 32.5" is a lot of glyphs for half a phone; step the size down
  // rather than let one tile wrap to three lines and shove the grid around.
  const long = has(val) && String(val).length > 13 ? " long" : "";
  const v = has(val)
    ? `<div class="g-v${long}">${esc(val)}</div>`
    : `<div class="g-v none">Not on file</div>`;
  return `<div class="g"><div class="g-k">${esc(key)}</div>${v}` +
    (has(sub) && has(val) ? `<div class="g-sub">${esc(sub)}</div>` : "") + `</div>`;
}

function dims(p) {
  const w = p["Width (in)"], d = p["Depth (in)"], h = p["Height (in)"];
  if (!has(w) && !has(d) && !has(h)) return null;
  const n = (x) => (has(x) ? x : "?");
  return `${n(w)} × ${n(d)} × ${n(h)}`;
}

function glanceHTML(p) {
  const volts = has(p["Voltage"])
    ? p["Voltage"] + "V" + (has(p["Phase"]) ? ` / ${p["Phase"]}ph` : "")
    : "";
  const amps = has(p["Amperage (MCA)"]) ? `${p["Amperage (MCA)"]} A (MCA)` : "";
  const charge = has(p["Refrigerant Charge (oz)"]) ? `${p["Refrigerant Charge (oz)"]} oz charge` : "";
  return `<div class="glance">
    ${tile("Power", volts, amps)}
    ${tile("Refrigerant", p["Refrigerant Type"], charge)}
    ${tile("W × D × H (in)", dims(p), "")}
    ${tile("Water inlet", p["Water Inlet Connection"], "")}
  </div>`;
}

// Bin recommendations are free text ("B322S, B42PS"). Any token that is itself a
// row in the DB becomes a tap target, so a tech can jump head -> bin without
// retyping a model number one-handed on a ladder.
function linkModels(text) {
  return esc(text).split(/([A-Za-z0-9][A-Za-z0-9\-\/@.]{2,})/).map((tok) => {
    const hit = findByModel(tok);
    return hit ? `<a href="#/p/${encodeURIComponent(pid(hit))}">${esc(tok)}</a>` : tok;
  }).join("");
}

let modelIndex = null;
function findByModel(tok) {
  if (!modelIndex) {
    modelIndex = new Map();
    for (const p of products) {
      const k = searchNorm(p[F.model]);
      if (k && !modelIndex.has(k)) modelIndex.set(k, p);
    }
  }
  const n = searchNorm(tok);
  return n.length >= 3 ? modelIndex.get(n) : null;
}

/* ---------------- troubleshooting (issue #90) ----------------
   The LED guides from the old IOM app, ported. A tech reads the flashing light
   on the front of the machine and answers yes/no until they reach a repair
   action. No radio and no backend: this is the one part of the old app that
   works with nothing but eyes on the cabinet — which is also why it survived
   the loss of Hyvery's infrastructure intact.

   Content is Hyvery's, verbatim (source typos included). It is service
   guidance for someone working on a live machine; rewording it would be
   changing the instructions. */

const TS_RED = "#F3352F", TS_YELLOW = "#FFF100";

// Pattern key, flash count and LED colors — the physical blink, which is all
// this file carries. The guide titles (they name the faults) and the
// older-boards caveat are ported IOM service text, so they ride inside the
// encrypted payload (`_meta` in troubleshooting.json, emitted by the
// extractor): the published app.js is served plaintext and must not carry
// old-app content (#93).
const TS_GUIDES = [
  ["redQuickFlash", 1, TS_RED, TS_RED],
  ["redDoubleFlash", 2, TS_RED, TS_RED],
  ["redTripleQuickFlash", 3, TS_RED, TS_RED],
  ["redYellowQuickFlash", 1, TS_RED, TS_YELLOW],
  ["redYellowDoubleQuickFlash", 2, TS_RED, TS_YELLOW],
  ["redYellowTripleQuickFlash", 3, TS_RED, TS_YELLOW],
];
const TS_COUNT_WORD = { 1: "once", 2: "twice", 3: "three times" };

// The old app gated troubleshooting on model.slice(0,3) === 'CIM'. These trees
// were written against CIM boards; offering them for a Scotsman would be
// inventing guidance we don't have.
const isCIM = (p) => String(p[F.model] || "").slice(0, 3).toUpperCase() === "CIM";

let tsData = null, tsLoading = null;
let tsTree = null;      // which guide is open
let tsPath = [];        // branch keys taken so far

// 92 KB, and most sessions never open it — so it loads on demand rather than at
// boot. The service worker precaches it, so "on demand" still works offline.
function loadTs() {
  if (tsData) return Promise.resolve(tsData);
  if (!tsLoading) {
    tsLoading = fetch("data/troubleshooting.json.enc")
      .then((r) => { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then((d) => (tsData = d))
      .catch((e) => { tsLoading = null; throw e; });
  }
  return tsLoading;
}

// Walk the tree by the branch keys taken. Branch keys are the first three
// characters of the answer text — the old app's own convention
// (answer.slice(0,3)), kept so the data needs no rewriting.
function tsNode() {
  let n = tsData[tsTree];
  for (const step of tsPath) {
    if (!n || !n[step]) return null;
    n = n[step];
  }
  return n;
}

function ledDots(n, c1, c2) {
  // blink-<n> animates the whole group with the old app's loop for that count
  // (timings in styles.css); color rides along so the lit glow matches the dot.
  let out = "";
  for (let i = 0; i < n; i++) {
    out += `<span class="led" style="background:${c1};color:${c1}"></span>`;
    if (c2 !== c1) out += `<span class="led" style="background:${c2};color:${c2}"></span>`;
  }
  return `<span class="leds blink-${n}">${out}</span>`;
}

function renderTsPicker() {
  $("#ts-body").innerHTML = `
    <h1>Troubleshooting</h1>
    <p class="dim">Read the flashing light on the front of the machine, then pick
       the pattern that matches.</p>
    <details class="ts-caveat">
      <summary>Before you start — flash patterns overlap on older boards</summary>
      <p>${esc(tsData._meta.caveat)}</p>
    </details>
    <div class="cardlist">
      ${TS_GUIDES.map(([key, n, c1, c2]) => `
        <button class="card ts-guide" data-ts="${key}">
          <span class="card-top">${ledDots(n, c1, c2)}</span>
          <span class="model">${esc(tsData._meta.titles[key])}</span>
          <span class="meta">Light blinks ${esc(TS_COUNT_WORD[n])} per every <b>1/2</b> second</span>
        </button>`).join("")}
    </div>`;
}

function renderTsNode() {
  const node = tsNode();
  const el = $("#ts-body");
  const guide = TS_GUIDES.find((g) => g[0] === tsTree);
  const head = `<div class="ts-head">
      <div class="ts-crumb">${ledDots(guide[1], guide[2], guide[3])} ${esc(tsData._meta.titles[tsTree])}</div>
      ${tsPath.length ? `<div class="ts-step">Step ${tsPath.length + 1}</div>` : ""}
    </div>`;

  if (!node) {
    el.innerHTML = head + `<div class="empty"><b>That path runs out here.</b>
      The guide has no further step recorded.</div>
      <button class="ts-restart" type="button">Start this guide over</button>`;
    return;
  }

  // Terminal: the guide is exhausted and the tech needs a human.
  if (node.contact && !(node.buttons || []).length) {
    el.innerHTML = head + `
      <div class="ts-terminal contact">
        <b>Time to call for help.</b>
        <p>This guide has run out of steps for the symptoms you've described.
           Contact Ice-O-Matic technical service with the model and serial number
           and the answers you gave here.</p>
      </div>
      <button class="ts-restart" type="button">Start this guide over</button>
      <button class="ts-pick" type="button">Choose a different light pattern</button>`;
    return;
  }

  // Terminal: nothing more to do — send them back to the top.
  if (node.toStart && !(node.buttons || []).length) {
    el.innerHTML = head + `
      <div class="ts-terminal done"><b>That should be it.</b>
        <p>If the fault comes back, start again — or work the adjacent flash
           pattern, since older boards share patterns between faults.</p></div>
      <button class="ts-restart" type="button">Start this guide over</button>
      <button class="ts-pick" type="button">Choose a different light pattern</button>`;
    return;
  }

  const opts = node.buttons || [];
  const buttons = opts.map((b) =>
    `<button class="ts-answer" type="button" data-ans="${esc(b)}">${esc(b)}</button>`
  ).join("");
  // Yes/no is a decision; three-plus options is a "which kind of machine is
  // this" list. Style the whole set, not individual positions — picking out the
  // third option made Remote Cooled look like a lesser answer than Air Cooled.
  const multi = opts.length > 2 ? " multi" : "";

  el.innerHTML = head +
    (has(node.info) ? `<div class="ts-info">${esc(node.info)}</div>` : "") +
    (has(node.question) ? `<div class="ts-question">${esc(node.question)}</div>` : "") +
    `<div class="ts-answers${multi}">${buttons}</div>` +
    (tsPath.length ? `<button class="ts-restart ts-sep" type="button">Start this guide over</button>` : "");
}

function renderTroubleshoot() {
  if (!tsData) {
    $("#ts-body").innerHTML = `<div class="empty">Loading the guides&hellip;</div>`;
    loadTs().then(renderTroubleshoot).catch(() => {
      $("#ts-body").innerHTML =
        `<div class="empty"><b>Couldn't load the guides.</b>
         Open the app once with a signal and they'll be saved for offline use.</div>`;
    });
    return;
  }
  if (tsTree && tsData[tsTree]) renderTsNode();
  else renderTsPicker();
  window.scrollTo(0, 0);
}

function renderDetail(p) {
  const el = $("#detail");
  const life = p[F.life];

  let warn = "";
  if (life === "Discontinued") {
    warn = `<div class="disc-warn"><b>No longer sold.</b> Kept here on purpose —
      you'll still meet these in the field. Specs are the last ones on record
      ${has(p["Discontinued Date"]) ? `(off the list ${esc(p["Discontinued Date"])})` : ""}.</div>`;
  } else if (life === "Unknown") {
    warn = `<div class="disc-warn"><b>Status unknown.</b> This model isn't on the
      latest price list we hold, so it may have been withdrawn. The specs below
      still stand.</div>`;
  }

  const sections = SPEC_SECTIONS.map(([name, fields]) => {
    const present = fields.filter(([, f]) => has(p[f]));
    if (!present.length) return "";
    const rows = fields.map(([label, f]) => {
      let v = p[f];
      let cls = "v", out;
      if (!has(v)) { cls = "v none"; out = "Not on file"; }
      else if (f === "Recommended Bin(s)") out = linkModels(v);
      else out = esc(v);
      return `<div class="row"><span class="k">${esc(label)}</span><span class="${cls}">${out}</span></div>`;
    }).join("");
    const open = name === "Electrical" || name === "Refrigeration" ? " open" : "";
    return `<details class="spec-sec"${open}>
      <summary>${esc(name)}<span class="n">${present.length}/${fields.length}</span></summary>
      <div class="rows">${rows}</div>
    </details>`;
  }).join("");

  // Bins have no sheet of their own more often than not; say which it is rather
  // than rendering a dead button. In the published build the row's own field is
  // gone (the shared slim payload drops it), so fall back to the side map the
  // builder injects — it holds the entries that are real URLs rather than bare
  // local filenames.
  const url = p[F.sheet] || (window.SHEET_URLS || {})[pid(p)];
  const sheet = has(url) && /^https?:/i.test(url)
    ? `<a class="sheet-link" href="${esc(url)}" target="_blank" rel="noopener">Open the spec sheet (PDF)</a>`
    : `<span class="sheet-link off">No spec sheet on file</span>`;

  el.innerHTML = `
    <div class="d-head">
      <div class="d-brand">${esc(p[F.brand])}</div>
      <h1>${esc(p[F.model])} ${badge(p)}</h1>
      <div class="d-type">${esc(p[F.itemType] || "")}${
        has(p[F.series]) ? " &middot; " + esc(p[F.series]) : ""}</div>
    </div>
    ${warn}
    ${glanceHTML(p)}
    ${isCIM(p) ? `<a class="ts-entry" href="#/ts">
        <span class="ts-entry-t">🔴 Troubleshoot a flashing light</span>
        <span class="ts-entry-s">Guided fault-finding for CIM boards — works offline</span>
      </a>` : ""}
    ${has(p[F.desc]) ? `<p class="d-desc">${esc(p[F.desc])}</p>` : ""}
    ${sections}
    ${sheet}`;
  el.scrollIntoView({ block: "start" });
}

/* ---------------- recents ---------------- */

const RECENT_KEY = "fieldguide.recent.v1";

function getRecents() {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY)) || []; }
  catch (e) { return []; }
}
function pushRecent(id) {
  try {
    const list = [id, ...getRecents().filter((x) => x !== id)].slice(0, 8);
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch (e) { /* private browsing — recents are a convenience, not a feature */ }
  renderRecents();
}
function renderRecents() {
  const list = getRecents().map((id) => byId.get(id)).filter(Boolean);
  $("#recents-wrap").hidden = !list.length;
  if (list.length) renderList($("#recents"), list);
}

/* ---------------- routing ---------------- */

function showView(name) {
  for (const v of document.querySelectorAll(".view")) {
    v.classList.toggle("active", v.id === "view-" + name);
  }
  const tab = name === "tools" ? "tools" : "lookup";
  for (const b of document.querySelectorAll("#tabbar button")) {
    b.setAttribute("aria-selected", String(b.dataset.tab === tab));
  }
}

function route() {
  const h = location.hash.replace(/^#\/?/, "");
  if (h.startsWith("p/")) {
    const p = byId.get(decodeURIComponent(h.slice(2)));
    if (p) { renderDetail(p); pushRecent(pid(p)); showView("detail"); return; }
  }
  if (h === "ts" || h.startsWith("ts/")) {
    // Entering by hash always starts the guide at its first question — a
    // half-finished diagnostic path is not something to restore from a URL.
    const want = h.startsWith("ts/") ? decodeURIComponent(h.slice(3)) : null;
    if (want !== tsTree) { tsTree = want; tsPath = []; }
    showView("troubleshoot");
    renderTroubleshoot();
    return;
  }
  if (h === "tools") { showView("tools"); return; }
  const q = $("#search").value.trim();
  showView(q ? "results" : "home");
}

/* ---------------- tools tab (Hayes M.'s ask) ---------------- */

const TOOLS = [
  ["Compare", "#compare", "Any machine's spec card next to its closest Ice-O-Matic equivalents."],
  ["Insights", "#insights", "Market-grid heatmap, gap lists and price-vs-capacity across 12 brands."],
  ["Finder", "#finder", "Guided sizing: daily ice demand to a machine + bin + condenser."],
  ["Database", "#database", "Every product and spec column as one searchable, downloadable table."],
  ["Scoreboard", "#scoreboard", "Every change to these tools that came from someone's feedback."],
];

function renderTools() {
  $("#tools").innerHTML = TOOLS.map(([name, hash, blurb]) =>
    `<a class="card tool" href="${HUB}${hash}" target="_blank" rel="noopener">
      <span class="card-top"><span class="model">${esc(name)}</span></span>
      <span class="meta">${esc(blurb)}</span>
    </a>`).join("");
}

/* ---------------- boot ---------------- */

function onSearch() {
  const q = $("#search").value.trim();
  $("#search-clear").hidden = !q;
  if (location.hash) { history.replaceState(null, "", location.pathname + location.search); }
  if (!q) { showView("home"); return; }
  const { list, suggested } = runSearch(q);
  lastResults = list;
  const note = $("#results-note");
  if (!list.length) {
    $("#results").innerHTML =
      `<div class="empty"><b>Nothing matches “${esc(q)}”</b>
       Check the nameplate again, or try just the family — <b>KM1100</b> rather than the full suffix.</div>`;
    note.hidden = true;
  } else {
    note.hidden = !suggested;
    if (suggested) note.textContent = `No exact match for “${q}” — closest models we hold:`;
    renderList($("#results"), list);
  }
  showView("results");
}

function setOffline(off) {
  document.body.classList.toggle("is-offline", off);
  $("#offline-bar").hidden = !off;
}

function boot(rows) {
  products = rows;
  byId = new Map(rows.map((p) => [pid(p), p]));
  const machines = rows.filter((p) => roleRank(p) === 3).length;
  $("#db-line").textContent =
    `${rows.length.toLocaleString()} products on file, ${machines.toLocaleString()} of them machines.`;
  renderRecents();
  renderTools();
  route();
}

fetch(DATA_URL)
  .then((r) => { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
  .then(boot)
  .catch((err) => {
    $("#db-line").innerHTML =
      `<b>Couldn't load the catalog</b> (${esc(err.message)}). ` +
      `If you opened this from a file rather than a web address, the browser blocks the data load — ` +
      `use <a href="${HUB}">the live site</a>.`;
  });

/* events */
$("#search").addEventListener("input", onSearch);
$("#search").addEventListener("search", onSearch);
$("#search-clear").addEventListener("click", () => {
  $("#search").value = ""; $("#search-clear").hidden = true; $("#search").focus(); showView("home");
});
$("#recents-clear").addEventListener("click", () => {
  try { localStorage.removeItem(RECENT_KEY); } catch (e) {}
  renderRecents();
});
$("#back-btn").addEventListener("click", () => {
  if (history.length > 1) history.back();
  else { location.hash = ""; showView(lastResults.length ? "results" : "home"); }
});
// Step back one question; from a guide's first question go back to the picker;
// from the picker leave troubleshooting altogether.
$("#ts-back").addEventListener("click", () => {
  if (tsPath.length) { tsPath.pop(); renderTroubleshoot(); return; }
  if (tsTree) { tsTree = null; renderTroubleshoot(); return; }
  if (history.length > 1) history.back();
  else { location.hash = ""; showView("home"); }
});

document.addEventListener("click", (e) => {
  const card = e.target.closest(".card[data-id]");
  if (card) { location.hash = "#/p/" + encodeURIComponent(card.dataset.id); return; }

  const guide = e.target.closest(".ts-guide");
  if (guide) { tsTree = guide.dataset.ts; tsPath = []; renderTroubleshoot(); return; }

  const ans = e.target.closest(".ts-answer");
  if (ans) {
    // The old app keyed branches on the first three characters of the answer
    // ('water cooled' -> 'wat'). Keep that so the extracted data stays untouched.
    tsPath.push(ans.dataset.ans.slice(0, 3));
    renderTroubleshoot();
    return;
  }
  if (e.target.closest(".ts-restart")) { tsPath = []; renderTroubleshoot(); return; }
  if (e.target.closest(".ts-pick")) { tsTree = null; tsPath = []; renderTroubleshoot(); return; }

  const tab = e.target.closest("#tabbar button");
  if (tab) {
    if (tab.dataset.tab === "tools") location.hash = "#tools";
    else { location.hash = ""; showView($("#search").value.trim() ? "results" : "home"); }
  }
});
window.addEventListener("hashchange", route);
window.addEventListener("online", () => setOffline(false));
window.addEventListener("offline", () => setOffline(true));
setOffline(!navigator.onLine);

/* ---------------- install prompt ---------------- */

const isStandalone = window.matchMedia("(display-mode: standalone)").matches ||
  window.navigator.standalone === true;
const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent);
let deferredPrompt = null;

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredPrompt = e;
  showInstallTip("Keep it one tap away, and it'll work with no signal.", true);
});

function showInstallTip(msg, canPrompt) {
  if (isStandalone) return;
  try { if (localStorage.getItem("fieldguide.install.dismissed")) return; } catch (e) {}
  $("#install-how").textContent = msg;
  $("#install-btn").hidden = !canPrompt;
  $("#install-tip").hidden = false;
}

// iOS fires no beforeinstallprompt — Safari only ever offers Add to Home Screen
// from its own share sheet, so the tip has to describe it in words.
if (isIOS && !isStandalone) {
  showInstallTip("Tap the Share button, then “Add to Home Screen”. It'll work with no signal.", false);
}

$("#install-btn").addEventListener("click", async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  $("#install-tip").hidden = true;
});
$("#install-dismiss").addEventListener("click", () => {
  $("#install-tip").hidden = true;
  try { localStorage.setItem("fieldguide.install.dismissed", "1"); } catch (e) {}
});

/* ---------------- service worker ---------------- */

// Registration is best-effort: file:// and any non-secure origin have no
// serviceWorker at all, and the app must still work as a plain page there.
// (Browsers treat localhost as a secure context, which is what makes the local
// dev server able to exercise the offline path at all.)
const swEligible = "serviceWorker" in navigator &&
  (location.protocol === "https:" || location.hostname === "localhost");
if (swEligible) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js")
      .catch(() => { /* offline support is a bonus, not a dependency */ });
  });
}
