// A UPI payment link (the text inside a payment QR code).
const VPA = /^[A-Za-z0-9._-]{2,64}@[A-Za-z][A-Za-z0-9]{1,30}$/;

export const isUpiId = (s) => VPA.test(String(s || "").trim());

/** upiLink({ id, name, amountPaise, note }) -> "upi://pay?pa=...", or "" when the UPI ID is not valid. */
export function upiLink({ id, name, amountPaise, note }) {
  const pa = String(id || "").trim();
  if (!isUpiId(pa)) return "";
  const q = [["pa", pa]];
  if (name) q.push(["pn", String(name).trim().slice(0, 40)]);
  if (amountPaise > 0) q.push(["am", (amountPaise / 100).toFixed(2)]);
  q.push(["cu", "INR"]);
  if (note) q.push(["tn", String(note).trim().slice(0, 40)]);
  // "@" stays as it is: payment apps expect pa=name@bank
  return "upi://pay?" + q.map(([k, v]) => `${k}=${encodeURIComponent(v).replace(/%40/g, "@")}`).join("&");
}
