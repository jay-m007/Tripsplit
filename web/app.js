import { foldEvents, formatINR, computeSplit, billTotals, balances, settleUp, involves, newId, newKey, makeInvite, parseInvite, summaryText, upiLink, isUpiId, qrMatrix, qrPath, MODES, LIMITS } from "./engine/index.js";
import { TripSession, createRemoteTrip, syncEnabled, forgetTrip, LS } from "./sync.js";
import { sampleEvents } from "./sample.js";

const $ = (id) => document.getElementById(id);

/** Build elements without innerHTML. */
function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "text") el.textContent = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "value") el.value = v;
    else if (k === "checked") el.checked = true;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
  return el;
}
let toastTimer;
function toast(msg) { const t = $("toast"); t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 3600); }
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

/** "1,234.50" or "₹ 99" -> paise, or null. */
function parseRupees(t) {
  const s = String(t ?? "").replace(/[₹,\s]/g, "");
  if (!/^\d{1,9}(\.\d{0,2})?$/.test(s)) return null;
  const [r, p = ""] = s.split(".");
  return Number(r) * 100 + Number((p + "00").slice(0, 2));
}
const rupeesText = (paise) => (paise ? (paise % 100 ? (paise / 100).toFixed(2) : String(paise / 100)) : "");

/* ---------- saved trips on this phone ---------- */
const metas = () => LS.get("ts.trips", []).filter((m) => m && m.id && m.key);
function saveMeta(meta) { const list = metas().filter((m) => m.id !== meta.id); list.unshift(meta); LS.set("ts.trips", list.slice(0, 50)); }
function removeMeta(id) { LS.set("ts.trips", metas().filter((m) => m.id !== id)); }

let session = null, trip = null, meta = null;
const memberName = (id) => trip?.members.find((m) => m.id === id)?.name || "Someone";

/* ---------- colour mode ---------- */
const MODES_UI = ["auto", "light", "dark"], MODE_ICON = { auto: "Auto", light: "☀ Light", dark: "☾ Dark" };
function mode() { try { const m = localStorage.getItem("ts.mode"); return MODES_UI.includes(m) ? m : "auto"; } catch { return "auto"; } }
function applyMode(m) {
  if (m === "auto") document.documentElement.removeAttribute("data-theme"); else document.documentElement.setAttribute("data-theme", m);
  $("modeBtn").textContent = MODE_ICON[m]; $("modeBtn").setAttribute("aria-label", `Colour mode: ${m}. Press to change.`);
}
$("modeBtn").addEventListener("click", () => {
  const next = MODES_UI[(MODES_UI.indexOf(mode()) + 1) % 3];
  try { next === "auto" ? localStorage.removeItem("ts.mode") : localStorage.setItem("ts.mode", next); } catch {}
  applyMode(next); toast(next === "auto" ? "Colour mode follows your device." : `Colour mode: ${next}.`);
});
applyMode(mode());

/* ---------- home ---------- */
function showHome() {
  session?.stop(); session = null; trip = null; meta = null;
  $("trip").hidden = true; $("home").hidden = false; $("back").hidden = true; $("sync").hidden = true; $("fab").hidden = true;
  $("title").textContent = "Trip Split"; document.title = "Trip Split";
  $("localNote").hidden = syncEnabled(); $("joinBox").hidden = !syncEnabled();
  const list = metas();
  $("tripList").replaceChildren(...list.map((m) => {
    const cached = LS.get("ts.ev." + m.id, []);
    let total = 0, mine = null, people = 0;
    try { const t = foldEvents(cached); const b = balances(t); total = b.total; people = t.members.length; if (m.me && m.me in b.net) mine = b.net[m.me]; } catch {}
    return h("button", { class: "ticket", onclick: () => openTrip(m) },
      h("span", { class: "tname", text: m.name || "Trip" }),
      h("span", { class: "tmeta", text: `${people} ${people === 1 ? "person" : "people"} · ${formatINR(total)} spent${m.local ? " · on this phone" : ""}` }),
      h("span", { class: "tright" }, h("span", { class: "muted small", text: mine === null ? "Total" : mine >= 0 ? "You get" : "You owe" }), h("b", { class: mine === null ? "" : mine >= 0 ? "pos" : "neg", text: formatINR(Math.abs(mine ?? total)) })));
  }));
}

