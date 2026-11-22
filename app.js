// รายรับรายจ่ายครอบครัว — บันทึกในเครื่องก่อนเสมอ แล้วซิงก์กับ Cloudflare Worker ของครอบครัว
// ใช้ได้แม้ไม่มีเน็ต รายการที่ยังส่งไม่ได้จะส่งเองเมื่อกลับมาออนไลน์

const $ = (id) => document.getElementById(id);
const KEY = { tx: "money.tx", pending: "money.pending", cfg: "money.cfg", pull: "money.lastPull", cats: "money.cats" };
const DEFAULT_CATS = {
  expense: ["อาหาร", "เดินทาง", "บ้าน/ค่าเช่า", "น้ำ-ไฟ-เน็ต", "ของใช้", "ลูก/การศึกษา", "สุขภาพ", "ผ่อน/หนี้", "ช้อปปิ้ง", "อื่น ๆ"],
  income: ["เงินเดือน", "ค่าล่วงเวลา", "ขายของ", "โบนัส", "ดอกเบี้ย/ปันผล", "อื่น ๆ"],
};
const SYNC_EVERY = 60_000;

// ---------------------------------------------------------------- เก็บข้อมูลในเครื่อง

function read(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    return v ?? fallback;
  } catch { return fallback; }
}

function write(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { toast("พื้นที่ในเครื่องเต็ม บันทึกไม่ได้"); }
}

const txs = new Map(read(KEY.tx, []).map((t) => [t.id, t]));
const pending = new Set(read(KEY.pending, []));
let cfg = read(KEY.cfg, { url: "", pass: "", member: "" });
let customCats = read(KEY.cats, { expense: [], income: [] });

function persist() {
  write(KEY.tx, [...txs.values()]);
  write(KEY.pending, [...pending]);
}

// ---------------------------------------------------------------- ตัวช่วย

