import { test } from "node:test";
import assert from "node:assert/strict";
import { allocate, computeSplit, billTotals, balances, settleUp, foldEvents, makeEvent, validEvent, cleanExpense, involves, emptyTrip,
  makeInvite, parseInvite, newKey, importKey, seal, open, summaryText, upiLink, formatINR, qrMatrix, LIMITS } from "../engine/index.js";

const M = ["a", "b", "c"];
const sumOf = (o) => Object.values(o).reduce((x, y) => x + y, 0);
const trip = (expenses, payments = []) => ({ name: "Goa", members: [{ id: "a", name: "Asha" }, { id: "b", name: "Bilal" }, { id: "c", name: "Chitra" }], expenses, payments });
const ex = (id, amount, paidBy, split) => ({ id, title: id, amount, paidBy, date: "2026-10-30", split });

test("allocate always adds up and gives leftovers to the earliest", () => {
  assert.deepEqual(allocate(100, [1, 1, 1]), [34, 33, 33]);
  assert.deepEqual(allocate(1000, [2, 1, 1]), [500, 250, 250]);
  assert.deepEqual(allocate(0, [1, 1]), [0, 0]);
  assert.deepEqual(allocate(5, [0, 0]), [0, 0]);
  assert.deepEqual(allocate(-100, [1, 1, 1]), [-34, -33, -33]);
  for (let t = 1; t < 400; t += 37) for (const w of [[1, 2, 3], [0.5, 0.25, 0.25], [7, 0, 3, 1]]) assert.equal(allocate(t, w).reduce((a, b) => a + b), t);
});

test("equal split", () => {
  const r = computeSplit(ex("x", 1000, "a", { mode: "equal", among: ["a", "b", "c"] }), M);
  assert.ok(r.ok); assert.deepEqual(r.owed, { a: 334, b: 333, c: 333 });
  assert.ok(!computeSplit(ex("x", 1000, "a", { mode: "equal", among: [] }), M).ok);
  assert.ok(!computeSplit(ex("x", 0, "a", { mode: "equal", among: ["a"] }), M).ok);
  assert.deepEqual(computeSplit(ex("x", 900, "a", { mode: "equal", among: ["a", "zz"] }), M).owed, { a: 900 }, "unknown people are ignored");
});

test("shares and percent", () => {
  assert.deepEqual(computeSplit(ex("x", 1200, "a", { mode: "shares", shares: { a: 2, b: 1 } }), M).owed, { a: 800, b: 400 });
  assert.deepEqual(computeSplit(ex("x", 1000, "a", { mode: "percent", percent: { a: 50, b: 30, c: 20 } }), M).owed, { a: 500, b: 300, c: 200 });
  const bad = computeSplit(ex("x", 1000, "a", { mode: "percent", percent: { a: 50, b: 30 } }), M);
  assert.ok(!bad.ok); assert.match(bad.reason, /80%/);
  assert.equal(sumOf(computeSplit(ex("x", 1001, "a", { mode: "percent", percent: { a: 33.33, b: 33.33, c: 33.34 } }), M).owed), 1001);
});

test("exact amounts must match the bill", () => {
  assert.deepEqual(computeSplit(ex("x", 1000, "a", { mode: "exact", exact: { a: 600, b: 400 } }), M).owed, { a: 600, b: 400 });
  assert.match(computeSplit(ex("x", 1000, "a", { mode: "exact", exact: { a: 600 } }), M).reason, /₹4\.00 is not assigned/);
  assert.match(computeSplit(ex("x", 1000, "a", { mode: "exact", exact: { a: 600, b: 500 } }), M).reason, /₹1\.00 more/);
});

test("itemised bill shares tax, service and tip by what each person ordered", () => {
  const s = { mode: "items", lines: [{ name: "Thali", price: 30000, who: ["a"] }, { name: "Pizza", price: 60000, who: ["b", "c"] }, { name: "Water", price: 3000, who: ["a", "b", "c"] }], taxPct: 5, servicePct: 10, tip: 2000 };
  const b = billTotals(s, M);
  assert.equal(b.subtotal, 93000); assert.equal(b.tax, 4650); assert.equal(b.service, 9300); assert.equal(b.total, 93000 + 4650 + 9300 + 2000);
  assert.equal(sumOf(b.owed), b.total);
  assert.deepEqual(b.sub, { a: 31000, b: 31000, c: 31000 });
  const r = computeSplit(ex("x", 0, "a", s), M); assert.ok(r.ok); assert.equal(r.total, b.total);
  assert.match(computeSplit(ex("x", 0, "a", { mode: "items", lines: [{ name: "Tea", price: 2000, who: [] }] }), M).reason, /Pick who had "Tea"/);
  assert.match(computeSplit(ex("x", 0, "a", { mode: "items", lines: [] }), M).reason, /at least one item/);
});

