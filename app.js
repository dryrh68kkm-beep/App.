// DeptFlow (มือถือ) — ทำงานในเบราว์เซอร์ของเครื่องนี้ทั้งหมด
// ไม่มีการส่งเอกสารออกนอกเครื่อง ไม่มี analytics ไม่ใช้ OCR
// ไฟล์ PDF อยู่ในหน่วยความจำเท่านั้น และถูกลบเมื่อกดล้างข้อมูลหรือปิดแอป

import * as pdfjsLib from "./vendor/pdf.min.mjs";
import { DEPARTMENTS, DEPT_BOX, HEADER_BOX, KNOWN_SIGNATURES } from "./config.js";
import { suggestDepartment } from "./detect.js";
import { cluster, decode, encode, pageSignature, recall } from "./signature.js";
import { REVIEW_NAME, pagesLabel, split, uniqueFilenames } from "./splitter.js";
import { makeZip } from "./zip.js";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL("./vendor/pdf.worker.min.mjs", import.meta.url).href;

const $ = (id) => document.getElementById(id);
const EXCLUDED = "\u0000excluded"; // หน้าที่ HR เลือก "ยกเว้น" ไปอยู่กลุ่มรอตรวจสอบ
const STRIPES = 6;
const CUSTOM_KEY = "deptflow.customDepartments"; // เก็บเฉพาะชื่อแผนกที่พิมพ์เพิ่ม ไม่มีข้อมูลพนักงาน
const MEMORY_KEY = "deptflow.deptSignatures";    // ลายเส้นภาพชื่อหน่วยงาน → ชื่อแผนก (ไม่มีข้อมูลพนักงาน)
const CLUSTER = "\u0000cluster:";                 // หน้านี้เริ่มกลุ่มที่แอปจัดให้ (ชื่อมาจากกลุ่ม)
const IS_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
  || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

let srcBytes = null;   // Uint8Array ของไฟล์ต้นฉบับ
let pdfDoc = null;     // เอกสารของ pdf.js สำหรับแสดงภาพ
let total = 0;
let sourceName = "";
let explicit = [];     // ชื่อแผนกที่กำหนดที่หน้านั้นโดยตรง (null = ใช้ตามหน้าก่อน)
let origin = [];       // "file" = เติมจากข้อความในไฟล์, "user" = HR เลือกเอง
let outputs = [];      // [{ name, filename, pages, file, review }]
let groups = [];       // กลุ่มที่แอปจัดจากภาพชื่อหน่วยงาน: [{ sig, pages, name, source }]
let renderObserver = null;

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

function showStep(n) {
  $("step-upload").hidden = n !== 1;
  $("step-assign").hidden = n !== 2;
  $("step-result").hidden = n !== 3;
  for (let i = 1; i <= 3; i++) $(`step-dot-${i}`).className = i === n ? "active" : i < n ? "done" : "";
  document.body.classList.toggle("has-bottom-bar", n === 2);
  window.scrollTo({ top: 0 });
}

function showError(id, msg) {
  $(id).textContent = msg;
  $(id).hidden = false;
}

// ---------------------------------------------------------------- ชื่อแผนก

