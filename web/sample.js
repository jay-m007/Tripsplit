// The example trip ("Try an example"). Made-up people; kept only on this phone.
import { makeEvent } from "./engine/index.js";

export function sampleEvents() {
  const t0 = Date.now() - 3 * 864e5;
  let n = 0;
  const at = () => new Date(t0 + n++ * 60000).toISOString();
  const d = (k) => { const x = new Date(t0 + k * 864e5); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`; };
  const all = ["ex-a", "ex-b", "ex-c", "ex-d"];
  const e = (type, data) => makeEvent(type, data, at());
  return [
    e("trip.name", { name: "Goa (example)" }),
    e("member.put", { id: "ex-a", name: "Asha", upi: "asha@okaxis" }),
    e("member.put", { id: "ex-b", name: "Bilal", upi: "bilal@ybl" }),
    e("member.put", { id: "ex-c", name: "Chitra", upi: "" }),
    e("member.put", { id: "ex-d", name: "Dev", upi: "dev@oksbi" }),
    e("expense.put", { id: "ex1", title: "Villa, 2 nights", amount: 1200000, paidBy: "ex-a", date: d(0), split: { mode: "equal", among: all } }),
    e("expense.put", { id: "ex2", title: "Cab from airport", amount: 180000, paidBy: "ex-b", date: d(0), split: { mode: "equal", among: all } }),
    e("expense.put", { id: "ex3", title: "Scooty rent", amount: 240000, paidBy: "ex-d", date: d(1), split: { mode: "shares", shares: { "ex-a": 1, "ex-b": 1, "ex-d": 2 } } }),
    e("expense.put", { id: "ex4", title: "Dinner at the shack", amount: 0, paidBy: "ex-c", date: d(1), split: { mode: "items", lines: [
      { name: "Fish thali", price: 45000, who: ["ex-a", "ex-c"] }, { name: "Prawn curry", price: 52000, who: ["ex-b", "ex-d"] }, { name: "Drinks", price: 80000, who: ["ex-b", "ex-c", "ex-d"] }, { name: "Water", price: 6000, who: all },
    ], taxPct: 5, servicePct: 10, tip: 10000 } }),
    e("expense.put", { id: "ex5", title: "Fort entry tickets", amount: 100000, paidBy: "ex-a", date: d(2), split: { mode: "exact", exact: { "ex-a": 25000, "ex-b": 25000, "ex-c": 25000, "ex-d": 25000 } } }),
    e("payment.put", { id: "exp1", from: "ex-c", to: "ex-a", amount: 100000, date: d(2) }),
  ];
}