test("balances and settle-up", () => {
  const t = trip([ex("hotel", 9000, "a", { mode: "equal", among: M }), ex("cab", 3000, "b", { mode: "equal", among: M })]);
  const b = balances(t);
  assert.deepEqual(b.net, { a: 5000, b: -1000, c: -4000 }); assert.equal(b.total, 12000); assert.equal(sumOf(b.net), 0);
  assert.deepEqual(settleUp(b.net, M), [{ from: "c", to: "a", amount: 4000 }, { from: "b", to: "a", amount: 1000 }]);
  const after = balances({ ...t, payments: [{ id: "p", from: "c", to: "a", amount: 4000 }, { id: "q", from: "b", to: "a", amount: 1000 }] });
  assert.deepEqual(after.net, { a: 0, b: 0, c: 0 }); assert.deepEqual(settleUp(after.net, M), []);
});

test("settle-up never needs more than n-1 payments and always balances", () => {
  for (let seed = 1; seed < 60; seed++) {
    let x = seed; const rnd = () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648);
    const ids = ["a", "b", "c", "d", "e", "f"].slice(0, 2 + (seed % 5));
    const vals = ids.map(() => Math.round((rnd() - 0.5) * 100000)); vals[vals.length - 1] -= vals.reduce((a, b) => a + b);
    const net = Object.fromEntries(ids.map((id, i) => [id, vals[i]]));
    const t = settleUp(net, ids);
    assert.ok(t.length <= ids.length - 1);
    const left = { ...net }; for (const p of t) { left[p.from] += p.amount; left[p.to] -= p.amount; assert.ok(p.amount > 0); }
    assert.ok(Object.values(left).every((v) => v === 0));
  }
});

test("an expense whose split is broken is reported, not counted", () => {
  const b = balances(trip([ex("bad", 1000, "a", { mode: "percent", percent: { a: 10 } }), ex("gone", 500, "zz", { mode: "equal", among: M })]));
  assert.equal(b.total, 0); assert.equal(b.problems.length, 2);
});

test("events rebuild the same trip in any arrival order", () => {
  const ev = [
    makeEvent("trip.name", { name: "Goa 2026" }, "2026-10-30T10:00:00.000Z"),
    makeEvent("member.put", { id: "a", name: "Asha", upi: "asha@okaxis" }, "2026-10-30T10:00:01.000Z"),
    makeEvent("member.put", { id: "b", name: "Bilal" }, "2026-10-30T10:00:02.000Z"),
    makeEvent("expense.put", ex("e1", 5000, "a", { mode: "equal", among: ["a", "b"] }), "2026-10-30T10:01:00.000Z"),
    makeEvent("expense.put", ex("e1", 6000, "a", { mode: "equal", among: ["a", "b"] }), "2026-10-30T10:02:00.000Z"),
    makeEvent("expense.put", ex("e2", 100, "b", { mode: "equal", among: ["a"] }), "2026-10-30T10:03:00.000Z"),
    makeEvent("expense.remove", { id: "e2" }, "2026-10-30T10:04:00.000Z"),
  ];
  const t1 = foldEvents(ev), t2 = foldEvents([...ev].reverse()), t3 = foldEvents([...ev, ...ev]);
  assert.deepEqual(t1, t2); assert.deepEqual(t1, t3);
  assert.equal(t1.name, "Goa 2026"); assert.equal(t1.members[0].upi, "asha@okaxis"); assert.equal(t1.expenses.length, 1); assert.equal(t1.expenses[0].amount, 6000);
});

test("a person who is in an expense cannot be removed", () => {
  const ev = [makeEvent("member.put", { id: "a", name: "A" }, "2026-01-01T00:00:00Z"), makeEvent("member.put", { id: "b", name: "B" }, "2026-01-01T00:00:01Z"),
    makeEvent("expense.put", ex("e", 100, "a", { mode: "equal", among: ["a", "b"] }), "2026-01-01T00:00:02Z"),
    makeEvent("member.remove", { id: "b" }, "2026-01-01T00:00:03Z"), makeEvent("member.put", { id: "c", name: "C" }, "2026-01-01T00:00:04Z"), makeEvent("member.remove", { id: "c" }, "2026-01-01T00:00:05Z")];
  assert.deepEqual(foldEvents(ev).members.map((m) => m.id), ["a", "b"]);
});