function loadCustomDepartments() {
  try {
    const v = JSON.parse(localStorage.getItem(CUSTOM_KEY) || "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function rememberDepartments(names) {
  const custom = new Set(loadCustomDepartments());
  for (const n of names) if (n && !DEPARTMENTS.includes(n) && n !== REVIEW_NAME) custom.add(n);
  try {
    localStorage.setItem(CUSTOM_KEY, JSON.stringify([...custom].slice(-50)));
  } catch { /* เบราว์เซอร์ไม่ให้เก็บ ไม่เป็นไร */ }
}

function loadMemory() {
  let saved = [];
  try {
    saved = JSON.parse(localStorage.getItem(MEMORY_KEY) || "[]");
    if (!Array.isArray(saved)) saved = [];
  } catch { saved = []; }
  return [...saved, ...KNOWN_SIGNATURES]
    .filter((m) => m && typeof m.name === "string" && typeof m.sig === "string")
    .map((m) => ({ name: m.name, sig: m.sig, bits: decode(m.sig) }));
}

function learnGroups() {
  // จำลายเส้นของกลุ่มที่ทุกหน้าได้ชื่อแผนกเดียวกัน ครั้งหน้าจะใส่ชื่อให้เอง
  const eff = effective();
  let saved = [];
  try { saved = JSON.parse(localStorage.getItem(MEMORY_KEY) || "[]"); } catch { saved = []; }
  if (!Array.isArray(saved)) saved = [];
  for (const g of groups) {
    const names = new Set(g.pages.map((p) => eff[p]));
    if (names.size !== 1) continue;
    const [name] = names;
    if (!name || name === REVIEW_NAME) continue;
    const sig = encode(g.sig);
    saved = saved.filter((m) => m.sig !== sig);
    saved.push({ name, sig });
  }
  try { localStorage.setItem(MEMORY_KEY, JSON.stringify(saved.slice(-200))); } catch { /* ไม่เป็นไร */ }
}

async function autoGroup() {
  // เทียบภาพช่องชื่อหน่วยงานของทุกหน้า แล้วใส่แผนกที่หน้าแรกของแต่ละกลุ่ม
  const sigs = [];
  for (let i = 0; i < total; i++) {
    $("loading-text").textContent = `กำลังจัดกลุ่มแผนกจากภาพ ${i + 1}/${total}...`;
    sigs.push(await pageSignature(await pdfDoc.getPage(i + 1), DEPT_BOX).catch(() => null));
  }
  const { clusterOf, clusters } = cluster(sigs);
  const memory = loadMemory();
  groups = clusters.map((c) => {
    const fromFile = c.pages.map((p) => (origin[p] === "file" ? explicit[p] : null)).find(Boolean);
    const remembered = fromFile ? null : recall(c.sig, memory);
    return { ...c, name: fromFile || remembered || null, source: fromFile ? "file" : remembered ? "memory" : "new" };
  });
  if (groups.length < 2 && !groups.some((g) => g.name)) {
    groups = []; // ไม่พบช่องชื่อหน่วยงานที่ต่างกัน ให้ HR เลือกเองทีละหน้า
    return;
  }
  let last = null;
  clusterOf.forEach((k, i) => {
    if (k === null) return;
    if (k !== last && origin[i] !== "user") {
      explicit[i] = `${CLUSTER}${k}`;
      origin[i] = "auto";
    } else if (origin[i] === "file") {
      explicit[i] = null; // กลุ่มเป็นคนกำหนดแล้ว ไม่ต้องซ้ำ
      origin[i] = null;
    }
    last = k;
  });
}

const clusterIndex = (v) => (typeof v === "string" && v.startsWith(CLUSTER) ? Number(v.slice(CLUSTER.length)) : -1);

// ---------------------------------------------------------------- เปิดไฟล์

async function openFile(file) {
  $("upload-error").hidden = true;
  if (!file) return;
  if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") {
    showError("upload-error", "กรุณาเลือกไฟล์ PDF");
    return;
  }
  $("loading").hidden = false;
  $("dropzone").hidden = true;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (String.fromCharCode(...bytes.slice(0, 4)) !== "%PDF") throw new Error("ไฟล์นี้ไม่ใช่ PDF");
    await closeDocument();
    // pdf.js ย้ายข้อมูลไปให้ worker จึงส่งสำเนาไป และเก็บต้นฉบับไว้แยกไฟล์
    pdfDoc = await pdfjsLib.getDocument({ data: bytes.slice(), isEvalSupported: false }).promise;
    srcBytes = bytes;
    total = pdfDoc.numPages;
    sourceName = file.name;
    explicit = new Array(total).fill(null);
    origin = new Array(total).fill(null);
    outputs = [];
    groups = [];

    $("loading-text").textContent = "กำลังดูว่ามีชื่อแผนกในไฟล์หรือไม่...";
    let prev = null;
    for (let i = 0; i < total; i++) {
      const s = await suggestDepartment(await pdfDoc.getPage(i + 1)).catch(() => null);
      if (s && s !== prev) { explicit[i] = s; origin[i] = "file"; }
      if (s) prev = s;
    }
    await autoGroup();
    renderAssign();
    showStep(2);
  } catch (e) {
    const msg = e?.name === "PasswordException" ? "ไฟล์ PDF มีรหัสผ่าน กรุณาปลดรหัสผ่านก่อน"
      : e?.name === "InvalidPDFException" ? "เปิดไฟล์ PDF ไม่ได้ ไฟล์อาจเสียหาย"
      : e.message || "เปิดไฟล์ไม่สำเร็จ";
    showError("upload-error", msg);
  } finally {
    $("loading").hidden = true;
    $("loading-text").textContent = "กำลังเปิดไฟล์...";
    $("dropzone").hidden = false;
    $("file-input").value = "";
  }
}

