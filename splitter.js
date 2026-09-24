// แยก PDF ตามแผนกที่ HR กำหนดให้แต่ละหน้า
// - คัดลอกหน้าจากต้นฉบับเท่านั้น ไม่แก้ไขเนื้อหา (เวลาทำงาน การขาดงาน การลา)
// - ทุกหน้าต้องอยู่ในกลุ่มเดียวเท่านั้น ถ้าไม่ครบหรือซ้ำ ให้หยุดทำงาน
// - หน้าที่ยังไม่ระบุแผนก ไปอยู่กลุ่ม "รอตรวจสอบ" ระบบไม่เดาให้

export const REVIEW_NAME = "รอตรวจสอบ";
export const MAX_NAME_LENGTH = 80;

export function cleanName(name) {
  if (name == null) return null;
  const v = String(name).replace(/\s+/g, " ").trim();
  return v || null;
}

export function safeFilename(name) {
  const v = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").replace(/^[\s.]+|[\s.]+$/g, "");
  return (v || "ไม่มีชื่อ").slice(0, MAX_NAME_LENGTH);
}

/** assignments[i] = ชื่อแผนกของหน้า i (null = ยังไม่ระบุ) → { groups: [{name, pages}], unassigned } */
export function split(assignments, totalPages) {
  if (assignments.length !== totalPages) {
    throw new Error(`ต้องระบุแผนกให้ครบ ${totalPages} หน้า (ได้รับ ${assignments.length})`);
  }
  const byName = new Map();
  const unassigned = [];
  assignments.forEach((raw, page) => {
    const name = cleanName(raw);
    if (!name) return unassigned.push(page);
    if (name.length > MAX_NAME_LENGTH) throw new Error(`ชื่อแผนกยาวเกิน ${MAX_NAME_LENGTH} ตัวอักษร`);
    if (name === REVIEW_NAME) throw new Error(`ห้ามใช้ชื่อแผนก "${REVIEW_NAME}"`);
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name).push(page);
  });
  const groups = [...byName].map(([name, pages]) => ({ name, pages }));
  if (unassigned.length) groups.push({ name: REVIEW_NAME, pages: unassigned, review: true });
  verifyCoverage(groups, totalPages);
  return groups;
}

export function verifyCoverage(groups, totalPages) {
  const seen = groups.flatMap((g) => g.pages);
  if (new Set(seen).size !== seen.length) throw new Error("พบหน้าที่ถูกจัดซ้ำมากกว่า 1 กลุ่ม");
  const sorted = [...seen].sort((a, b) => a - b);
  if (sorted.length !== totalPages || sorted.some((p, i) => p !== i)) throw new Error("มีหน้าที่ไม่ได้ถูกจัดกลุ่ม");
}

/** ตั้งชื่อไฟล์ไม่ให้ซ้ำกัน (ไม่สนตัวพิมพ์เล็กใหญ่) */
export function uniqueFilenames(names) {
  const used = new Set();
  return names.map((name) => {
    const base = safeFilename(name);
    let fname = base;
    for (let n = 2; used.has(fname.toLowerCase()); n++) fname = `${base} (${n})`;
    used.add(fname.toLowerCase());
    return `${fname}.pdf`;
  });
}

export function pagesLabel(pages) {
  // [1,2,3,7] -> "1-3, 7"
  const out = [];
  let start = null;
  let prev = null;
  for (const p of pages) {
    if (start === null) { start = prev = p; continue; }
    if (p === prev + 1) { prev = p; continue; }
    out.push(start === prev ? `${start}` : `${start}-${prev}`);
    start = prev = p;
  }
  if (start !== null) out.push(start === prev ? `${start}` : `${start}-${prev}`);
  return out.join(", ");
}
