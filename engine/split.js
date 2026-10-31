// How one expense is shared. Money is whole paise; every split adds up to the exact total.

/** Split `total` paise in proportion to `weights` (array of numbers >= 0). Largest remainder; ties go to the earlier person. */
export function allocate(total, weights) {
  const n = weights.length;
  const out = new Array(n).fill(0);
  const sum = weights.reduce((a, b) => a + (b > 0 ? b : 0), 0);
  if (!n || sum <= 0 || total === 0) return out;
  const sign = total < 0 ? -1 : 1, abs = Math.abs(total);
  const rema = [];
  let given = 0;
  weights.forEach((w, i) => {
    const exact = (abs * (w > 0 ? w : 0)) / sum;
    out[i] = Math.floor(exact); given += out[i];
    rema.push({ i, r: exact - out[i] });
  });
  rema.sort((a, b) => b.r - a.r || a.i - b.i);
  for (let k = 0; k < abs - given; k++) out[rema[k % n].i] += 1;
  return out.map((v) => v * sign);
}

export const MODES = ["equal", "shares", "percent", "exact", "items"];

/**
 * Work out what each member owes for one expense.
 * Returns { ok, total, owed: {memberId: paise}, reason }.
 * For "items" the total comes from the bill; for the others it is expense.amount.
 */
export function computeSplit(expense, memberIds) {
  const s = expense.split || {};
  const known = new Set(memberIds);
  const fail = (reason) => ({ ok: false, total: 0, owed: {}, reason });
  const amount = expense.amount | 0;
  const result = (ids, parts, total) => { const owed = {}; ids.forEach((id, i) => { if (parts[i]) owed[id] = (owed[id] || 0) + parts[i]; }); return { ok: true, total, owed, reason: "" }; };

  switch (s.mode) {
    case "equal": {
      const ids = (s.among || []).filter((id) => known.has(id));
      if (!ids.length) return fail("Pick at least one person to split with.");
      if (amount <= 0) return fail("Enter an amount.");
      return result(ids, allocate(amount, ids.map(() => 1)), amount);
    }
    case "shares":
    case "percent": {
      const map = (s.mode === "shares" ? s.shares : s.percent) || {};
      const ids = Object.keys(map).filter((id) => known.has(id) && Number(map[id]) > 0);
      if (!ids.length) return fail(s.mode === "shares" ? "Give at least one person a share." : "Give at least one person a percentage.");
      if (amount <= 0) return fail("Enter an amount.");
      const w = ids.map((id) => Number(map[id]));
      if (s.mode === "percent") {
        const sum = w.reduce((a, b) => a + b, 0);
        if (Math.abs(sum - 100) > 0.01) return fail(`Percentages add up to ${+sum.toFixed(2)}%, not 100%.`);
      }
      return result(ids, allocate(amount, w), amount);
    }
    case "exact": {
      const map = s.exact || {};
      const ids = Object.keys(map).filter((id) => known.has(id) && (map[id] | 0) > 0);
      if (!ids.length) return fail("Enter what at least one person owes.");
      const sum = ids.reduce((a, id) => a + (map[id] | 0), 0);
      if (amount <= 0) return fail("Enter an amount.");
      if (sum !== amount) return fail(sum < amount ? `₹${((amount - sum) / 100).toFixed(2)} is not assigned to anyone yet.` : `That is ₹${((sum - amount) / 100).toFixed(2)} more than the bill.`);
      return result(ids, ids.map((id) => map[id] | 0), amount);
    }
    case "items": {
      const b = billTotals(s, memberIds);
      if (!b.ok) return fail(b.reason);
      return { ok: true, total: b.total, owed: b.owed, reason: "" };
    }
    default: return fail("Choose how to split.");
  }
}

/**
 * An itemised bill: lines [{name, price (paise, for the whole line), who: [ids]}], taxPct, servicePct, tip (paise).
 * Each line is split equally among its people. Tax, service charge and tip are shared in proportion to what each person ordered.
 */
export function billTotals(s, memberIds) {
  const known = new Set(memberIds);
  const lines = Array.isArray(s.lines) ? s.lines : [];
  if (!lines.length) return { ok: false, reason: "Add at least one item." };
  const sub = {};
  let subtotal = 0;
  for (const [i, l] of lines.entries()) {
    const price = l.price | 0, who = (l.who || []).filter((id) => known.has(id));
    if (price <= 0) return { ok: false, reason: `Item ${i + 1} needs a price.` };
    if (!who.length) return { ok: false, reason: `Pick who had ${l.name ? `"${l.name}"` : `item ${i + 1}`}.` };
    allocate(price, who.map(() => 1)).forEach((p, k) => (sub[who[k]] = (sub[who[k]] || 0) + p));
    subtotal += price;
  }
  const pct = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.min(Number(v), 100) : 0);
  const tax = Math.round((subtotal * pct(s.taxPct)) / 100);
  const service = Math.round((subtotal * pct(s.servicePct)) / 100);
  const tip = Math.max(0, s.tip | 0);
  const ids = Object.keys(sub);
  const extras = allocate(tax + service + tip, ids.map((id) => sub[id]));
  const owed = {};
  ids.forEach((id, i) => (owed[id] = sub[id] + extras[i]));
  return { ok: true, subtotal, tax, service, tip, total: subtotal + tax + service + tip, owed, sub };
}
