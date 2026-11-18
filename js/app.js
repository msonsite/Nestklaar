import { SECTIONS, REMINDERS } from "./data.js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";
import { LocalStore, CloudStore } from "./store.js";

const SUPABASE_JS = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/+esm";

/* ─── Hulpjes ───────────────────────────────────────────────────────────── */
const $ = (s, el = document) => el.querySelector(s);
const el = (tag, props = {}, ...kids) => {
  const n = Object.assign(document.createElement(tag), props);
  for (const k of kids) if (k != null) n.append(k);
  return n;
};
const fmtMoney = (n) => new Intl.NumberFormat("nl-BE", { style: "currency", currency: "EUR" }).format(n || 0);
const fmtInput = (n) => (n == null ? "" : n.toLocaleString("nl-BE", { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false }));
const parsePrice = (s) => {
  const clean = String(s).replace(/[^\d,.-]/g, "").replace(/\.(?=.*[.,])/g, "").replace(",", ".");
  if (clean === "") return null;
  const n = Number(clean);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
};
const PRIO_LABEL = { E: "Essentieel", A: "Aan te raden", X: "Extra" };
const remember = {
  get: (k, d) => { try { return JSON.parse(localStorage.getItem("nestklaar." + k)) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem("nestklaar." + k, JSON.stringify(v)); } catch { /* */ } },
};

let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2800);
}
function errorText(err) {
  const m = (err && (err.message || err.error_description)) || "";
  if (/Failed to fetch|NetworkError|network/i.test(m)) return "Geen verbinding. Controleer je internet en probeer opnieuw.";
  if (/relation .*items|does not exist|schema cache/i.test(m)) return "De database is nog niet klaar. Voer supabase/schema.sql uit in Supabase.";
  return m || "Er ging iets mis. Probeer opnieuw.";
}

function showScreen(name) {
  for (const s of document.querySelectorAll(".screen")) s.hidden = s.id !== "screen-" + name;
}

/* ─── Toestand ──────────────────────────────────────────────────────────── */
let store = null;       // LocalStore of CloudStore
let items = [];
let filter = "all";
let query = "";
let expanded = new Set(remember.get("expanded", []));
const pendingPrice = new Map();   // id -> timeout

/* ─── Opstart ───────────────────────────────────────────────────────────── */
async function boot() {
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(() => {});
  $("#reminders").append(...REMINDERS.map((r) => el("li", { textContent: r })));
  wireStaticUI();
  const bar = $(".topbar");
  new ResizeObserver(() => document.documentElement.style.setProperty("--bar-total", bar.offsetHeight + "px")).observe(bar);

  if (SUPABASE_URL && SUPABASE_ANON_KEY) {
    try {
      const { createClient } = await import(SUPABASE_JS);
      const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
      store = new CloudStore(sb);
    } catch {
      showScreen("app");
      setSync("Offline");
      toast("Geen verbinding. Open de app opnieuw met internet.");
      return;
    }
  } else {
    store = new LocalStore();
  }
  await openList();
}

async function openList() {
  showScreen("app");
  const shared = store.mode === "cloud";
  $("#list-name").textContent = shared ? "Gedeelde lijst" : "Op dit toestel";
  $("#footnote").textContent = shared
    ? "Wijzigingen worden meteen gedeeld met iedereen die de app gebruikt."
    : "Lokale modus: je gegevens staan enkel op dit toestel.";
  if (shared) setSync("Laden…");
  try {
    items = await store.loadItems();
    setSync("");
  } catch (e) {
    setSync("Offline");
    toast(errorText(e));
    items = [];
  }
  store.subscribe(onRemote);
  fillCategorySelect();
  render();
}

function setSync(text) { $("#sync").textContent = text; }

/* ─── Live updates ──────────────────────────────────────────────────────── */
function onRemote(type, row) {
  if (type === "delete") {
    const i = items.findIndex((x) => x.id === row.id);
    if (i < 0) return;
    items.splice(i, 1);
  } else {
    const existing = items.find((x) => x.id === row.id);
    if (existing) {
      if (pendingPrice.has(row.id)) delete row.price; // eigen typwerk niet overschrijven
      Object.assign(existing, row);
    } else {
      items.push(row);
    }
  }
  refresh();
}

