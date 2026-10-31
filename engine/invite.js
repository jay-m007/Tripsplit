// The invite link carries the trip id and its secret key after "#", so the key never reaches any server.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const KEY = /^[A-Za-z0-9_-]{43}$/;

export function makeInvite(base, tripId, keyB64) {
  return `${base.replace(/#.*$/, "")}#t=${tripId}.${keyB64}`;
}

/** Accepts a full link, or just the part after "#". Returns {tripId, key} or null. */
export function parseInvite(text) {
  const s = String(text || "").trim();
  const m = /(?:^|[#&])t=([0-9a-f-]{36})\.([A-Za-z0-9_-]{43})(?:$|&|\s)/.exec(s.includes("#") ? s.slice(s.indexOf("#")) : s);
  if (!m || !UUID.test(m[1]) || !KEY.test(m[2])) return null;
  return { tripId: m[1], key: m[2] };
}
