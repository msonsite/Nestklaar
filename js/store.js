import { SECTIONS } from "./data.js";

const uuid = () =>
  (crypto.randomUUID ? crypto.randomUUID()
    : "id-" + Date.now().toString(36) + Math.random().toString(36).slice(2));

/** Standaardlijst omzetten naar rijen. */
export function seedRows() {
  const rows = [];
  let sort = 0;
  for (const section of SECTIONS) {
    for (const [name, priority] of section.items) {
      rows.push({ category: section.title, name, priority, done: false, price: null, is_custom: false, sort: sort++ });
    }
  }
  return rows;
}

const norm = (r) => ({
  id: r.id,
  category: r.category,
  name: r.name,
  priority: r.priority,
  done: !!r.done,
  price: r.price === null || r.price === undefined || r.price === "" ? null : Number(r.price),
  is_custom: !!r.is_custom,
  sort: Number(r.sort) || 0,
});

/* ─── Lokale modus: alles in localStorage op dit toestel ─────────────────── */
export class LocalStore {
  mode = "local";
  key = "nestklaar.local.v1";
  items = [];

  async loadItems() {
    let data = null;
    try { data = JSON.parse(localStorage.getItem(this.key)); } catch { /* leeg */ }
    if (!Array.isArray(data) || !data.length) {
      data = seedRows().map((r) => ({ ...r, id: uuid() }));
    }
    this.items = data.map(norm);
    this.#save();
    return this.items;
  }
  #save() {
    // na de huidige wijziging in de app wegschrijven
    clearTimeout(this.t);
    this.t = setTimeout(() => {
      try { localStorage.setItem(this.key, JSON.stringify(this.items)); } catch { /* vol of geblokkeerd */ }
    }, 0);
  }
  async updateItem() { this.#save(); }
  async addItem(row) { this.#save(); return { ...row, id: uuid() }; }
  async removeItem() { this.#save(); }
  async resetAll() { this.#save(); }
  subscribe() {}
  unsubscribe() {}
}

/* ─── Gedeelde modus: één lijst in Supabase, zonder aanmelden ────────────── */
const ALL = "00000000-0000-0000-0000-000000000000"; // filter dat op elke rij past

export class CloudStore {
  mode = "cloud";
  channel = null;

  constructor(sb) { this.sb = sb; }

  #check({ data, error }) { if (error) throw error; return data; }

  async loadItems() {
    const data = this.#check(await this.sb.from("items").select("*").order("sort").range(0, 4999));
    return data.map(norm);
  }
  async updateItem(id, patch) {
    this.#check(await this.sb.from("items").update(patch).eq("id", id));
  }
  async addItem(row) {
    return norm(this.#check(await this.sb.from("items").insert(row).select().single()));
  }
  async removeItem(id) {
    this.#check(await this.sb.from("items").delete().eq("id", id));
  }
  async resetAll() {
    this.#check(await this.sb.from("items").update({ done: false, price: null }).neq("id", ALL));
  }

  // Live updates van andere toestellen
  subscribe(handler) {
    this.unsubscribe();
    const base = { schema: "public", table: "items" };
    this.channel = this.sb.channel("items")
      .on("postgres_changes", { ...base, event: "INSERT" }, (p) => handler("upsert", norm(p.new)))
      .on("postgres_changes", { ...base, event: "UPDATE" }, (p) => handler("upsert", norm(p.new)))
      .on("postgres_changes", { ...base, event: "DELETE" }, (p) => handler("delete", p.old))
      .subscribe();
  }
  unsubscribe() {
    if (this.channel) { this.sb.removeChannel(this.channel); this.channel = null; }
  }
}