// Niet hertekenen terwijl iemand een bedrag aan het typen is
function refresh() {
  const active = document.activeElement;
  if (active && active.classList.contains("price")) { patchRows(); updateSummary(); }
  else render();
}

document.addEventListener("visibilitychange", async () => {
  if (document.visibilityState !== "visible" || store?.mode !== "cloud") return;
  try { items = await store.loadItems(); refresh(); setSync(""); } catch { setSync("Offline"); }
});
window.addEventListener("offline", () => setSync("Offline"));
window.addEventListener("online", () => { setSync(""); if (store?.mode === "cloud") store.loadItems().then((d) => { items = d; refresh(); }); });

/* ─── Weergave ──────────────────────────────────────────────────────────── */
function categories() {
  const order = SECTIONS.map((s) => s.title);
  for (const it of items) if (!order.includes(it.category)) order.push(it.category);
  return order;
}

function matches(it) {
  if (query && !it.name.toLowerCase().includes(query)) return false;
  if (filter === "todo") return !it.done;
  if (filter === "done") return it.done;
  if (filter === "E") return it.priority === "E";
  return true;
}

function render() {
  const list = $("#list");
  const chips = $("#chips");
  list.replaceChildren();
  chips.replaceChildren();
  let shown = 0;

  categories().forEach((cat, ci) => {
    const all = items.filter((i) => i.category === cat).sort((a, b) => a.sort - b.sort);
    const rows = all.filter(matches);
    if (!rows.length) return;
    shown += rows.length;
    const done = all.filter((i) => i.done).length;
    const open = !!query || expanded.has(cat);
    const roomId = "room-" + ci;

    // Chip
    const chip = el("button", { className: "chip" + (done === all.length ? " full" : ""), type: "button" },
      cat.replace(/^Keuken – /, "Keuken: "), el("b", { textContent: `${done}/${all.length}` }));
    chip.onclick = () => {
      if (!expanded.has(cat)) { expanded.add(cat); remember.set("expanded", [...expanded]); render(); }
      document.getElementById(roomId)?.scrollIntoView({ behavior: "smooth", block: "start" });
    };
    chips.append(chip);

    // Kop
    const head = el("button", { className: "room-head", type: "button" },
      el("span", { className: "room-title", textContent: cat }),
      el("span", { className: "room-count", textContent: `${done}/${all.length}` }),
      el("span", { className: "room-bar" }, el("i", { style: `width:${all.length ? (done / all.length) * 100 : 0}%` })),
    );
    head.insertAdjacentHTML("beforeend", '<svg class="chev" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" d="m9 6 6 6-6 6"/></svg>');
    head.setAttribute("aria-expanded", String(open));
    head.setAttribute("aria-controls", roomId + "-items");
    head.onclick = () => {
      expanded.has(cat) ? expanded.delete(cat) : expanded.add(cat);
      remember.set("expanded", [...expanded]);
      render();
    };

    const ul = el("ul", { className: "items", id: roomId + "-items" });
    ul.hidden = !open;
    if (open) ul.append(...rows.map(itemRow));

    list.append(el("section", { className: "room", id: roomId }, head, ul));
  });

  if (!shown) {
    list.append(el("p", { className: "empty", textContent: items.length
      ? "Niets gevonden. Pas je zoekterm of filter aan."
      : "Deze lijst is nog leeg. Voeg je eerste item toe met de plusknop." }));
  }
  updateSummary();
}