// ---------------------------------------------------------------- วาดภาพหน้า

let renderChain = Promise.resolve();

function renderQueued(fn) {
  // วาดทีละภาพ ไม่ให้มือถือทำงานหนักเกิน
  renderChain = renderChain.then(fn, fn).catch(() => {});
  return renderChain;
}

async function renderRegion(pageNo, canvas, box, targetWidth) {
  if (!pdfDoc) return;
  const page = await pdfDoc.getPage(pageNo);
  const base = page.getViewport({ scale: 1 });
  const [x0, y0, x1, y1] = box || [0, 0, 1, 1];
  const scale = targetWidth / ((x1 - x0) * base.width);
  const vp = page.getViewport({ scale });
  canvas.width = Math.round((x1 - x0) * vp.width);
  canvas.height = Math.round((y1 - y0) * vp.height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport: vp, transform: [1, 0, 0, 1, -x0 * vp.width, -y0 * vp.height] }).promise;
}

function observeThumbnails() {
  renderObserver?.disconnect();
  renderObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const canvas = entry.target;
      renderObserver.unobserve(canvas);
      const width = Math.min(1100, Math.round(canvas.clientWidth * (window.devicePixelRatio || 1)) || 800);
      const box = canvas.dataset.crop === "dept" ? DEPT_BOX : HEADER_BOX;
      renderQueued(() => renderRegion(Number(canvas.dataset.page), canvas, box, width)
        .then(() => canvas.classList.add("ready")));
    }
  }, { rootMargin: "600px 0px" });
  document.querySelectorAll("canvas.thumb, canvas.dept-crop").forEach((c) => renderObserver.observe(c));
}

// ---------------------------------------------------------------- ดูทั้งหน้า

let viewer = { pages: [], index: 0, title: "" };

function openViewer(pages, index, title) {
  viewer = { pages, index, title };
  $("preview-dialog").showModal();
  drawViewer();
}

async function drawViewer() {
  const { pages, index, title } = viewer;
  $("pv-title").textContent = `${title} · หน้า ${pages[index] + 1}${pages.length > 1 ? ` (${index + 1}/${pages.length})` : ""}`;
  $("pv-prev").disabled = index === 0;
  $("pv-next").disabled = index === pages.length - 1;
  const canvas = $("pv-canvas");
  const width = Math.min(1600, Math.round(($("preview-dialog").clientWidth || 390) * (window.devicePixelRatio || 1)));
  await renderQueued(() => renderRegion(pages[index] + 1, canvas, null, width));
}

// ---------------------------------------------------------------- กำหนดแผนก

function effective() {
  const out = [];
  let current = null;
  for (const v of explicit) {
    if (v === EXCLUDED) { out.push(null); continue; }
    const k = clusterIndex(v);
    if (k >= 0) current = groups[k]?.name || null; // กลุ่มที่ยังไม่ตั้งชื่อ = ยังไม่ระบุ
    else if (v) current = v;
    out.push(current);
  }
  return out;
}

function renderAssign() {
  $("assign-source").textContent = `${sourceName} · ${total} หน้า`;
  $("split-error").hidden = true;
  $("page-list").replaceChildren(...explicit.map((_, i) => pageRow(i)));
  renderGroups();
  refreshAssign();
  observeThumbnails();
}