$("newTrip").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = $("nt-name").value.trim(), me = $("nt-me").value.trim(), upi = $("nt-upi").value.trim(), msg = $("nt-msg");
  if (!name) { msg.textContent = "Give the trip a name."; msg.className = "fb bad"; $("nt-name").focus(); return; }
  if (!me) { msg.textContent = "Add your name."; msg.className = "fb bad"; $("nt-me").focus(); return; }
  if (upi && !isUpiId(upi)) { msg.textContent = "That UPI ID does not look right (name@bank)."; msg.className = "fb bad"; $("nt-upi").focus(); return; }
  msg.textContent = syncEnabled() ? "Creating…" : ""; msg.className = "fb";
  const id = crypto.randomUUID(), key = await newKey(), meId = newId();
  try { await createRemoteTrip(id); } catch (err) { msg.textContent = "Could not create the trip online: " + err.message; msg.className = "fb bad"; return; }
  const m = { id, key, name, me: meId, opened: Date.now() };
  saveMeta(m);
  await openTrip(m, (s) => { s.add("trip.name", { name }); s.add("member.put", { id: meId, name: me, upi }); });
  $("newTrip").reset(); msg.textContent = "";
  selectTab("ppl"); toast("Trip started. Invite your friends with the link.");
});

$("example").addEventListener("click", async () => {
  const id = crypto.randomUUID(), key = await newKey();
  const m = { id, key, name: "Goa (example)", me: "ex-a", opened: Date.now(), local: true };
  LS.set("ts.ev." + id, sampleEvents());
  saveMeta(m); await openTrip(m);
  toast("An example trip, kept only on this phone. Change anything.");
});

async function joinFromText(text, quiet) {
  const inv = parseInvite(text);
  if (!inv) { if (!quiet) { $("joinMsg").textContent = "That is not a Trip Split invite link."; $("joinMsg").className = "fb bad"; } return; }
  const known = metas().find((m) => m.id === inv.tripId);
  const m = known || { id: inv.tripId, key: inv.key, name: "", me: "", opened: Date.now() };
  saveMeta(m); $("joinLink").value = ""; $("joinMsg").textContent = "";
  await openTrip(m);
}
$("joinGo").addEventListener("click", () => joinFromText($("joinLink").value));
$("joinLink").addEventListener("keydown", (e) => { if (e.key === "Enter") joinFromText($("joinLink").value); });

/* ---------- one trip ---------- */
async function openTrip(m, afterStart) {
  session?.stop();
  meta = m; trip = null;
  $("home").hidden = true; $("trip").hidden = false; $("back").hidden = false; $("fab").hidden = false; $("missing").hidden = true;
  if (history.state?.trip !== m.id) history.pushState({ trip: m.id }, "", location.pathname + location.search);
  selectTab("exp");
  session = new TripSession(m, { onChange: (t) => { trip = t; render(); }, onStatus: showStatus });
  await session.start();
  afterStart?.(session);
  m.opened = Date.now(); saveMeta({ ...m, name: trip?.name || m.name });
}
function showStatus(s, detail) {
  const p = $("sync"); p.hidden = false;
  const map = { local: ["On this phone", ""], connecting: ["Connecting…", ""], live: ["Live", "live"], offline: ["Offline", "off"], missing: ["Not found", "off"] };
  const [txt, cls] = map[s] || [s, ""];
  p.textContent = txt; p.className = "pill " + cls; p.title = detail || (s === "offline" ? "Changes are saved here and sent when you are back online." : "");
  $("missing").hidden = s !== "missing";
}
$("back").addEventListener("click", () => history.back());
window.addEventListener("popstate", () => { if (!history.state?.trip) showHome(); });