function itemRow(it) {
  const id = "c-" + it.id;
  const li = el("li", { className: "item" + (it.done ? " done" : "") });
  li.dataset.id = it.id;

  const cb = el("input", { type: "checkbox", className: "check", id, checked: it.done });
  cb.onchange = () => toggle(it, cb.checked);

  const label = el("label", { className: "item-label", htmlFor: id, textContent: it.name });
  if (it.priority !== "A") label.append(el("span", { className: "prio prio-" + it.priority, textContent: PRIO_LABEL[it.priority] }));
  if (it.is_custom) label.append(el("span", { className: "mine", textContent: "eigen" }));

  const price = el("input", {
    className: "price", type: "text", inputMode: "decimal", placeholder: "0,00",
    value: fmtInput(it.price), autocomplete: "off",
  });
  price.setAttribute("aria-label", "Bedrag voor " + it.name);
  price.addEventListener("input", () => setPrice(it, price.value));
  price.addEventListener("blur", () => { flushPrice(it); price.value = fmtInput(it.price); });
  price.addEventListener("keydown", (e) => { if (e.key === "Enter") price.blur(); });

  li.append(cb, label, el("span", { className: "price-wrap" }, price));

  if (it.is_custom) {
    const del = el("button", { className: "remove", type: "button", textContent: "×", title: "Verwijderen" });
    del.setAttribute("aria-label", "Verwijder " + it.name);
    del.onclick = () => removeItem(it);
    li.append(del);
  }
  return li;
}

function patchRows() {
  for (const li of document.querySelectorAll(".item")) {
    const it = items.find((x) => x.id === li.dataset.id);
    if (!it) continue;
    li.classList.toggle("done", it.done);
    $(".check", li).checked = it.done;
    const p = $(".price", li);
    if (p !== document.activeElement) p.value = fmtInput(it.price);
  }
}

function updateSummary() {
  const total = items.length;
  const done = items.filter((i) => i.done).length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  $("#percent").textContent = pct + "%";
  $("#stats").textContent = `${done} van ${total} afgevinkt`;
  $("#house-fill").style.transform = `scaleY(${total ? done / total : 0})`;
  $(".hero").classList.toggle("complete", total > 0 && done === total);

  let sum = 0, bought = 0;
  for (const i of items) {
    const v = i.price || 0;
    sum += v;
    if (i.done) bought += v;
  }
  $("#cost-total").textContent = fmtMoney(sum);
  $("#cost-done").textContent = fmtMoney(bought);
  $("#cost-open").textContent = fmtMoney(sum - bought);
}

/* ─── Acties op items ───────────────────────────────────────────────────── */
async function toggle(it, value) {
  it.done = value;
  render();
  try { await store.updateItem(it.id, { done: value }); }
  catch (e) { it.done = !value; render(); toast(errorText(e)); }
}

function setPrice(it, raw) {
  it.price = parsePrice(raw);
  updateSummary();
  clearTimeout(pendingPrice.get(it.id));
  pendingPrice.set(it.id, setTimeout(() => flushPrice(it), 700));
}

async function flushPrice(it) {
  if (!pendingPrice.has(it.id)) return;
  clearTimeout(pendingPrice.get(it.id));
  pendingPrice.delete(it.id);
  try { await store.updateItem(it.id, { price: it.price }); }
  catch (e) { toast(errorText(e)); }
}

async function removeItem(it) {
  if (!confirm(`“${it.name}” verwijderen?`)) return;
  const i = items.indexOf(it);
  items.splice(i, 1);
  render();
  try { await store.removeItem(it.id); }
  catch (e) { items.splice(i, 0, it); render(); toast(errorText(e)); }
}

async function resetAll() {
  if (!confirm("Alle vinkjes en bedragen wissen? Eigen items blijven staan." + (store.mode === "cloud" ? " Dit geldt voor iedereen die de app gebruikt." : ""))) return;
  const backup = items.map((i) => ({ ...i }));
  items.forEach((i) => { i.done = false; i.price = null; });
  render();
  try { await store.resetAll(); toast("Vinkjes en bedragen gewist"); }
  catch (e) { items = backup; render(); toast(errorText(e)); }
}

/* ─── Item toevoegen ────────────────────────────────────────────────────── */
function fillCategorySelect() {
  const sel = $("#add-category");
  sel.replaceChildren(...categories().map((c) => el("option", { value: c, textContent: c })));
}