const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => ymd(new Date());
const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`);
const money = new Intl.NumberFormat("th-TH", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const baht = (satang) => money.format(satang / 100);

/** "1,234.5" → 123450 (สตางค์) หรือ null ถ้าไม่ถูกต้อง */
export function parseAmount(text) {
  const v = String(text).replace(/[,\s฿]/g, "");
  if (!/^\d+(\.\d{0,2})?$/.test(v)) return null;
  const n = Math.round(parseFloat(v) * 100);
  return n > 0 && n <= 1e13 ? n : null;
}

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const c of children) if (c != null) node.append(c);
  return node;
}

let toastTimer = 0;
function toast(text) {
  const t = $("toast");
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
}

// ---------------------------------------------------------------- หน้าจอ

let month = today().slice(0, 7);
let view = "list";
let catType = "expense";

function monthItems() {
  return [...txs.values()].filter((t) => !t.deleted && t.date.startsWith(month));
}

function render() {
  const [y, m] = month.split("-").map(Number);
  $("month-label").textContent = new Intl.DateTimeFormat("th-TH", { month: "long", year: "numeric" }).format(new Date(y, m - 1, 1));
  const items = monthItems();
  const sum = (type) => items.filter((t) => t.type === type).reduce((s, t) => s + t.amount, 0);
  const inc = sum("income"), exp = sum("expense");
  $("sum-income").textContent = baht(inc);
  $("sum-expense").textContent = baht(exp);
  $("sum-balance").textContent = baht(inc - exp);
  $("sum-balance").parentElement.classList.toggle("neg", inc - exp < 0);
  $("view-list").hidden = view !== "list";
  $("view-cats").hidden = view !== "cats";
  if (view === "list") renderList(items);
  else renderCats(items);
}

function renderList(items) {
  const byDay = new Map();
  items.sort((a, b) => b.date.localeCompare(a.date) || b.created_at - a.created_at)
    .forEach((t) => { if (!byDay.has(t.date)) byDay.set(t.date, []); byDay.get(t.date).push(t); });
  $("empty").hidden = items.length > 0;
  const dayFmt = new Intl.DateTimeFormat("th-TH", { weekday: "short", day: "numeric", month: "short" });
  $("tx-list").replaceChildren(...[...byDay].map(([date, list]) => {
    const [y, m, d] = date.split("-").map(Number);
    const net = list.reduce((s, t) => s + (t.type === "income" ? t.amount : -t.amount), 0);
    return el("section", { class: "day" },
      el("div", { class: "day-head" },
        el("span", { text: date === today() ? "วันนี้" : dayFmt.format(new Date(y, m - 1, d)) }),
        el("span", { class: net < 0 ? "neg" : "pos", text: `${net < 0 ? "−" : "+"}${baht(Math.abs(net))}` })),
      ...list.map((t) => el("button", { class: `tx ${t.type}`, type: "button", onclick: () => openTx(t) },
        el("span", { class: "dot", "aria-hidden": "true" }),
        el("span", { class: "tx-main" },
          el("b", { text: t.category }),
          el("small", { text: [t.note, t.member].filter(Boolean).join(" · ") || " " })),
        el("span", { class: "tx-amt", text: `${t.type === "income" ? "+" : "−"}${baht(t.amount)}` }),
        cfg.url && pending.has(t.id) ? el("span", { class: "wait", title: "รอส่ง", text: "•" }) : null)));
  }));
}

function renderCats(items) {
  const group = (key, list) => {
    const m = new Map();
    list.forEach((t) => m.set(t[key] || "ไม่ระบุ", (m.get(t[key] || "ไม่ระบุ") || 0) + t.amount));
    return [...m].sort((a, b) => b[1] - a[1]);
  };
  const ofType = items.filter((t) => t.type === catType);
  const total = ofType.reduce((s, t) => s + t.amount, 0) || 1;
  const bars = (rows) => rows.map(([name, amt]) => el("li", { class: `bar ${catType}` },
    el("div", { class: "bar-head" }, el("span", { text: name }), el("b", { text: baht(amt) })),
    el("div", { class: "bar-track" }, fill(Math.max(2, (amt / total) * 100))),
    el("small", { text: `${Math.round((amt / total) * 100)}%` })));
  const fill = (pct) => {
    const node = el("div", { class: "bar-fill" });
    node.style.width = `${pct}%`; // ตั้งผ่าน CSSOM เพราะ CSP ไม่อนุญาต style แบบ inline
    return node;
  };
  const cats = group("category", ofType);
  $("cat-list").replaceChildren(...(cats.length ? bars(cats) : [el("li", { class: "empty", text: "ยังไม่มีรายการ" })]));
  $("member-list").replaceChildren(...bars(group("member", ofType)));
}

// ---------------------------------------------------------------- เพิ่ม / แก้รายการ

let editing = null;
let formType = "expense";
let formCat = "";

function catsFor(type) {
  const used = [...txs.values()].filter((t) => t.type === type && !t.deleted).map((t) => t.category);
  return [...new Set([...DEFAULT_CATS[type], ...(customCats[type] || []), ...used])];
}

function setFormType(type) {
  formType = type;
  $("type-expense").classList.toggle("active", type === "expense");
  $("type-income").classList.toggle("active", type === "income");
  $("tx-form").dataset.type = type;
  if (!catsFor(type).includes(formCat)) formCat = "";
  renderChips();
}

function renderChips() {
  const chips = catsFor(formType).map((c) => el("button", {
    class: `chip${c === formCat ? " active" : ""}`, type: "button", text: c,
    onclick: () => { formCat = c; $("f-cat-new").hidden = true; $("f-cat-new").value = ""; renderChips(); },
  }));
  chips.push(el("button", {
    class: `chip add${$("f-cat-new").hidden ? "" : " active"}`, type: "button", text: "+ หมวดใหม่",
    onclick: () => { formCat = ""; $("f-cat-new").hidden = false; renderChips(); $("f-cat-new").focus(); },
  }));
  $("f-cats").replaceChildren(...chips);
}

function openTx(t = null) {
  editing = t;
  $("tx-title").textContent = t ? "แก้รายการ" : "เพิ่มรายการ";
  $("tx-delete").hidden = !t;
  $("tx-error").hidden = true;
  $("f-cat-new").hidden = true;
  $("f-cat-new").value = "";
  formCat = t ? t.category : "";
  $("f-amount").value = t ? String(t.amount / 100) : "";
  $("f-date").value = t ? t.date : (today().startsWith(month) ? today() : `${month}-01`);
  $("f-member").value = t ? t.member : cfg.member || "";
  $("f-note").value = t ? t.note : "";
  setFormType(t ? t.type : formType);
  $("tx-dialog").showModal();
  if (!t) setTimeout(() => $("f-amount").focus(), 50);
}

function saveTx(event) {
  event.preventDefault();
  const fail = (msg) => { $("tx-error").textContent = msg; $("tx-error").hidden = false; };
  const amount = parseAmount($("f-amount").value);
  if (amount === null) return fail("ใส่จำนวนเงินให้ถูกต้อง เช่น 120 หรือ 89.50");
  const category = (formCat || $("f-cat-new").value).replace(/\s+/g, " ").trim().slice(0, 40);
  if (!category) return fail("เลือกหมวด");
  const date = $("f-date").value;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return fail("เลือกวันที่");
  if (!DEFAULT_CATS[formType].includes(category) && !(customCats[formType] || []).includes(category)) {
    customCats = { ...customCats, [formType]: [...(customCats[formType] || []), category] };
    write(KEY.cats, customCats);
  }
  const now = Date.now();
  const t = {
    ...(editing || { id: newId(), created_at: now }),
    date, type: formType, amount, category,
    note: $("f-note").value.trim().slice(0, 200),
    member: $("f-member").value.trim().slice(0, 30),
    updated_at: now, deleted: 0,
  };
  txs.set(t.id, t);
  pending.add(t.id);
  persist();
  $("tx-dialog").close();
  month = date.slice(0, 7);
  render();
  toast(editing ? "แก้แล้ว" : "บันทึกแล้ว");
  sync();
}

function deleteTx() {
  if (!editing || !confirm(`ลบรายการ ${editing.category} ${baht(editing.amount)} บาท?`)) return;
  txs.set(editing.id, { ...editing, deleted: 1, updated_at: Date.now() });
  pending.add(editing.id);
  persist();
  $("tx-dialog").close();
  render();
  toast("ลบแล้ว");
  sync();
}

// ---------------------------------------------------------------- ซิงก์

let syncing = null;

function setStatus(text, kind = "") {
  $("sync-status").textContent = text;
  $("sync-status").className = `sync ${kind}`;
}

function statusIdle() {
  if (!cfg.url || !cfg.pass) return setStatus("ยังไม่เชื่อมต่อ · เก็บในเครื่อง");
  if (pending.size) return setStatus(`รอส่ง ${pending.size} รายการ`, "warn");
  setStatus(`ซิงก์แล้ว ${new Date().toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })}`, "ok");
}

async function api(path, options = {}) {
  const res = await fetch(cfg.url.replace(/\/+$/, "") + path, {
    ...options,
    headers: { Authorization: `Bearer ${cfg.pass}`, "Content-Type": "application/json", ...(options.headers || {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body.message || `เซิร์ฟเวอร์ตอบ ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return body;
}