function renderGroups() {
  const panel = $("auto-groups");
  panel.hidden = groups.length === 0;
  if (!groups.length) return;
  const known = groups.filter((g) => g.name).length;
  $("auto-summary").textContent = known === groups.length
    ? `พบ ${groups.length} แผนก ตั้งชื่อครบแล้ว ตรวจภาพอีกครั้งแล้วกดสร้างไฟล์ได้เลย`
    : `พบ ${groups.length} แผนก · ตั้งชื่อแล้ว ${known} · ใส่ชื่อแผนกที่เหลือ (ครั้งเดียว ครั้งหน้าแอปจำได้)`;
  $("auto-list").replaceChildren(...groups.map((g, k) => {
    const input = el("input", {
      class: "dept-input", type: "text", list: "dept-options", autocomplete: "off",
      autocapitalize: "off", spellcheck: "false", enterkeyhint: "done",
      placeholder: "ชื่อแผนกของกลุ่มนี้", "aria-label": `ชื่อแผนกกลุ่มที่ ${k + 1}`,
    });
    input.value = g.name || "";
    input.addEventListener("input", () => {
      g.name = input.value.replace(/\s+/g, " ").trim() || null;
      g.source = g.name ? "user" : "new";
      refreshAssign();
      refreshGroupTags();
    });
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); input.blur(); } });
    const canvas = el("canvas", { class: "dept-crop", "data-page": String(g.pages[0] + 1), "data-crop": "dept" });
    return el("li", { class: "auto-row", "data-k": String(k) },
      el("div", { class: "row-head" },
        el("span", { class: "page-no", text: `กลุ่ม ${k + 1} · ${g.pages.length} หน้า · หน้า ${pagesLabel(g.pages.map((p) => p + 1))}` }),
        el("span", { class: "tag" })),
      el("button", { class: "thumb-button", type: "button", title: "ดูทั้งหน้า",
        onclick: () => openViewer(g.pages, 0, `กลุ่ม ${k + 1}`) }, canvas),
      input);
  }));
  refreshGroupTags();
}

function refreshGroupTags() {
  document.querySelectorAll(".auto-row").forEach((row) => {
    const g = groups[Number(row.dataset.k)];
    const tag = row.querySelector(".tag");
    tag.className = "tag";
    if (!g.name) { tag.textContent = "ใส่ชื่อ"; tag.classList.add("warn"); }
    else if (g.source === "memory") { tag.textContent = "จำได้จากครั้งก่อน"; tag.classList.add("file"); }
    else if (g.source === "file") { tag.textContent = "อ่านจากไฟล์"; tag.classList.add("file"); }
    else { tag.textContent = "ตั้งชื่อแล้ว"; tag.classList.add("start"); }
  });
}

function pageRow(i) {
  const page = i + 1;
  const input = el("input", {
    class: "dept-input", type: "text", list: "dept-options", autocomplete: "off",
    autocapitalize: "off", spellcheck: "false", enterkeyhint: "next",
    "aria-label": `แผนกของหน้า ${page}`, "data-i": String(i),
  });
  input.addEventListener("input", () => {
    const v = input.value.replace(/\s+/g, " ").trim();
    explicit[i] = v || null;
    origin[i] = v ? "user" : null;
    refreshAssign(i);
  });
  input.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    input.blur();
  });
  const exclude = el("button", { class: "btn ghost", type: "button", "data-i": String(i) });
  exclude.addEventListener("click", () => {
    if (explicit[i] === EXCLUDED) { explicit[i] = null; origin[i] = null; }
    else { explicit[i] = EXCLUDED; origin[i] = "user"; }
    refreshAssign();
  });
  const canvas = el("canvas", { class: "thumb", "data-page": String(page), "aria-label": `หัวเอกสารหน้า ${page}` });
  const thumbButton = el("button", { class: "thumb-button", type: "button", title: "ดูทั้งหน้า" }, canvas);
  thumbButton.addEventListener("click", () => openViewer([...Array(total).keys()], i, sourceName));
  return el("li", { class: "page-row", "data-i": String(i) },
    el("div", { class: "row-head" }, el("span", { class: "page-no", text: `หน้า ${page}` }), el("span", { class: "tag" })),
    thumbButton,
    input,
    el("div", { class: "row-foot" }, exclude));
}