async function submitAdd(e) {
  e.preventDefault();
  const name = $("#add-name").value.trim();
  if (!name) return;
  const category = $("#add-category").value;
  const priority = $("#form-add").prio.value;
  const row = {
    category, name, priority, done: false,
    price: parsePrice($("#add-price").value),
    is_custom: true,
    sort: items.reduce((m, i) => Math.max(m, i.sort), 0) + 1,
  };
  const btn = $("#add-submit");
  btn.disabled = true;
  try {
    const saved = await store.addItem(row);
    if (!items.some((i) => i.id === saved.id)) items.push(saved);
    expanded.add(category);
    remember.set("expanded", [...expanded]);
    remember.set("lastCategory", category);
    $("#sheet-add").close();
    $("#add-name").value = "";
    $("#add-price").value = "";
    if (filter === "done") setFilter("all");
    render();
    const li = document.querySelector(`.item[data-id="${CSS.escape(saved.id)}"]`);
    if (li) { li.scrollIntoView({ block: "center", behavior: "smooth" }); li.classList.add("flash"); }
    toast(`“${name}” toegevoegd`);
  } catch (err) {
    toast(errorText(err));
  } finally {
    btn.disabled = false;
  }
}

/* ─── Instellingen ──────────────────────────────────────────────────────── */
function openSettings() {
  const body = $("#settings-body");
  body.replaceChildren();
  const group = (title, ...kids) => el("div", { className: "set-group" }, title ? el("h3", { textContent: title }) : null, ...kids);
  const button = (text, onclick, cls = "btn") => { const b = el("button", { className: cls, type: "button", textContent: text }); b.onclick = onclick; return b; };
  const close = () => $("#sheet-settings").close();

  if (store.mode === "local") {
    body.append(group(null, el("p", { className: "notice", textContent:
      "Je werkt in lokale modus. Vul je Supabase-gegevens in js/config.js in om de lijst met anderen te delen." })));
  } else {
    body.append(group("Samen gebruiken",
      el("p", { className: "hint", textContent: "Iedereen met de link ziet en bewerkt dezelfde lijst." }),
      button("Deel de link", shareLink, "btn btn-primary"),
    ));
  }

  body.append(group("Lijst",
    el("div", { className: "row" },
      button("Alles openen", () => { expanded = new Set(categories()); remember.set("expanded", [...expanded]); render(); close(); }),
      button("Alles sluiten", () => { expanded.clear(); remember.set("expanded", []); render(); close(); }),
    ),
    button("Afdrukken of bewaren als pdf", () => { close(); setTimeout(() => window.print(), 250); }),
    button("Vinkjes en bedragen wissen", () => { close(); resetAll(); }, "btn btn-danger"),
  ));
  $("#sheet-settings").showModal();
}

async function shareLink() {
  const url = location.origin + location.pathname;
  const text = "Onze verhuischecklist in Nestklaar. Open de link en zet hem op je beginscherm:";
  if (navigator.share) { try { await navigator.share({ title: "Nestklaar", text, url }); } catch { /* geannuleerd */ } return; }
  try { await navigator.clipboard.writeText(url); toast("Link gekopieerd"); }
  catch { toast(url); }
}

/* ─── Filter ────────────────────────────────────────────────────────────── */
function setFilter(f) {
  filter = f;
  for (const b of document.querySelectorAll("#filter button")) b.setAttribute("aria-checked", String(b.dataset.filter === f));
}

/* ─── Vaste UI koppelen ─────────────────────────────────────────────────── */
function wireStaticUI() {
  // Zoeken en filteren
  let searchTimer;
  $("#search").addEventListener("input", (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { query = e.target.value.trim().toLowerCase(); render(); }, 120);
  });
  $("#filter").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    setFilter(b.dataset.filter);
    render();
  });

  // Sheets
  $("#btn-add").onclick = () => {
    const last = remember.get("lastCategory", null);
    if (last && categories().includes(last)) $("#add-category").value = last;
    $("#sheet-add").showModal();
    setTimeout(() => $("#add-name").focus(), 50);
  };
  $("#form-add").addEventListener("submit", submitAdd);
  $("#btn-settings").onclick = openSettings;
  for (const d of document.querySelectorAll("dialog.sheet")) {
    d.addEventListener("click", (e) => { if (e.target === d || e.target.closest("[data-close]")) d.close(); });
  }
}

boot();