function selectTab(name) {
  for (const t of ["exp", "bal", "ppl"]) { $("tab-" + t).setAttribute("aria-selected", String(t === name)); $("p-" + t).hidden = t !== name; }
  $("fab").hidden = name !== "exp" || !trip;
}
for (const t of ["exp", "bal", "ppl"]) $("tab-" + t).addEventListener("click", () => selectTab(t));

function render() {
  if (!trip || !meta) return;
  $("title").textContent = trip.name || meta.name || "Trip"; document.title = (trip.name || "Trip") + " · Trip Split";
  if (trip.name && trip.name !== meta.name) { meta.name = trip.name; saveMeta(meta); }
  const b = balances(trip);
  $("tTotal").textContent = formatINR(b.total);
  const me = meta.me && trip.members.some((m) => m.id === meta.me) ? meta.me : "";
  if (me) { const v = b.net[me]; $("tMineLabel").textContent = v >= 0 ? "You get back" : "You owe"; $("tMine").textContent = formatINR(Math.abs(v)); $("tMine").className = v > 0 ? "pos" : v < 0 ? "neg" : ""; }
  else { $("tMineLabel").textContent = "People"; $("tMine").textContent = String(trip.members.length); $("tMine").className = ""; }
  renderWho(me); renderExpenses(b, me); renderBalances(b, me); renderPeople(b);
  $("fab").hidden = $("p-exp").hidden || !trip.members.length;
}

function renderWho(me) {
  const show = !me && trip.members.length > 0;
  $("whoami").hidden = !show;
  if (!show) return;
  $("whoList").replaceChildren(...trip.members.map((m) => h("button", { class: "chip", type: "button", text: m.name, onclick: () => { meta.me = m.id; saveMeta(meta); render(); toast(`Hi ${m.name}.`); } })));
}
$("whoNew").addEventListener("submit", (e) => {
  e.preventDefault(); const name = $("whoName").value.trim(); if (!name || !session) return;
  if (trip.members.length >= LIMITS.members) { toast("This trip already has the most people it can hold."); return; }
  const id = newId(); session.add("member.put", { id, name, upi: "" }); meta.me = id; saveMeta(meta); $("whoName").value = ""; toast(`Added you, ${name}.`);
});