function sync() {
  if (!cfg.url || !cfg.pass) { statusIdle(); return Promise.resolve(); }
  if (syncing) return syncing;
  syncing = (async () => {
    setStatus("กำลังซิงก์…");
    try {
      // 1) ส่งรายการที่แก้ในเครื่อง
      const ids = [...pending];
      for (let i = 0; i < ids.length; i += 500) {
        const chunk = ids.slice(i, i + 500).map((id) => txs.get(id)).filter(Boolean);
        await api("/api/tx", { method: "POST", body: JSON.stringify({ items: chunk }) });
        chunk.forEach((t) => { if (txs.get(t.id)?.updated_at === t.updated_at) pending.delete(t.id); });
        persist();
      }
      // 2) รับรายการที่คนอื่นแก้ (ย้อนเวลาเผื่อไว้ 5 วินาที)
      const since = Math.max(0, read(KEY.pull, 0) - 5000);
      const { items, now } = await api(`/api/tx?since=${since}`);
      for (const t of items) {
        if (pending.has(t.id)) continue; // ในเครื่องแก้ใหม่กว่า รอส่งก่อน
        txs.set(t.id, { ...t, amount: Number(t.amount), deleted: Number(t.deleted) });
      }
      write(KEY.pull, now);
      persist();
      statusIdle();
      render();
    } catch (e) {
      if (e.status === 401) setStatus("รหัสครอบครัวไม่ถูกต้อง", "bad");
      else setStatus(`ออฟไลน์ · รอส่ง ${pending.size} รายการ`, "warn");
      throw e;
    } finally {
      syncing = null;
    }
  })();
  return syncing.catch(() => {});
}

