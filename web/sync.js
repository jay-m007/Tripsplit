// Keeps one trip's event log on this device and, when sync is set up, in Supabase (encrypted) with live updates.
import { foldEvents, makeEvent, validEvent, importKey, seal, open } from "./engine/index.js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

export const syncEnabled = () => !!(SUPABASE_URL && SUPABASE_ANON_KEY && globalThis.supabase?.createClient);

const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};
export { LS };

let client = null;
function sb() {
  if (!client) client = globalThis.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, storageKey: "ts.auth", autoRefreshToken: true } });
  return client;
}
async function signedIn() {
  const c = sb();
  const { data } = await c.auth.getSession();
  if (data.session) return data.session;
  const r = await c.auth.signInAnonymously();
  if (r.error) throw new Error(r.error.message.includes("disabled") ? "Anonymous sign-ins are turned off in this Supabase project." : r.error.message);
  return r.data.session;
}

/** Create the trip on the server (no-op without sync). */
export async function createRemoteTrip(tripId) {
  if (!syncEnabled()) return;
  await signedIn();
  const { error } = await sb().rpc("create_trip", { t: tripId });
  if (error) throw new Error(error.message);
}

export class TripSession {
  constructor(meta, { onChange, onStatus }) {
    this.meta = meta; this.onChange = onChange; this.onStatus = onStatus;
    this.events = LS.get("ts.ev." + meta.id, []).filter(validEvent);
    this.pending = LS.get("ts.pending." + meta.id, []).filter(validEvent);
    this.ids = new Set(this.events.map((e) => e.id));
    this.channel = null; this.key = null; this.stopped = false;
  }
  get remote() { return syncEnabled() && !this.meta.local; }
  get trip() { return foldEvents(this.events); }
  status(s, detail = "") { this.state = s; this.onStatus?.(s, detail); }
  saveLocal() { LS.set("ts.ev." + this.meta.id, this.events); LS.set("ts.pending." + this.meta.id, this.pending); }
  merge(list) {
    let changed = false;
    for (const e of list) if (validEvent(e) && !this.ids.has(e.id)) { this.ids.add(e.id); this.events.push(e); changed = true; }
    if (changed) { this.saveLocal(); this.onChange(this.trip); }
    return changed;
  }

  async start() {
    this.onChange(this.trip);
    if (!this.remote) { this.status("local"); return; }
    this.status("connecting");
    try {
      this.key = await importKey(this.meta.key);
      await signedIn();
      const { data: ok, error } = await sb().rpc("join_trip", { t: this.meta.id });
      if (error) throw new Error(error.message);
      if (!ok) { this.status("missing"); return; }
      await this.pull();
      this.subscribe();
      await this.flush();
    } catch (err) { this.status("offline", err.message || String(err)); this.retrySoon(); }
  }
  async pull() {
    let from = 0;
    for (;;) {
      const { data, error } = await sb().from("events").select("iv,ct").eq("trip_id", this.meta.id).order("id").range(from, from + 999);
      if (error) throw new Error(error.message);
      const opened = (await Promise.all(data.map((r) => open(this.key, this.meta.id, r)))).filter(Boolean);
      this.merge(opened);
      if (data.length < 1000) break;
      from += 1000;
    }
  }
  subscribe() {
    if (this.channel) sb().removeChannel(this.channel);
    this.channel = sb().channel("trip-" + this.meta.id)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "events", filter: `trip_id=eq.${this.meta.id}` }, async (p) => {
        const e = await open(this.key, this.meta.id, p.new); if (e) this.merge([e]);
      })
      .subscribe((s) => {
        if (this.stopped) return;
        if (s === "SUBSCRIBED") { this.status("live"); this.pull().catch(() => {}); this.flush(); }
        else if (s === "CHANNEL_ERROR" || s === "TIMED_OUT" || s === "CLOSED") { this.status("offline", "Lost the live connection."); this.retrySoon(); }
      });
  }
  retrySoon() {
    if (this.stopped || this.retryTimer) return;
    this.retryTimer = setTimeout(() => { this.retryTimer = null; if (!this.stopped) this.start(); }, 8000);
  }
  async flush() {
    if (!this.remote || !this.key || !this.pending.length) return;
    const batch = [...this.pending];
    try {
      const rows = await Promise.all(batch.map(async (e) => ({ trip_id: this.meta.id, ...(await seal(this.key, this.meta.id, e)) })));
      const { error } = await sb().from("events").insert(rows);
      if (error) throw new Error(error.message);
      const sent = new Set(batch.map((e) => e.id));
      this.pending = this.pending.filter((e) => !sent.has(e.id)); this.saveLocal();
      if (this.state !== "live") this.status("live");
    } catch (err) { this.status("offline", err.message); this.retrySoon(); }
  }
  /** Record a change: applied here at once, sent to everyone when possible. */
  add(type, data) {
    const e = makeEvent(type, data);
    this.ids.add(e.id); this.events.push(e);
    if (this.remote) this.pending.push(e);
    this.saveLocal(); this.onChange(this.trip);
    this.flush();
    return e;
  }
  stop() {
    this.stopped = true; clearTimeout(this.retryTimer);
    if (this.channel) { sb().removeChannel(this.channel); this.channel = null; }
  }
}

export function forgetTrip(id) { LS.del("ts.ev." + id); LS.del("ts.pending." + id); }
