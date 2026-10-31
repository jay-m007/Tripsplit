// End-to-end encryption for events: AES-GCM with a random 256-bit key per trip (Web Crypto, built into browsers and Node).
const b64u = {
  enc: (bytes) => { let s = ""; for (const b of bytes) s += String.fromCharCode(b); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); },
  dec: (str) => { const s = atob(str.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((str.length + 3) % 4)); return Uint8Array.from(s, (c) => c.charCodeAt(0)); },
};
export { b64u };

export async function newKey() {
  const k = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
  return b64u.enc(new Uint8Array(await crypto.subtle.exportKey("raw", k)));
}
export async function importKey(b64) {
  const raw = b64u.dec(b64);
  if (raw.length !== 32) throw new Error("Bad key");
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

/** Encrypt an event. The trip id is bound in as extra data, so a sealed event cannot be moved to another trip. */
export async function seal(key, tripId, event) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: new TextEncoder().encode(tripId) }, key, new TextEncoder().encode(JSON.stringify(event)));
  return { iv: b64u.enc(iv), ct: b64u.enc(new Uint8Array(ct)) };
}

/** Decrypt one row. Returns the event, or null if it was tampered with, is for another trip, or is not JSON. */
export async function open(key, tripId, row) {
  try {
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64u.dec(row.iv), additionalData: new TextEncoder().encode(tripId) }, key, b64u.dec(row.ct));
    return JSON.parse(new TextDecoder().decode(pt));
  } catch { return null; }
}