const ICONS = [[/(dinner|lunch|breakfast|food|meal|restaurant|cafe|shack|thali|pizza|biryani)/i, "🍽"], [/(cab|taxi|uber|ola|auto|bus|train|flight|metro|ferry)/i, "🚕"], [/(hotel|stay|room|hostel|airbnb|villa)/i, "🏨"], [/(petrol|diesel|fuel|toll)/i, "⛽"], [/(ticket|entry|show|museum|park)/i, "🎟"], [/(drink|beer|bar|pub|wine)/i, "🍻"], [/(grocer|shop|market|store)/i, "🛒"], [/(scooty|bike|rent)/i, "🛵"]];
const iconFor = (t) => (ICONS.find(([r]) => r.test(t)) || [, "🧾"])[1];
const niceDate = (d) => { if (!d) return "No date"; const [y, m, dd] = d.split("-").map(Number); return new Date(y, m - 1, dd).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" }); };

function renderExpenses(b, me) {
  const ids = trip.members.map((m) => m.id);
  $("problems").replaceChildren(...b.problems.map((p) => h("div", { class: "note bad", text: `"${p.title}" is not counted: ${p.reason}` })));
  if (!trip.expenses.length) {
    $("expList").replaceChildren(h("div", { class: "empty" }, h("p", { text: trip.members.length ? "No expenses yet. Tap + Expense to add the first one." : "Add people first, then expenses." })));
    return;
  }
  const out = []; let day = null;
  for (const x of trip.expenses) {
    if (x.date !== day) { day = x.date; out.push(h("div", { class: "day", text: niceDate(day) })); }
    const r = computeSplit(x, ids);
    const mine = me && r.ok ? (x.paidBy === me ? r.total : 0) - (r.owed[me] || 0) : null;
    out.push(h("button", { class: "exp", onclick: () => openEditor(x) },
      h("span", { class: "ico", "aria-hidden": "true", text: iconFor(x.title) }),
      h("span", { class: "et", text: x.title }),
      h("span", { class: "em", text: `${memberName(x.paidBy)} paid · ${modeLabel(x.split.mode)}` }),
      h("span", { class: "ea", text: formatINR(r.ok ? r.total : x.amount) }),
      h("span", { class: "ey " + (mine > 0 ? "pos" : mine < 0 ? "neg" : "muted"), text: mine === null ? "" : mine > 0 ? `you lent ${formatINR(mine)}` : mine < 0 ? `you owe ${formatINR(-mine)}` : "not involved" })));
  }
  $("expList").replaceChildren(...out);
}
const modeLabel = (m) => ({ equal: "split equally", shares: "by shares", percent: "by percent", exact: "exact amounts", items: "itemised bill" })[m];

function renderBalances(b, me) {
  const max = Math.max(1, ...Object.values(b.net).map(Math.abs));
  $("netList").replaceChildren(...trip.members.map((m) => {
    const v = b.net[m.id] || 0;
    const bar = h("i", { class: v >= 0 ? "pos" : "neg" }); bar.style.width = (Math.abs(v) / max) * 50 + "%";
    return h("div", { class: "net" }, h("span", {}, h("b", { text: m.name + (m.id === me ? " (you)" : "") }), h("span", { class: "muted small", text: ` paid ${formatINR(b.paid[m.id])}` })),
      h("b", { class: v > 0 ? "pos" : v < 0 ? "neg" : "muted", text: v > 0 ? `gets ${formatINR(v)}` : v < 0 ? `owes ${formatINR(-v)}` : "settled" }), h("div", { class: "bar2" }, bar));
  }));
  const plan = settleUp(b.net, trip.members.map((m) => m.id));
  $("settleList").replaceChildren(...(plan.length ? plan.map((p) => {
    const to = trip.members.find((m) => m.id === p.to);
    return h("div", { class: "settle" }, h("span", { class: "who" }, h("b", { text: memberName(p.from) }), " pays ", h("b", { text: memberName(p.to) })), h("b", { text: formatINR(p.amount) }),
      to?.upi ? h("button", { class: "btn small primary", type: "button", text: "Pay with UPI", onclick: () => openPay(p) }) : null,
      h("button", { class: "btn small", type: "button", text: "Mark paid", onclick: () => recordPayment(p) }));
  }) : [h("div", { class: "empty", text: trip.expenses.length ? "Everyone is settled up. 🎉" : "Nothing to settle yet." })]));
  $("payList").replaceChildren(...(trip.payments.length ? trip.payments.map((p) => h("div", { class: "pay" }, h("span", { text: `${memberName(p.from)} paid ${memberName(p.to)} ${formatINR(p.amount)}${p.date ? " · " + niceDate(p.date) : ""}` }),
    armButton("Undo", "Sure?", () => { session.add("payment.remove", { id: p.id }); toast("Payment removed."); }, "btn small"))) : [h("p", { class: "muted small", text: "None yet." })]));
  const text = summaryText(trip);
  $("waSummary").href = "https://wa.me/?text=" + encodeURIComponent(text);
}
$("copySummary").addEventListener("click", async () => { try { await navigator.clipboard.writeText(summaryText(trip)); toast("Summary copied."); } catch { toast("Could not copy. Use the WhatsApp button instead."); } });
function recordPayment(p) { session.add("payment.put", { id: newId(), from: p.from, to: p.to, amount: p.amount, date: today() }); toast(`Recorded: ${memberName(p.from)} paid ${memberName(p.to)} ${formatINR(p.amount)}.`); }

function armButton(label, armed, run, cls = "btn small danger") {
  let on = false, t;
  const b = h("button", { class: cls, type: "button", text: label, onclick: () => {
    if (!on) { on = true; b.textContent = armed; b.classList.add("armed"); t = setTimeout(() => { on = false; b.textContent = label; b.classList.remove("armed"); }, 3200); return; }
    clearTimeout(t); run();
  } });
  return b;
}

function hue(s) { let x = 0; for (const c of s) x = (x * 31 + c.charCodeAt(0)) % 360; return x; }
function renderPeople(b) {
  const remote = syncEnabled() && !meta.local;
  $("inviteBox").hidden = !remote;
  if (remote) {
    const link = makeInvite(location.origin + location.pathname, meta.id, meta.key);
    drawQr($("inviteQr"), link);
    $("waInvite").href = "https://wa.me/?text=" + encodeURIComponent(`Join "${trip.name || "our trip"}" on Trip Split to add expenses: ${link}`);
    $("copyInvite").onclick = async () => { try { await navigator.clipboard.writeText(link); toast("Invite link copied."); } catch { toast("Could not copy. Use the WhatsApp button instead."); } };
  }
  $("tripName").value = trip.name || "";
  $("peopleList").replaceChildren(...trip.members.map((m) => {
    const used = trip.expenses.some((x) => x.paidBy === m.id || involves(x, m.id)) || trip.payments.some((p) => p.from === m.id || p.to === m.id);
    const av = h("span", { class: "avatar", "aria-hidden": "true", text: m.name.slice(0, 1).toUpperCase() }); av.style.background = `hsl(${hue(m.name)} 55% 42%)`;
    const upiIn = h("input", { value: m.upi, placeholder: "UPI ID", "aria-label": `UPI ID for ${m.name}`, spellcheck: "false", autocomplete: "off" });
    const save = h("button", { class: "btn small", type: "button", text: "Save", onclick: () => {
      const v = upiIn.value.trim(); if (v && !isUpiId(v)) { toast("That UPI ID does not look right (name@bank)."); return; }
      session.add("member.put", { id: m.id, name: m.name, upi: v }); toast("Saved.");
    } });
    return h("div", { class: "person" }, av, h("div", { class: "pinfo" }, h("b", { text: m.name + (m.id === meta.me ? " (you)" : "") }), h("small", { text: m.upi || "No UPI ID" })),
      h("div", { class: "row grow" }, upiIn, save),
      m.id === meta.me ? null : h("button", { class: "btn small", type: "button", text: "This is me", onclick: () => { meta.me = m.id; saveMeta(meta); render(); } }),
      used ? null : armButton("Remove", "Sure?", () => { session.add("member.remove", { id: m.id }); toast(`${m.name} removed.`); }));
  }));
}
$("addPerson").addEventListener("submit", (e) => {
  e.preventDefault();
  const name = $("ap-name").value.trim(), upi = $("ap-upi").value.trim(), msg = $("ap-msg");
  if (!name) { msg.textContent = "Add a name."; msg.className = "fb bad"; return; }
  if (upi && !isUpiId(upi)) { msg.textContent = "That UPI ID does not look right (name@bank)."; msg.className = "fb bad"; return; }
  if (trip.members.some((m) => m.name.toLowerCase() === name.toLowerCase())) { msg.textContent = `${name} is already on the trip.`; msg.className = "fb bad"; return; }
  if (trip.members.length >= LIMITS.members) { msg.textContent = "That is the most people a trip can hold."; msg.className = "fb bad"; return; }
  session.add("member.put", { id: newId(), name, upi }); $("addPerson").reset(); msg.textContent = ""; toast(`${name} added.`);
});
$("renameTrip").addEventListener("click", () => { const n = $("tripName").value.trim(); if (!n) return; session.add("trip.name", { name: n }); toast("Renamed."); });
$("backup").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify({ app: "tripsplit", trip, events: session.events }, null, 1)], { type: "application/json" });
  const a = h("a", { href: URL.createObjectURL(blob), download: (trip.name || "trip").replace(/[^\w-]+/g, "-") + ".json" }); document.body.append(a); a.click(); a.remove();
});
(() => { let on = false, t; $("forget").addEventListener("click", (e) => {
  const b = e.currentTarget;
  if (!on) { on = true; b.textContent = "Tap again to remove"; b.classList.add("armed"); t = setTimeout(() => { on = false; b.textContent = "Remove from this phone"; b.classList.remove("armed"); }, 3500); return; }
  clearTimeout(t); on = false; b.textContent = "Remove from this phone"; b.classList.remove("armed");
  const id = meta.id; removeMeta(id); forgetTrip(id); history.back(); toast(syncEnabled() ? "Removed from this phone. Others still have it." : "Trip removed.");
}); })();

