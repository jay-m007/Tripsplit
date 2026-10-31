// Who is up and who is down across a whole trip, and the fewest payments to settle it.
import { computeSplit } from "./split.js";

/** net[id] > 0 means the group owes them; < 0 means they owe. Also returns spent (what each person consumed) and paid. */
export function balances(trip) {
  const ids = trip.members.map((m) => m.id);
  const net = {}, paid = {}, share = {};
  ids.forEach((id) => { net[id] = 0; paid[id] = 0; share[id] = 0; });
  let total = 0;
  const problems = [];
  for (const e of trip.expenses) {
    const r = computeSplit(e, ids);
    if (!r.ok || !(e.paidBy in net)) { problems.push({ id: e.id, title: e.title, reason: r.ok ? "The person who paid was removed." : r.reason }); continue; }
    net[e.paidBy] += r.total; paid[e.paidBy] += r.total; total += r.total;
    for (const [id, v] of Object.entries(r.owed)) { net[id] -= v; share[id] += v; }
  }
  for (const p of trip.payments) {
    if (!(p.from in net) || !(p.to in net) || p.from === p.to) continue;
    net[p.from] += p.amount; net[p.to] -= p.amount;
  }
  return { net, paid, share, total, problems };
}

/** Fewest-ish transfers: repeatedly match the biggest debtor with the biggest creditor. Order of members breaks ties. */
export function settleUp(net, order = Object.keys(net)) {
  const rank = new Map(order.map((id, i) => [id, i]));
  const debt = [], cred = [];
  for (const id of order) { const v = net[id] | 0; if (v < 0) debt.push({ id, v: -v }); else if (v > 0) cred.push({ id, v }); }
  const by = (a, b) => b.v - a.v || rank.get(a.id) - rank.get(b.id);
  const out = [];
  while (debt.length && cred.length) {
    debt.sort(by); cred.sort(by);
    const d = debt[0], c = cred[0], amt = Math.min(d.v, c.v);
    out.push({ from: d.id, to: c.id, amount: amt });
    d.v -= amt; c.v -= amt;
    if (!d.v) debt.shift();
    if (!c.v) cred.shift();
  }
  return out;
}