function refreshAssign(skipInputIndex = -1) {
  const eff = effective();
  const order = new Map();
  for (const v of eff) if (v && !order.has(v)) order.set(v, order.size);

  document.querySelectorAll(".page-row").forEach((row) => {
    const i = Number(row.dataset.i);
    const input = row.querySelector(".dept-input");
    const tag = row.querySelector(".tag");
    const exclude = row.querySelector(".ghost");
    const isExcluded = explicit[i] === EXCLUDED;
    const k = clusterIndex(explicit[i]);
    if (i !== skipInputIndex) input.value = isExcluded || !explicit[i] ? "" : k >= 0 ? (groups[k]?.name || "") : explicit[i];
    input.disabled = isExcluded;
    input.placeholder = isExcluded ? "ยกเว้นหน้านี้ (ไปรอตรวจสอบ)"
      : eff[i] ? `ตามหน้าก่อน: ${eff[i]}` : "เลือกหรือพิมพ์ชื่อแผนก";
    exclude.textContent = isExcluded ? "ยกเลิกยกเว้น" : "ยกเว้นหน้านี้";

    row.classList.toggle("starts", Boolean(eff[i] && (i === 0 || eff[i - 1] !== eff[i])));
    row.classList.toggle("unassigned", !eff[i]);
    for (let s = 0; s < STRIPES; s++) row.classList.remove(`stripe-${s}`);
    if (eff[i]) row.classList.add(`stripe-${order.get(eff[i]) % STRIPES}`);

    tag.className = "tag";
    if (isExcluded) { tag.textContent = "ยกเว้น"; tag.classList.add("warn"); }
    else if (k >= 0 && !eff[i]) { tag.textContent = `กลุ่ม ${k + 1} · ใส่ชื่อด้านบน`; tag.classList.add("warn"); }
    else if (k >= 0) { tag.textContent = `แอปจัดให้ · กลุ่ม ${k + 1}`; tag.classList.add("file"); }
    else if (explicit[i] && origin[i] === "file") { tag.textContent = "อ่านจากไฟล์ · ตรวจอีกครั้ง"; tag.classList.add("file"); }
    else if (explicit[i]) { tag.textContent = "เริ่มแผนกใหม่"; tag.classList.add("start"); }
    else if (eff[i]) { tag.textContent = "ตามหน้าก่อน"; }
    else { tag.textContent = "ยังไม่ระบุ"; tag.classList.add("warn"); }
  });

  const assigned = eff.filter(Boolean).length;
  $("assign-count").textContent = `ระบุแล้ว ${assigned}/${eff.length} หน้า · ${order.size} แผนก`;
  $("assign-fill").style.width = `${eff.length ? (assigned / eff.length) * 100 : 0}%`;
  const names = new Set([...DEPARTMENTS, ...loadCustomDepartments(), ...order.keys()]);
  $("dept-options").replaceChildren(...[...names].map((n) => el("option", { value: n })));
}

// ---------------------------------------------------------------- สร้างไฟล์

async function buildOutputs() {
  $("split-error").hidden = true;
  const eff = effective();
  const missing = eff.map((v, i) => (v ? null : i + 1)).filter(Boolean);
  if (missing.length === eff.length) {
    showError("split-error", "ยังไม่ได้เลือกแผนกเลย กรุณาเลือกแผนกที่หน้าแรกของแต่ละแผนก");
    return;
  }
  if (missing.length && !confirm(`หน้า ${pagesLabel(missing)} ยังไม่ระบุแผนก จะไปอยู่ไฟล์ "${REVIEW_NAME}"\nดำเนินการต่อหรือไม่?`)) return;

  const button = $("btn-split");
  button.disabled = true;
  button.textContent = "กำลังสร้าง...";
  try {
    const parts = split(eff, total);
    const filenames = uniqueFilenames(parts.map((g) => g.name));
    const { PDFDocument } = window.PDFLib;
    const src = await PDFDocument.load(srcBytes, { updateMetadata: false });
    const built = [];
    for (let k = 0; k < parts.length; k++) {
      const g = parts[k];
      const out = await PDFDocument.create({ updateMetadata: false });
      const copied = await out.copyPages(src, g.pages);
      copied.forEach((p) => out.addPage(p));
      const bytes = await out.save();
      await verifyCopy(bytes, src, g.pages);
      built.push({
        ...g,
        filename: filenames[k],
        file: new File([bytes], filenames[k], { type: "application/pdf" }),
      });
    }
    outputs = built;
    rememberDepartments(split(eff, total).map((g) => g.name));
    learnGroups();
    renderResult();
    showStep(3);
  } catch (e) {
    const msg = e?.name === "EncryptedPDFError" ? "ไฟล์ PDF มีรหัสผ่าน กรุณาปลดรหัสผ่านก่อน" : e.message;
    showError("split-error", `สร้างไฟล์ไม่สำเร็จ: ${msg}`);
  } finally {
    button.disabled = false;
    button.textContent = "สร้างไฟล์";
  }
}

