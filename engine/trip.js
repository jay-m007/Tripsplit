// A trip is rebuilt from a log of small events (add a person, save an expense, record a payment).
// Every phone keeps the same log, so everyone ends up with the same trip, in any order the events arrive.
import { MODES } from "./split.js";
import { isUpiId } from "./upi.js";

export const LIMITS = { name: 60, person: 40, members: 30, title: 60, note: 200, lines: 40, amount: 100_00_00_000 /* ₹1 crore in paise */ };
const ID = /^[\w-]{1,40}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const txt = (v, n) => String(typeof v === "string" ? v : "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
const money = (v) => { const n = Number(v); return Number.isInteger(n) && n >= 0 && n <= LIMITS.amount ? n : null; };
const num = (v, max) => { const n = Number(v); return Number.isFinite(n) && n >= 0 && n <= max ? Math.round(n * 100) / 100 : null; };

export function newId() {
  const b = new Uint8Array(9); crypto.getRandomValues(b);
  return Date.now().toString(36) + Array.from(b, (x) => (x % 36).toString(36)).join("");
}

export function emptyTrip() { return { name: "", members: [], expenses: [], payments: [] }; }

export function cleanMember(d) {
  if (!d || !ID.test(d.id)) return null;
  const name = txt(d.name, LIMITS.person); if (!name) return null;
  const upi = txt(d.upi, 80);
  return { id: d.id, name, upi: isUpiId(upi) ? upi : "" };
}

function cleanMap(m, f) {
  const out = {};
  if (m && typeof m === "object") for (const [k, v] of Object.entries(m)) { if (!ID.test(k)) continue; const x = f(v); if (x !== null && x > 0) out[k] = x; }
  return out;
}
const ids = (a) => (Array.isArray(a) ? [...new Set(a.filter((x) => typeof x === "string" && ID.test(x)))].slice(0, LIMITS.members) : []);

export function cleanSplit(s) {
  const mode = s && MODES.includes(s.mode) ? s.mode : null;
  if (!mode) return null;
  if (mode === "equal") return { mode, among: ids(s.among) };
  if (mode === "shares") return { mode, shares: cleanMap(s.shares, (v) => num(v, 1000)) };
  if (mode === "percent") return { mode, percent: cleanMap(s.percent, (v) => num(v, 100)) };
  if (mode === "exact") return { mode, exact: cleanMap(s.exact, money) };
  const lines = (Array.isArray(s.lines) ? s.lines : []).slice(0, LIMITS.lines).map((l) => ({ name: txt(l?.name, 40), price: money(l?.price) ?? 0, who: ids(l?.who) }));
  return { mode, lines, taxPct: num(s.taxPct, 100) ?? 0, servicePct: num(s.servicePct, 100) ?? 0, tip: money(s.tip) ?? 0 };
}

export function cleanExpense(d) {
  if (!d || !ID.test(d.id) || !ID.test(d.paidBy || "")) return null;
  const split = cleanSplit(d.split); if (!split) return null;
  const amount = money(d.amount); if (amount === null) return null;
  return { id: d.id, title: txt(d.title, LIMITS.title) || "Expense", amount, paidBy: d.paidBy, date: DATE.test(d.date) ? d.date : "", note: txt(d.note, LIMITS.note), split };
}

export function cleanPayment(d) {
  if (!d || !ID.test(d.id) || !ID.test(d.from || "") || !ID.test(d.to || "") || d.from === d.to) return null;
  const amount = money(d.amount); if (!amount) return null;
  return { id: d.id, from: d.from, to: d.to, amount, date: DATE.test(d.date) ? d.date : "" };
}

export const TYPES = ["trip.name", "member.put", "member.remove", "expense.put", "expense.remove", "payment.put", "payment.remove"];

/** A new event, ready to store and send. */
export function makeEvent(type, data, at = new Date().toISOString()) {
  return { id: newId(), at, type, data };
}

/** Is this something we can safely apply? (Events can come from other phones, so trust nothing.) */
export function validEvent(e) {
  return !!e && typeof e === "object" && typeof e.id === "string" && ID.test(e.id) && typeof e.at === "string" && e.at.length <= 40 && !Number.isNaN(Date.parse(e.at)) && TYPES.includes(e.type) && e.data && typeof e.data === "object";
}

/** Order that every phone agrees on: time, then id. */
export const eventOrder = (a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Rebuild the trip from its events. Later edits win. Invalid events are skipped. */
export function foldEvents(events) {
  const t = { name: "", members: new Map(), expenses: new Map(), payments: new Map() };
  const seen = new Set();
  const list = events.filter((e) => validEvent(e) && !seen.has(e.id) && seen.add(e.id)).sort(eventOrder);
  for (const e of list) {
    const d = e.data;
    switch (e.type) {
      case "trip.name": { const n = txt(d.name, LIMITS.name); if (n) t.name = n; break; }
      case "member.put": { const m = cleanMember(d); if (m && (t.members.has(m.id) || t.members.size < LIMITS.members)) t.members.set(m.id, m); break; }
      case "member.remove": {
        if (typeof d.id !== "string") break;
        const used = [...t.expenses.values()].some((x) => x.paidBy === d.id || involves(x, d.id)) || [...t.payments.values()].some((p) => p.from === d.id || p.to === d.id);
        if (!used) t.members.delete(d.id);
        break;
      }
      case "expense.put": { const x = cleanExpense(d); if (x) t.expenses.set(x.id, x); break; }
      case "expense.remove": t.expenses.delete(d.id); break;
      case "payment.put": { const p = cleanPayment(d); if (p) t.payments.set(p.id, p); break; }
      case "payment.remove": t.payments.delete(d.id); break;
    }
  }
  const byDate = (a, b) => (b.date || "").localeCompare(a.date || "");
  return { name: t.name, members: [...t.members.values()], expenses: [...t.expenses.values()].sort(byDate), payments: [...t.payments.values()].sort(byDate) };
}

/** Does this expense put anything on this person? */
export function involves(x, id) {
  const s = x.split;
  if (s.mode === "equal") return s.among.includes(id);
  if (s.mode === "items") return s.lines.some((l) => l.who.includes(id));
  const m = s.mode === "shares" ? s.shares : s.mode === "percent" ? s.percent : s.exact;
  return id in m;
}