// ---------------------------------------------------------------- ตั้งค่า

function openSettings(prefillUrl) {
  $("s-url").value = prefillUrl || cfg.url;
  $("s-pass").value = cfg.pass;
  $("s-member").value = cfg.member;
  $("set-msg").textContent = prefillUrl ? "ได้รับลิงก์ชวนแล้ว ใส่รหัสครอบครัวและชื่อของคุณ" : "";
  $("set-dialog").showModal();
}

async function saveSettings() {
  const url = $("s-url").value.trim().replace(/\/+$/, "");
  const pass = $("s-pass").value;
  const member = $("s-member").value.trim().slice(0, 30);
  const local = /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(url); // สำหรับทดสอบในเครื่องเท่านั้น
  if (url && !local && !/^https:\/\/[^\s/]+(\/.*)?$/.test(url)) { $("set-msg").textContent = "ที่อยู่ต้องขึ้นต้นด้วย https://"; return; }
  const changedServer = url !== cfg.url;
  cfg = { url, pass, member };
  write(KEY.cfg, cfg);
  if (!url || !pass) { $("set-msg").textContent = "บันทึกชื่อแล้ว (ยังไม่เชื่อมต่อ)"; statusIdle(); return; }
  if (changedServer) write(KEY.pull, 0);
  $("set-msg").textContent = "กำลังเชื่อมต่อ…";
  try {
    await api("/api/ping");
    [...txs.keys()].forEach((id) => { if (changedServer) pending.add(id); }); // ส่งรายการเดิมในเครื่องขึ้นไปด้วย
    persist();
    await sync();
    $("set-msg").textContent = "เชื่อมต่อสำเร็จ";
    setTimeout(() => $("set-dialog").close(), 600);
  } catch (e) {
    $("set-msg").textContent = e.status === 401 ? "รหัสครอบครัวไม่ถูกต้อง" : `เชื่อมต่อไม่ได้: ${e.message}`;
  }
}

function invite() {
  if (!cfg.url) { $("set-msg").textContent = "ใส่ที่อยู่เซิร์ฟเวอร์ก่อน"; return; }
  const link = `${location.origin}${location.pathname}#join=${encodeURIComponent(cfg.url)}`;
  const text = `ชวนใช้แอปรายรับรายจ่ายครอบครัว เปิดลิงก์แล้วใส่รหัสครอบครัว\n${link}`;
  if (navigator.share) navigator.share({ text }).catch(() => {});
  else navigator.clipboard?.writeText(link).then(() => toast("คัดลอกลิงก์แล้ว"));
}