async function verifyCopy(bytes, src, pages) {
  // ตรวจว่าไฟล์ใหม่มีครบทุกหน้า และขนาดหน้าตรงกับต้นฉบับ
  const check = await window.PDFLib.PDFDocument.load(bytes, { updateMetadata: false });
  if (check.getPageCount() !== pages.length) throw new Error("จำนวนหน้าที่คัดลอกไม่ตรงกับที่กำหนด");
  pages.forEach((p, i) => {
    const a = src.getPage(p).getSize();
    const b = check.getPage(i).getSize();
    if (Math.abs(a.width - b.width) > 0.01 || Math.abs(a.height - b.height) > 0.01) {
      throw new Error("ขนาดหน้าที่คัดลอกไม่ตรงกับต้นฉบับ");
    }
  });
}

function renderResult() {
  $("source-name").textContent = sourceName;
  const pageSum = outputs.reduce((s, o) => s + o.pages.length, 0);
  const ok = pageSum === total;
  $("coverage").className = `coverage ${ok ? "ok" : "bad"}`;
  $("coverage").textContent = ok ? `✓ ครบ ${pageSum}/${total} หน้า ไม่ซ้ำ` : `✗ ได้ ${pageSum}/${total} หน้า`;
  const review = outputs.find((o) => o.review);
  $("kpi-pages").textContent = total;
  $("kpi-depts").textContent = outputs.filter((o) => !o.review).length;
  $("kpi-review").textContent = review ? review.pages.length : 0;
  $("kpi-review").parentElement.classList.toggle("warn", Boolean(review));

  $("group-list").replaceChildren(...outputs.map((o, k) => {
    const pages = o.pages.map((p) => p + 1);
    const buttons = [
      el("button", { class: "btn small secondary", type: "button", text: "ดูหน้า",
        onclick: () => openViewer(o.pages, 0, o.name) }),
      el("button", { class: "btn small teal", type: "button", text: IS_IOS ? "แชร์ / บันทึก" : "แชร์",
        onclick: () => openShare(o.file, o.name) }),
      IS_IOS ? null : el("button", { class: "btn small secondary", type: "button", text: "ดาวน์โหลด",
        onclick: () => download(o.file) }),
    ];
    return el("article", { class: `card group${o.review ? " review" : ""}`, "data-k": String(k) },
      el("div", { class: "group-head" },
        el("div", { class: `icon-box ${o.review ? "warn" : "blue"}`, text: o.review ? "!" : String(k + 1) }),
        el("div", { class: "grow" },
          el("h3", { text: o.name }),
          el("p", { class: "helper", text: `${o.pages.length} หน้า · หน้า ${pagesLabel(pages)} ในไฟล์เดิม` }))),
      o.review ? el("p", { class: "notice", text: "หน้าที่ยังไม่ระบุแผนก แอปไม่เดาให้ กรุณาตรวจและจัดการเอง" }) : null,
      el("div", { class: "row-actions" }, ...buttons));
  }));
}

// ---------------------------------------------------------------- แชร์ / บันทึก

let pendingShare = null;