function drawQr(svg, text) {
  const m = qrMatrix(text); svg.replaceChildren(); if (!m) return;
  const { d, size } = qrPath(m, 3);
  svg.setAttribute("viewBox", `0 0 ${size} ${size}`);
  const ns = "http://www.w3.org/2000/svg", p = document.createElementNS(ns, "path"); p.setAttribute("d", d); svg.append(p);
}

/* ---------- pay ---------- */
let payPlan = null;
function openPay(p) {
  const to = trip.members.find((m) => m.id === p.to); if (!to?.upi) return;
  payPlan = p;
  const link = upiLink({ id: to.upi, name: to.name, amountPaise: p.amount, note: (trip.name || "Trip").slice(0, 30) });
  $("pay-h").textContent = `Pay ${to.name}`;
  $("payText").textContent = `${memberName(p.from)} pays ${to.name} ${formatINR(p.amount)} (${to.upi})`;
  drawQr($("payQr"), link); $("payOpen").href = link;
  $("pay").showModal();
}
$("payClose").addEventListener("click", () => $("pay").close());
$("payDone").addEventListener("click", () => { if (payPlan) recordPayment(payPlan); $("pay").close(); });

/* ---------- expense editor ---------- */
let draft = null;
function openEditor(x) {
  if (!trip.members.length) { selectTab("ppl"); toast("Add people first."); return; }
  const ids = trip.members.map((m) => m.id);
  const me = trip.members.some((m) => m.id === meta.me) ? meta.me : ids[0];
  const s = x?.split || { mode: "equal", among: ids };
  draft = {
    id: x?.id || null, title: x?.title || "", amountText: x && s.mode !== "items" ? rupeesText(x.amount) : "", paidBy: x?.paidBy || me, date: x?.date || today(), mode: s.mode,
    among: new Set(s.mode === "equal" ? s.among : ids),
    shares: Object.fromEntries(ids.map((id) => [id, s.mode === "shares" ? String(s.shares[id] ?? "") : "1"])),
    percent: Object.fromEntries(ids.map((id) => [id, s.mode === "percent" ? String(s.percent[id] ?? "") : ""])),
    exact: Object.fromEntries(ids.map((id) => [id, s.mode === "exact" ? rupeesText(s.exact[id] || 0) : ""])),
    lines: s.mode === "items" ? s.lines.map((l) => ({ name: l.name, priceText: rupeesText(l.price), who: new Set(l.who) })) : [{ name: "", priceText: "", who: new Set(ids) }],
    taxPct: s.mode === "items" ? String(s.taxPct || "") : "", servicePct: s.mode === "items" ? String(s.servicePct || "") : "", tipText: s.mode === "items" ? rupeesText(s.tip) : "",
  };
  $("exp-h").textContent = x ? "Edit expense" : "New expense";
  $("e-title").value = draft.title; $("e-amount").value = draft.amountText; $("e-date").value = draft.date;
  $("e-paid").replaceChildren(...trip.members.map((m) => h("option", { value: m.id, text: m.name })));
  $("e-paid").value = draft.paidBy;
  $("e-del").hidden = !x;
  if (x) { const del = armButton("Delete", "Tap again to delete", () => { session.add("expense.remove", { id: x.id }); $("exp").close(); toast("Expense deleted."); }, "btn danger"); del.id = "e-del"; $("e-del").replaceWith(del); }
  renderModes(); renderPanel(); preview();
  $("exp").showModal();
  if (!x) $("e-title").focus();
}
$("fab").addEventListener("click", () => openEditor(null));
$("e-title").addEventListener("input", (e) => { draft.title = e.target.value; });
$("e-amount").addEventListener("input", (e) => { draft.amountText = e.target.value; preview(); });
$("e-paid").addEventListener("change", (e) => { draft.paidBy = e.target.value; });
$("e-date").addEventListener("change", (e) => { draft.date = e.target.value; });

