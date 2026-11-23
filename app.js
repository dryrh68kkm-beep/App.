// รายรับรายจ่ายครอบครัว — บันทึกในเครื่องก่อนเสมอ แล้วซิงก์กับ Cloudflare Worker ของครอบครัว
// ใช้ได้แม้ไม่มีเน็ต รายการที่ยังส่งไม่ได้จะส่งเองเมื่อกลับมาออนไลน์

const $ = (id) => document.getElementById(id);
const KEY = {
  tx: "money.tx", pending: "money.pending", pull: "money.lastPull",
  debt: "money.debt", pendingDebt: "money.pendingDebt", pullDebt: "money.lastPullDebt",
  cfg: "money.cfg", cats: "money.cats",
};
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
const debts = new Map(read(KEY.debt, []).map((d) => [d.id, d]));
const pendingDebt = new Set(read(KEY.pendingDebt, []));
let cfg = read(KEY.cfg, { url: "", pass: "", member: "" });
let customCats = read(KEY.cats, { expense: [], income: [] });

function persist() {
  write(KEY.tx, [...txs.values()]);
  write(KEY.pending, [...pending]);
  write(KEY.debt, [...debts.values()]);
  write(KEY.pendingDebt, [...pendingDebt]);
}

/** หนี้ที่ยังไม่ลบ พร้อมยอดจ่ายแล้ว / คงเหลือ (คงเหลือ = ตั้งต้น − รายจ่ายที่ตัดยอดหนี้นี้) */
function debtRows() {
  const paid = new Map();
  for (const t of txs.values()) {
    if (!t.deleted && t.type === "expense" && t.debt_id) paid.set(t.debt_id, (paid.get(t.debt_id) || 0) + t.amount);
  }
  return [...debts.values()].filter((d) => !d.deleted)
    .map((d) => ({ ...d, paid: paid.get(d.id) || 0, left: Math.max(0, d.principal - (paid.get(d.id) || 0)) }))
    .sort((a, b) => b.left - a.left);
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
  const rows = debtRows();
  $("sum-debt-card").hidden = rows.length === 0;
  $("sum-debt").textContent = baht(rows.reduce((s, d) => s + d.left, 0));
  for (const v of ["list", "cats", "debt"]) {
    $(`view-${v}`).hidden = view !== v;
    $(`tab-${v}`).classList.toggle("active", view === v);
    $(`tab-${v}`).setAttribute("aria-selected", String(view === v));
  }
  if (view === "list") renderList(items);
  else if (view === "cats") renderCats(items);
  else renderDebts(rows);
}

function renderDebts(rows) {
  const total = rows.reduce((s, d) => s + d.left, 0);
  $("debt-total").textContent = baht(total);
  $("debt-count").textContent = rows.length ? `${rows.length} รายการ · จ่ายไปแล้วรวม ${baht(rows.reduce((s, d) => s + d.paid, 0))}` : "";
  $("debt-empty").hidden = rows.length > 0;
  $("debt-list").replaceChildren(...rows.map((d) => {
    const pct = d.principal ? Math.min(100, (d.paid / d.principal) * 100) : 0;
    const fill = el("div", { class: "bar-fill" });
    fill.style.width = `${Math.max(pct, 1)}%`;
    return el("li", {},
      el("button", { class: `debt-item${d.left === 0 ? " done" : ""}`, type: "button", onclick: () => openDebt(d) },
        el("div", { class: "bar-head" }, el("b", { text: d.name }), el("b", { class: "debt-left", text: d.left === 0 ? "ปิดแล้ว ✓" : baht(d.left) })),
        el("div", { class: "bar-track" }, fill),
        el("small", { text: `ยอดตั้งต้น ${baht(d.principal)} · จ่ายแล้ว ${baht(d.paid)} (${Math.round(pct)}%)${d.note ? ` · ${d.note}` : ""}` }),
        cfg.url && pendingDebt.has(d.id) ? el("span", { class: "wait", title: "รอส่ง", text: "•" }) : null));
  }));
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
          el("small", { text: [t.debt_id && debts.get(t.debt_id) ? `ตัดหนี้: ${debts.get(t.debt_id).name}` : "", t.note, t.member].filter(Boolean).join(" · ") || " " })),
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
  $("f-debt-field").hidden = type !== "expense" || debtRows().length === 0;
  $("tx-to-debt").hidden = !editing || type !== "expense";
}