function openShare(file, label) {
  pendingShare = file;
  $("share-title").textContent = `แชร์ ${file.name}`;
  $("share-confirm").checked = false;
  $("share-status").textContent = "";
  const can = Boolean(navigator.canShare && navigator.canShare({ files: [file] }));
  $("share-fallback").hidden = can;
  $("share-go").textContent = can ? "เปิดเมนูแชร์" : "ดาวน์โหลดไฟล์";
  $("share-go").disabled = true;
  $("share-dialog").showModal();
}

async function doShare() {
  const file = pendingShare;
  if (!file || !$("share-confirm").checked) return;
  const can = Boolean(navigator.canShare && navigator.canShare({ files: [file] }));
  if (!can) {
    download(file);
    $("share-dialog").close();
    return;
  }
  try {
    await navigator.share({ files: [file], title: file.name });
    $("share-dialog").close();
  } catch (e) {
    $("share-status").textContent = e.name === "AbortError" ? "ยกเลิกการแชร์" : "แชร์ไม่สำเร็จ กรุณาลองอีกครั้ง";
  }
}

function download(file) {
  const url = URL.createObjectURL(file);
  const a = el("a", { href: url, download: file.name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

async function saveZip() {
  const files = await Promise.all(outputs.map(async (o) => ({ name: o.filename, data: new Uint8Array(await o.file.arrayBuffer()) })));
  const lines = ["DeptFlow - สรุปการแยกไฟล์ตามแผนก", `ไฟล์ต้นฉบับ: ${total} หน้า`, ""];
  for (const o of outputs) lines.push(`${o.name}: ${o.pages.length} หน้า`);
  files.push({ name: "สรุป.txt", data: new TextEncoder().encode(lines.join("\r\n") + "\r\n") });
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
  const zip = new File([makeZip(files)], `DeptFlow_${stamp}.zip`, { type: "application/zip" });
  if (IS_IOS) openShare(zip, "ทั้งหมด");
  else download(zip);
}

// ---------------------------------------------------------------- ล้างข้อมูล

async function closeDocument() {
  renderObserver?.disconnect();
  if (pdfDoc) await pdfDoc.destroy().catch(() => {});
  pdfDoc = null;
  srcBytes = null;
  outputs = [];
  pendingShare = null;
}

async function resetAll(ask) {
  if (ask && !confirm("ล้างเอกสารทั้งหมดออกจากแอป?")) return;
  await closeDocument();
  total = 0;
  sourceName = "";
  explicit = [];
  origin = [];
  groups = [];
  $("page-list").replaceChildren();
  $("auto-list").replaceChildren();
  $("group-list").replaceChildren();
  $("pv-canvas").width = 0;
  showStep(1);
}

// ---------------------------------------------------------------- เชื่อมปุ่ม

$("file-input").addEventListener("change", (e) => openFile(e.target.files[0]));
$("btn-split").addEventListener("click", buildOutputs);
$("btn-edit").addEventListener("click", () => { showStep(2); observeThumbnails(); });
$("btn-zip").addEventListener("click", saveZip);
$("btn-new").addEventListener("click", () => resetAll(false));
$("btn-new-2").addEventListener("click", () => resetAll(false));
$("btn-clear").addEventListener("click", () => resetAll(true));
$("btn-clear-2").addEventListener("click", () => resetAll(true));
$("share-confirm").addEventListener("change", () => { $("share-go").disabled = !$("share-confirm").checked; });
$("share-go").addEventListener("click", doShare);
$("share-cancel").addEventListener("click", () => $("share-dialog").close());
$("pv-close").addEventListener("click", () => $("preview-dialog").close());
$("pv-prev").addEventListener("click", () => { if (viewer.index > 0) { viewer.index--; drawViewer(); } });
$("pv-next").addEventListener("click", () => { if (viewer.index < viewer.pages.length - 1) { viewer.index++; drawViewer(); } });

$("install-hint").hidden = !(IS_IOS && !navigator.standalone);

// ใช้งานออฟไลน์ได้หลังเปิดครั้งแรก (เก็บเฉพาะไฟล์ของแอป ไม่เก็บเอกสาร)
if ("serviceWorker" in navigator && (location.protocol === "https:" || ["127.0.0.1", "localhost"].includes(location.hostname))) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