function renderModes() {
  const labels = { equal: "Equally", shares: "Shares", percent: "Percent", exact: "Exact", items: "Itemised bill" };
  $("e-modes").replaceChildren(...MODES.map((m) => h("button", { type: "button", role: "radio", "aria-checked": String(draft.mode === m), text: labels[m], onclick: () => { draft.mode = m; renderModes(); renderPanel(); preview(); } })));
  $("e-amountBox").hidden = draft.mode === "items";
}
function memberRows(kind, input) {
  return trip.members.map((m) => {
    const id = `e-${kind}-${m.id}`;
    return h("div", { class: "mrow" }, h("span", { class: "avatar small-av", "aria-hidden": "true", text: m.name[0].toUpperCase() }), h("label", { for: id, text: m.name }), input(m, id));
  });
}
function renderPanel() {
  const p = $("e-panel"), ids = trip.members.map((m) => m.id);
  if (draft.mode === "equal") {
    p.replaceChildren(h("div", { class: "row" }, h("button", { class: "btn small", type: "button", text: "Everyone", onclick: () => { draft.among = new Set(ids); renderPanel(); preview(); } }), h("button", { class: "btn small", type: "button", text: "No one", onclick: () => { draft.among = new Set(); renderPanel(); preview(); } })),
      ...memberRows("eq", (m, id) => h("input", { type: "checkbox", id, checked: draft.among.has(m.id), onchange: (e) => { e.target.checked ? draft.among.add(m.id) : draft.among.delete(m.id); preview(); } })));
  } else if (draft.mode === "shares" || draft.mode === "percent") {
    const map = draft[draft.mode];
    p.replaceChildren(h("p", { class: "muted small", text: draft.mode === "shares" ? "Someone who had twice as much gets 2. Leave empty or 0 to leave a person out." : "Must add up to 100%." }),
      ...memberRows(draft.mode, (m, id) => h("input", { id, inputmode: "decimal", value: map[m.id], placeholder: "0", oninput: (e) => { map[m.id] = e.target.value; preview(); } })));
  } else if (draft.mode === "exact") {
    p.replaceChildren(h("p", { class: "muted small", text: "Type what each person owes, in rupees." }),
      ...memberRows("ex", (m, id) => h("input", { id, inputmode: "decimal", value: draft.exact[m.id], placeholder: "0", oninput: (e) => { draft.exact[m.id] = e.target.value; preview(); } })));
  } else {
    const lines = draft.lines.map((l, i) => h("div", { class: "line" },
      h("div", { class: "row" }, h("input", { class: "lname", value: l.name, placeholder: `Item ${i + 1}`, "aria-label": `Item ${i + 1} name`, maxlength: "40", oninput: (e) => { l.name = e.target.value; } }),
        h("input", { class: "lprice", value: l.priceText, inputmode: "decimal", placeholder: "₹", "aria-label": `Item ${i + 1} price`, oninput: (e) => { l.priceText = e.target.value; preview(); } }),
        draft.lines.length > 1 ? h("button", { class: "icon-btn", type: "button", "aria-label": `Remove item ${i + 1}`, text: "×", onclick: () => { draft.lines.splice(i, 1); renderPanel(); preview(); } }) : null),
      h("div", { class: "chips", role: "group", "aria-label": `Who had item ${i + 1}` }, ...trip.members.map((m) => h("button", { class: "chip", type: "button", "aria-pressed": String(l.who.has(m.id)), text: m.name, onclick: (e) => { l.who.has(m.id) ? l.who.delete(m.id) : l.who.add(m.id); e.currentTarget.setAttribute("aria-pressed", String(l.who.has(m.id))); preview(); } })))));
    const num = (label, key, ph) => h("div", { class: "field" }, h("label", { for: "e-" + key, text: label }), h("input", { id: "e-" + key, inputmode: "decimal", value: draft[key], placeholder: ph, oninput: (e) => { draft[key] = e.target.value; preview(); } }));
    p.replaceChildren(...lines,
      h("button", { class: "btn small", type: "button", text: "+ Add item", disabled: draft.lines.length >= LIMITS.lines, onclick: () => { draft.lines.push({ name: "", priceText: "", who: new Set(trip.members.map((m) => m.id)) }); renderPanel(); preview(); } }),
      h("div", { class: "grid2 mt" }, num("GST / tax %", "taxPct", "5"), num("Service charge %", "servicePct", "0")), num("Tip (₹)", "tipText", "0"));
  }
}
function draftExpense() {
  const ids = trip.members.map((m) => m.id);
  const pct = (v) => (v === "" ? 0 : Number(v));
  let split;
  if (draft.mode === "equal") split = { mode: "equal", among: ids.filter((id) => draft.among.has(id)) };
  else if (draft.mode === "shares" || draft.mode === "percent") split = { mode: draft.mode, [draft.mode]: Object.fromEntries(ids.map((id) => [id, pct(draft[draft.mode][id])]).filter(([, v]) => Number.isFinite(v) && v > 0)) };
  else if (draft.mode === "exact") split = { mode: "exact", exact: Object.fromEntries(ids.map((id) => [id, parseRupees(draft.exact[id]) || 0]).filter(([, v]) => v > 0)) };
  else split = { mode: "items", lines: draft.lines.map((l) => ({ name: l.name.trim(), price: parseRupees(l.priceText) || 0, who: ids.filter((id) => l.who.has(id)) })), taxPct: pct(draft.taxPct) || 0, servicePct: pct(draft.servicePct) || 0, tip: parseRupees(draft.tipText) || 0 };
  let amount = parseRupees(draft.amountText) || 0;
  if (draft.mode === "items") { const b = billTotals(split, ids); amount = b.ok ? b.total : 0; }
  return { id: draft.id || newId(), title: draft.title.trim() || "Expense", amount, paidBy: draft.paidBy, date: draft.date || today(), note: "", split };
}
function preview() {
  const x = draftExpense(), ids = trip.members.map((m) => m.id);
  const amountBad = draft.mode !== "items" && draft.amountText && parseRupees(draft.amountText) === null;
  const r = amountBad ? { ok: false, reason: "Type the amount as a number, like 1250 or 1250.50." } : computeSplit(x, ids);
  $("e-msg").textContent = r.ok ? "" : r.reason;
  $("e-save").disabled = !r.ok;
  const box = $("e-owed");
  if (!r.ok) { box.replaceChildren(); return; }
  const rows = trip.members.filter((m) => r.owed[m.id]).map((m) => h("div", {}, h("span", { text: m.name }), h("b", { text: formatINR(r.owed[m.id]) })));
  const extra = [];
  if (draft.mode === "items") { const b = billTotals(x.split, ids); extra.push(h("div", { class: "muted" }, h("span", { text: "Items" }), h("span", { text: formatINR(b.subtotal) }))); if (b.tax) extra.push(h("div", { class: "muted" }, h("span", { text: "Tax" }), h("span", { text: formatINR(b.tax) }))); if (b.service) extra.push(h("div", { class: "muted" }, h("span", { text: "Service charge" }), h("span", { text: formatINR(b.service) }))); if (b.tip) extra.push(h("div", { class: "muted" }, h("span", { text: "Tip" }), h("span", { text: formatINR(b.tip) }))); }
  box.replaceChildren(...rows, ...extra, h("div", { class: "tot" }, h("span", { text: "Total" }), h("span", { text: formatINR(r.total) })));
}
$("e-save").addEventListener("click", () => {
  const x = draftExpense(), r = computeSplit(x, trip.members.map((m) => m.id));
  if (!r.ok) return;
  session.add("expense.put", x); $("exp").close(); toast(draft.id ? "Expense updated." : `Added ${formatINR(r.total)} for ${x.title}.`);
});

/* ---------- start ---------- */
showHome();
if (location.hash.includes("t=")) {
  const text = location.hash;
  history.replaceState(null, "", location.pathname + location.search); // keep the key out of the address bar
  if (syncEnabled()) joinFromText(text, true); else toast("Live sync is not set up on this copy, so invite links cannot be opened.");
}