test("hostile or broken events are ignored", () => {
  const good = makeEvent("member.put", { id: "a", name: "A" }, "2026-01-01T00:00:00Z");
  const junk = [null, 5, {}, { ...good, id: "../x" }, { ...good, type: "drop.table" }, { ...good, at: "yesterday" }, { ...good, id: "zz", data: null },
    makeEvent("member.put", { id: "b", name: "" }, "2026-01-01T00:00:01Z"), makeEvent("expense.put", { id: "e", amount: -5, paidBy: "a", split: { mode: "equal", among: ["a"] } }, "2026-01-01T00:00:02Z"),
    makeEvent("expense.put", { id: "e2", amount: 1.5, paidBy: "a", split: { mode: "equal", among: ["a"] } }, "2026-01-01T00:00:03Z"),
    makeEvent("payment.put", { id: "p", from: "a", to: "a", amount: 100 }, "2026-01-01T00:00:04Z")];
  const t = foldEvents([good, ...junk]);
  assert.deepEqual(t.members.map((m) => m.id), ["a"]); assert.equal(t.expenses.length, 0); assert.equal(t.payments.length, 0);
  assert.ok(!validEvent(junk[3]) && !validEvent(junk[5]));
  assert.equal(foldEvents([makeEvent("member.put", { id: "x", name: "X", upi: "javascript:alert(1)" })]).members[0].upi, "");
});

test("limits: too many members and huge amounts are refused", () => {
  const ev = Array.from({ length: LIMITS.members + 5 }, (_, i) => makeEvent("member.put", { id: "m" + i, name: "M" + i }, new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString()));
  assert.equal(foldEvents(ev).members.length, LIMITS.members);
  assert.equal(cleanExpense({ id: "e", amount: LIMITS.amount + 1, paidBy: "a", split: { mode: "equal", among: ["a"] } }), null);
});

test("involves", () => {
  assert.ok(involves(cleanExpense(ex("e", 100, "a", { mode: "items", lines: [{ name: "x", price: 100, who: ["c"] }] })), "c"));
  assert.ok(!involves(cleanExpense(ex("e", 100, "a", { mode: "shares", shares: { a: 1 } })), "b"));
});

test("invite links carry id and key after #, and reject junk", async () => {
  const key = await newKey(), id = "3f2b8c1e-9d4a-4b7c-8e2f-1a2b3c4d5e6f";
  const link = makeInvite("https://jay-m007.github.io/Tripsplit/?x=1#old", id, key);
  assert.ok(link.startsWith("https://jay-m007.github.io/Tripsplit/?x=1#t="));
  assert.deepEqual(parseInvite(link), { tripId: id, key });
  assert.deepEqual(parseInvite("  " + link + "  "), { tripId: id, key });
  assert.equal(parseInvite("https://x.com/#t=nope"), null); assert.equal(parseInvite(""), null);
  assert.equal(parseInvite(link.slice(0, -1)), null, "truncated key");
  assert.ok(qrMatrix(link), "an invite link fits in a QR code");
});

test("sealed events open only with the right key and the right trip", async () => {
  const k1 = await importKey(await newKey()), k2 = await importKey(await newKey());
  const e = makeEvent("trip.name", { name: "Manali" });
  const row = await seal(k1, "trip-1", e);
  assert.ok(!row.ct.includes("Manali"));
  assert.deepEqual(await open(k1, "trip-1", row), e);
  assert.equal(await open(k2, "trip-1", row), null, "wrong key");
  assert.equal(await open(k1, "trip-2", row), null, "moved to another trip");
  const flipped = { ...row, ct: (row.ct[0] === "A" ? "B" : "A") + row.ct.slice(1) };
  assert.equal(await open(k1, "trip-1", flipped), null, "tampered");
  await assert.rejects(importKey("short"));
});

test("summary text for the group chat", () => {
  const s = summaryText(trip([ex("hotel", 900000, "a", { mode: "equal", among: M })]));
  assert.match(s, /Goa: ₹9,000 spent/); assert.match(s, /Bilal pays Asha ₹3,000/); assert.match(s, /Chitra pays Asha ₹3,000/);
  assert.match(summaryText(emptyTrip()), /Everyone is settled up/);
});

test("UPI link for a settle-up", () => {
  assert.equal(upiLink({ id: "asha@okaxis", name: "Asha", amountPaise: 400000, note: "Goa trip" }), "upi://pay?pa=asha@okaxis&pn=Asha&am=4000.00&cu=INR&tn=Goa%20trip");
  assert.equal(formatINR(1234567), "₹12,345.67");
});
