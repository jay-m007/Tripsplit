// Plain-text summary to paste into the group chat.
import { formatINR } from "./money.js";
import { balances, settleUp } from "./balance.js";

export function summaryText(trip) {
  const name = (id) => trip.members.find((m) => m.id === id)?.name || "Someone";
  const b = balances(trip);
  const lines = [`${trip.name || "Our trip"}: ${formatINR(b.total)} spent`];
  for (const m of trip.members) lines.push(`${m.name} paid ${formatINR(b.paid[m.id])}, share ${formatINR(b.share[m.id])}`);
  const t = settleUp(b.net, trip.members.map((m) => m.id));
  lines.push("", t.length ? "To settle up:" : "Everyone is settled up.");
  for (const x of t) lines.push(`${name(x.from)} pays ${name(x.to)} ${formatINR(x.amount)}`);
  return lines.join("\n");
}