function exportCsv() {
  const rows = [["วันที่", "ประเภท", "จำนวนเงิน", "หมวด", "บันทึก", "ผู้บันทึก"]];
  [...txs.values()].filter((t) => !t.deleted).sort((a, b) => a.date.localeCompare(b.date))
    .forEach((t) => rows.push([t.date, t.type === "income" ? "รายรับ" : "รายจ่าย", (t.amount / 100).toFixed(2), t.category, t.note, t.member]));
  const csv = "﻿" + rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\r\n");
  const file = new File([csv], `รายรับรายจ่าย-${today()}.csv`, { type: "text/csv" });
  if (navigator.canShare?.({ files: [file] })) { navigator.share({ files: [file] }).catch(() => {}); return; }
  const a = el("a", { href: URL.createObjectURL(file), download: file.name });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

function logout() {
  const left = pending.size ? `\nยังมี ${pending.size} รายการที่ยังส่งไม่ได้ จะหายไปด้วย` : "";
  if (!confirm(`ออกจากครอบครัวและลบข้อมูลในเครื่องนี้?${left}\n(ข้อมูลบนเซิร์ฟเวอร์ไม่ถูกลบ)`)) return;
  Object.values(KEY).forEach((k) => { try { localStorage.removeItem(k); } catch { /* ไม่เป็นไร */ } });
  location.reload();
}

// ---------------------------------------------------------------- เริ่มทำงาน

function shiftMonth(delta) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  month = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  render();
}

function setView(v) {
  view = v;
  $("tab-list").classList.toggle("active", v === "list");
  $("tab-cats").classList.toggle("active", v === "cats");
  $("tab-list").setAttribute("aria-selected", String(v === "list"));
  $("tab-cats").setAttribute("aria-selected", String(v === "cats"));
  render();
}

function setCatType(type) {
  catType = type;
  $("cat-expense").classList.toggle("active", type === "expense");
  $("cat-income").classList.toggle("active", type === "income");
  render();
}

$("btn-prev").addEventListener("click", () => shiftMonth(-1));
$("btn-next").addEventListener("click", () => shiftMonth(1));
$("tab-list").addEventListener("click", () => setView("list"));
$("tab-cats").addEventListener("click", () => setView("cats"));
$("cat-expense").addEventListener("click", () => setCatType("expense"));
$("cat-income").addEventListener("click", () => setCatType("income"));
$("btn-add").addEventListener("click", () => openTx());
$("type-expense").addEventListener("click", () => setFormType("expense"));
$("type-income").addEventListener("click", () => setFormType("income"));
$("f-cat-new").addEventListener("input", () => { formCat = ""; });
$("tx-form").addEventListener("submit", saveTx);
$("tx-cancel").addEventListener("click", () => $("tx-dialog").close());
$("tx-delete").addEventListener("click", deleteTx);
$("btn-settings").addEventListener("click", () => openSettings());
$("set-cancel").addEventListener("click", () => $("set-dialog").close());
$("set-save").addEventListener("click", saveSettings);
$("btn-invite").addEventListener("click", invite);
$("btn-export").addEventListener("click", exportCsv);
$("btn-sync").addEventListener("click", () => sync().then(() => toast(pending.size ? "ยังส่งไม่ได้" : "ซิงก์แล้ว")));
$("btn-logout").addEventListener("click", logout);

window.addEventListener("online", () => sync());
document.addEventListener("visibilitychange", () => { if (!document.hidden) sync(); });
setInterval(() => { if (!document.hidden) sync(); }, SYNC_EVERY);

/** เปิดจากลิงก์ชวน (#join=ที่อยู่เซิร์ฟเวอร์) */
function takeJoin() {
  const join = new URLSearchParams(location.hash.slice(1)).get("join");
  if (!join) return false;
  history.replaceState(null, "", location.pathname);
  openSettings(join);
  return true;
}
window.addEventListener("hashchange", takeJoin);

render();
statusIdle();
if (!takeJoin()) sync();

if ("serviceWorker" in navigator && (location.protocol === "https:" || ["127.0.0.1", "localhost"].includes(location.hostname))) {
  const hadController = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.register("sw.js").catch(() => {});
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (hadController && !document.querySelector("dialog[open]")) location.reload();
  });
}