function fillDebtOptions(selected) {
  const rows = debtRows();
  if (selected && !rows.some((d) => d.id === selected) && debts.get(selected)) rows.push({ ...debts.get(selected), left: 0 });
  $("f-debt").replaceChildren(el("option", { value: "", text: "ไม่ตัดยอดหนี้" }),
    ...rows.map((d) => el("option", { value: d.id, text: `${d.name} (เหลือ ${baht(d.left)})` })));
  $("f-debt").value = selected || "";
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
  fillDebtOptions(t?.debt_id || "");
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
    debt_id: formType === "expense" ? $("f-debt").value : "",
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

/** รายการที่บันทึกเป็นรายจ่ายแต่จริงๆ คือยอดหนี้ทั้งก้อน → ย้ายไปหนี้สิน */
function txToDebt() {
  if (!editing) return;
  const amount = parseAmount($("f-amount").value) ?? editing.amount;
  const note = $("f-note").value.trim();
  const name = (formCat || $("f-cat-new").value || editing.category).trim() + (note ? ` · ${note}` : "");
  if (!confirm(`ย้าย "${name}" ${baht(amount)} บาท ไปเป็นหนี้สิน?\nรายการนี้จะไม่นับเป็นรายจ่ายของเดือนอีก`)) return;
  const now = Date.now();
  const d = { id: newId(), name: name.slice(0, 60), principal: amount, note: "", member: editing.member, created_at: now, updated_at: now, deleted: 0 };
  debts.set(d.id, d);
  pendingDebt.add(d.id);
  txs.set(editing.id, { ...editing, deleted: 1, updated_at: now });
  pending.add(editing.id);
  persist();
  $("tx-dialog").close();
  render();
  toast("ย้ายไปหนี้สินแล้ว");
  sync();
}

let editingDebt = null;

function openDebt(d = null) {
  editingDebt = d;
  $("debt-title").textContent = d ? "แก้หนี้" : "เพิ่มหนี้";
  $("debt-delete").hidden = !d;
  $("debt-error").hidden = true;
  $("d-name").value = d ? d.name : "";
  $("d-principal").value = d ? String(d.principal / 100) : "";
  $("d-note").value = d ? d.note : "";
  $("d-paid").textContent = d ? `จ่ายแล้ว ${baht(d.paid)} · คงเหลือ ${baht(d.left)} (ตัดยอดเองเมื่อบันทึกรายจ่ายแล้วเลือกหนี้นี้)` : "บันทึกรายจ่ายแล้วเลือก \"ตัดยอดหนี้\" ยอดคงเหลือจะลดลงเอง";
  $("debt-dialog").showModal();
  if (!d) setTimeout(() => $("d-name").focus(), 50);
}

function saveDebt(event) {
  event.preventDefault();
  const fail = (msg) => { $("debt-error").textContent = msg; $("debt-error").hidden = false; };
  const name = $("d-name").value.replace(/\s+/g, " ").trim().slice(0, 60);
  if (!name) return fail("ใส่ชื่อหนี้ เช่น ผ่อนบ้าน");
  const principal = parseAmount($("d-principal").value);
  if (principal === null) return fail("ใส่ยอดหนี้ให้ถูกต้อง");
  const now = Date.now();
  const d = {
    ...(editingDebt ? debts.get(editingDebt.id) : { id: newId(), created_at: now, member: cfg.member || "" }),
    name, principal, note: $("d-note").value.trim().slice(0, 200), updated_at: now, deleted: 0,
  };
  debts.set(d.id, d);
  pendingDebt.add(d.id);
  persist();
  $("debt-dialog").close();
  render();
  toast(editingDebt ? "แก้แล้ว" : "เพิ่มหนี้แล้ว");
  sync();
}

function deleteDebt() {
  if (!editingDebt || !confirm(`ลบหนี้ "${editingDebt.name}"?\nรายจ่ายที่เคยตัดยอดยังอยู่ในรายการตามเดิม`)) return;
  debts.set(editingDebt.id, { ...debts.get(editingDebt.id), deleted: 1, updated_at: Date.now() });
  pendingDebt.add(editingDebt.id);
  persist();
  $("debt-dialog").close();
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
  if (pending.size + pendingDebt.size) return setStatus(`รอส่ง ${pending.size + pendingDebt.size} รายการ`, "warn");
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
      const parts = [
        { path: "/api/tx", map: txs, wait: pending, pull: KEY.pull, nums: ["amount", "deleted", "created_at", "updated_at"] },
        { path: "/api/debt", map: debts, wait: pendingDebt, pull: KEY.pullDebt, nums: ["principal", "deleted", "created_at", "updated_at"] },
      ];
      for (const part of parts) {
        // 1) ส่งรายการที่แก้ในเครื่อง
        const ids = [...part.wait];
        for (let i = 0; i < ids.length; i += 500) {
          const chunk = ids.slice(i, i + 500).map((id) => part.map.get(id)).filter(Boolean);
          await api(part.path, { method: "POST", body: JSON.stringify({ items: chunk }) });
          chunk.forEach((t) => { if (part.map.get(t.id)?.updated_at === t.updated_at) part.wait.delete(t.id); });
          persist();
        }
        // 2) รับรายการที่คนอื่นแก้ (ย้อนเวลาเผื่อไว้ 5 วินาที)
        const since = Math.max(0, read(part.pull, 0) - 5000);
        const { items, now } = await api(`${part.path}?since=${since}`);
        for (const t of items) {
          if (part.wait.has(t.id)) continue; // ในเครื่องแก้ใหม่กว่า รอส่งก่อน
          const row = { ...t };
          part.nums.forEach((k) => { row[k] = Number(row[k]) || 0; });
          part.map.set(t.id, row);
        }
        write(part.pull, now);
        persist();
      }
      statusIdle();
      render();
    } catch (e) {
      if (e.status === 401) setStatus("รหัสครอบครัวไม่ถูกต้อง", "bad");
      else setStatus(`ออฟไลน์ · รอส่ง ${pending.size + pendingDebt.size} รายการ`, "warn");
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
  if (changedServer) { write(KEY.pull, 0); write(KEY.pullDebt, 0); }
  $("set-msg").textContent = "กำลังเชื่อมต่อ…";
  try {
    await api("/api/ping");
    if (changedServer) { // ส่งรายการเดิมในเครื่องขึ้นไปด้วย
      txs.forEach((_, id) => pending.add(id));
      debts.forEach((_, id) => pendingDebt.add(id));
    }
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
  const rows = [["วันที่", "ประเภท", "จำนวนเงิน", "หมวด", "บันทึก", "ผู้บันทึก", "ตัดยอดหนี้"]];
  [...txs.values()].filter((t) => !t.deleted).sort((a, b) => a.date.localeCompare(b.date))
    .forEach((t) => rows.push([t.date, t.type === "income" ? "รายรับ" : "รายจ่าย", (t.amount / 100).toFixed(2), t.category, t.note, t.member, debts.get(t.debt_id)?.name || ""]));
  rows.push([], ["หนี้สิน", "ยอดตั้งต้น", "จ่ายแล้ว", "คงเหลือ", "บันทึก"]);
  debtRows().forEach((d) => rows.push([d.name, (d.principal / 100).toFixed(2), (d.paid / 100).toFixed(2), (d.left / 100).toFixed(2), d.note]));
  const csv = "﻿" + rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\r\n");
  const file = new File([csv], `รายรับรายจ่าย-${today()}.csv`, { type: "text/csv" });
  if (navigator.canShare?.({ files: [file] })) { navigator.share({ files: [file] }).catch(() => {}); return; }
  const a = el("a", { href: URL.createObjectURL(file), download: file.name });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

function logout() {
  const waiting = pending.size + pendingDebt.size;
  const left = waiting ? `\nยังมี ${waiting} รายการที่ยังส่งไม่ได้ จะหายไปด้วย` : "";
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
$("tab-debt").addEventListener("click", () => setView("debt"));
$("sum-debt-card").addEventListener("click", () => setView("debt"));
$("btn-add-debt").addEventListener("click", () => openDebt());
$("debt-form").addEventListener("submit", saveDebt);
$("debt-cancel").addEventListener("click", () => $("debt-dialog").close());
$("debt-delete").addEventListener("click", deleteDebt);
$("tx-to-debt").addEventListener("click", txToDebt);
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
$("btn-sync").addEventListener("click", () => sync().then(() => toast(pending.size + pendingDebt.size ? "ยังส่งไม่ได้" : "ซิงก์แล้ว")));
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
