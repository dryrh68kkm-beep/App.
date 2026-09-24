// เติมชื่อแผนกให้ล่วงหน้า จาก PDF ที่มีข้อความ (ไม่ใช้ OCR)
// - อ่านเฉพาะส่วนบนของหน้า ไม่อ่านตารางเวลาทำงาน
// - เป็นเพียงค่าแนะนำ HR ต้องตรวจและแก้ได้ก่อนสร้างไฟล์
// - หน้าที่เป็นภาพสแกนไม่มีข้อความ จึงไม่มีค่าแนะนำ

import { ALIASES, DEPARTMENT_PATTERNS, HEADER_AREA } from "./config.js";

const LABEL_WORDS = new Set([
  "รหัส", "รหัสพนักงาน", "ชื่อ", "ชื่อ-สกุล", "ชื่อ-นามสกุล", "ชื่อพนักงาน",
  "หน่วยงาน", "ชื่อหน่วยงาน", "แผนก", "ฝ่าย", "ตำแหน่ง", "วันที่", "หน้า",
]);

export function normalizeText(text) {
  return text
    .normalize("NFC")
    .replace(/ํา/g, "ำ") // สระอำที่ถูกแยกเป็น นิคหิต + สระอา
    .replace(/[\t ​]/g, " ");
}

export function cleanDepartment(value) {
  let v = value.replace(/\s+/g, " ").replace(/^[\s:：\-–|,]+|[\s:：\-–|,]+$/g, "");
  if (!v || LABEL_WORDS.has(v)) return null;
  const coded = v.match(/^[A-Z0-9]+\s*:\s*(.+)$/);
  // ชื่อแบบรหัสสาขา เช่น "ABCD1:DRY-Dry Food" -> "DRY-DryFood" ให้ตรงกับรายชื่อแผนก
  if (coded) v = coded[1].replace(/\s+/g, "");
  return ALIASES[v] || v;
}

// แบ่งข้อความส่วนหัวเป็นบรรทัด ช่องที่ห่างกันมากคั่นด้วยช่องว่างสองช่อง
function headerLines(items, pageHeight) {
  const parts = items
    .filter((it) => it.str && it.str.trim())
    .map((it) => {
      const h = Math.abs(it.transform[3]) || it.height || 10;
      const x = it.transform[4];
      const top = pageHeight - it.transform[5] - h;
      return { x, x1: x + (it.width || 0), y: top + h / 2, h, text: normalizeText(it.str) };
    })
    .filter((p) => p.y < pageHeight * HEADER_AREA)
    .sort((a, b) => a.y - b.y || a.x - b.x);

  const lines = [];
  for (const p of parts) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(p.y - last.y) <= p.h * 0.5) last.parts.push(p);
    else lines.push({ y: p.y, parts: [p] });
  }
  return lines.map((ln) => {
    ln.parts.sort((a, b) => a.x - b.x);
    let text = "";
    let prev = null;
    for (const p of ln.parts) {
      if (prev) text += p.x - prev.x1 > p.h * 0.9 ? "  " : p.x - prev.x1 > p.h * 0.15 ? " " : "";
      text += p.text.trim();
      prev = p;
    }
    // ตัด "รหัสหน่วยงาน : 010-..." ออก ไม่ให้รหัสถูกอ่านเป็นชื่อแผนก
    return text.replace(/รหัสหน่วยงาน\s*[:：]?\s*\S*/g, "  ");
  });
}

export function suggestFromText(items, pageHeight) {
  const lines = headerLines(items, pageHeight);
  // ลองแบบ "บรรทัดนี้ + บรรทัดถัดไป" ก่อน เพราะบางรายงานมีป้ายอยู่บน ค่าอยู่ล่าง
  // (ถ้าลองทีละบรรทัดก่อน บรรทัด "แผนกจำลอง ข" จะถูกอ่านผิดเป็น ป้าย "แผนก" + ค่า "จำลอง ข")
  const candidates = [];
  for (let i = 0; i + 1 < lines.length; i++) candidates.push(`${lines[i]}  ${lines[i + 1]}`);
  candidates.push(...lines);
  for (const rx of DEPARTMENT_PATTERNS) {
    for (const text of candidates) {
      const m = text.match(rx);
      const v = m && cleanDepartment(m[1]);
      if (v) return v;
    }
  }
  return null;
}

export async function suggestDepartment(page) {
  const content = await page.getTextContent();
  if (!content.items.some((it) => it.str && it.str.trim())) return null;
  const { height } = page.getViewport({ scale: 1 });
  return suggestFromText(content.items, height);
}
