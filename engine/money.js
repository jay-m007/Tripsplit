// Money is kept as whole paise (integers) so totals never drift by a fraction of a rupee.

export function toPaise(rupees) {
  const n = Number(rupees);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

/** Indian digit grouping: 1234567 -> 12,34,567 */
export function groupIndian(intString) {
  const s = String(intString);
  if (s.length <= 3) return s;
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  return rest + "," + last3;
}

/** formatINR(280050) -> "₹2,800.50"; whole rupees drop the ".00". */
export function formatINR(paise, { symbol = "₹" } = {}) {
  const neg = paise < 0;
  const abs = Math.abs(Math.round(paise));
  const rupees = Math.floor(abs / 100);
  const p = abs % 100;
  const body = groupIndian(String(rupees)) + (p ? "." + String(p).padStart(2, "0") : "");
  return (neg ? "-" : "") + symbol + body;
}

/** formatMoney(10499) -> "₹104.99", always with two decimals, for invoice columns that must line up. */
export function formatMoney(paise) {
  const neg = paise < 0;
  const abs = Math.abs(Math.round(paise));
  return (neg ? "-" : "") + "₹" + groupIndian(String(Math.floor(abs / 100))) + "." + String(abs % 100).padStart(2, "0");
}
