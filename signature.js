// จัดกลุ่มหน้าตามแผนกโดย "เทียบภาพ" ช่องชื่อหน่วยงาน (ไม่อ่านตัวหนังสือ ไม่ใช้ OCR)
// - ตัดภาพเฉพาะช่องชื่อหน่วยงาน (DEPT_BOX) แปลงเป็นลายเส้นขาวดำขนาดเล็ก 200x12
// - หน้าที่ลายเส้นเหมือนกัน = แผนกเดียวกัน
// - แอปจำว่าลายเส้นแบบไหนคือแผนกอะไร (เก็บในเครื่อง) ครั้งต่อไปจึงใส่ชื่อให้เอง
// ลายเส้นเป็นภาพชื่อหน่วยงานเท่านั้น ไม่มีชื่อหรือรหัสพนักงาน

export const SIG_W = 200;
export const SIG_H = 12;
const RENDER_WIDTH = 800;
const INK_LEVEL = 170;       // ค่าความสว่างที่ถือว่าเป็นหมึก
const MIN_INK = 0.01;        // ช่องที่มีหมึกน้อยกว่านี้ถือว่าว่าง
export const SAME_FILE = 0.008;  // ในไฟล์เดียวกัน ต่างกันไม่เกินนี้ = แผนกเดียวกัน
export const REMEMBERED = 0.02;  // เทียบกับที่จำไว้ ต่างกันไม่เกินนี้ และต้องชนะอันดับสองชัดเจน

// ช่วงที่ใช้ค้นหาบรรทัดชื่อหน่วยงานเมื่อรายงานเปลี่ยนขนาดหรือรูปแบบ (ฝั่งขวาของหัวเอกสาร)
// ไม่ครอบรหัสและชื่อพนักงาน ซึ่งอยู่ฝั่งซ้าย และไม่ครอบโลโก้มุมขวา
export const SEARCH_BOX = [0.56, 0.02, 0.84, 0.16];
const SEARCH_WIDTH = 480;

/** วาดเฉพาะกรอบ box ของหน้าแล้วคืนค่าความสว่างของแต่ละจุด (เก็บในหน่วยความจำชั่วคราวเท่านั้น) */
export async function renderPixels(page, box, width) {
  const base = page.getViewport({ scale: 1 });
  const scale = width / ((box[2] - box[0]) * base.width);
  const vp = page.getViewport({ scale });
  const w = Math.max(SIG_W, Math.round((box[2] - box[0]) * vp.width));
  const h = Math.max(SIG_H, Math.round((box[3] - box[1]) * vp.height));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  await page.render({
    canvasContext: ctx, viewport: vp,
    transform: [1, 0, 0, 1, -box[0] * vp.width, -box[1] * vp.height],
  }).promise;
  const rgba = ctx.getImageData(0, 0, w, h).data;
  canvas.width = canvas.height = 0; // คืนหน่วยความจำทันที (สำคัญบน iPhone)
  page.cleanup();
  const lum = new Uint8Array(w * h);
  for (let i = 0, k = 0; i < lum.length; i++, k += 4) {
    lum[i] = (0.299 * rgba[k] + 0.587 * rgba[k + 1] + 0.114 * rgba[k + 2]) | 0;
  }
  return { lum, w, h };
}

/** ย่อแถว y0..y1 ของภาพให้เป็นลายเส้นขาวดำ 200x12 (null ถ้าแทบไม่มีหมึก) */
export function sigFromPixels({ lum, w, h }, y0 = 0, y1 = h) {
  const bh = Math.max(1, y1 - y0);
  const bits = new Uint8Array(SIG_W * SIG_H);
  let ink = 0;
  for (let ty = 0; ty < SIG_H; ty++) {
    const ya = y0 + Math.floor((ty * bh) / SIG_H), yb = Math.max(ya + 1, y0 + Math.floor(((ty + 1) * bh) / SIG_H));
    for (let tx = 0; tx < SIG_W; tx++) {
      const xa = Math.floor((tx * w) / SIG_W), xb = Math.max(xa + 1, Math.floor(((tx + 1) * w) / SIG_W));
      let sum = 0, n = 0;
      for (let y = ya; y < yb && y < h; y++) {
        for (let x = xa; x < xb && x < w; x++) { sum += lum[y * w + x]; n++; }
      }
      const on = n && sum / n < INK_LEVEL ? 1 : 0;
      bits[ty * SIG_W + tx] = on;
      ink += on;
    }
  }
  return ink / bits.length < MIN_INK ? null : bits;
}

export async function pageSignature(page, box) {
  return sigFromPixels(await renderPixels(page, box, RENDER_WIDTH));
}

/** หาแถวตัวหนังสือ (บรรทัด) ในภาพ คืน [{ y0, y1 }] เป็นสัดส่วน 0-1 ของความสูงภาพ */
export function findBands({ lum, w, h }) {
  const dark = [];
  for (let y = 0; y < h; y++) {
    let n = 0;
    for (let x = 0; x < w; x++) if (lum[y * w + x] < INK_LEVEL) n++;
    dark.push(n > Math.max(2, w * 0.004));
  }
  const bands = [];
  let start = -1, gap = 0;
  for (let y = 0; y <= h; y++) {
    if (y < h && dark[y]) {
      if (start < 0) start = y;
      gap = 0;
    } else if (start >= 0 && (++gap > 2 || y === h)) {
      const end = y - gap + 1;
      const height = end - start;
      if (height >= h * 0.03 && height <= h * 0.3) {
        bands.push({ y0: Math.max(0, start - 2) / h, y1: Math.min(h, end + 2) / h });
      }
      start = -1;
      gap = 0;
    }
  }
  return bands;
}

export function bandSignature(pixels, band) {
  return sigFromPixels(pixels, Math.floor(band.y0 * pixels.h), Math.ceil(band.y1 * pixels.h));
}

export function distance(a, b) {
  let d = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
  return d / a.length;
}

export function encode(bits) {
  const bytes = new Uint8Array(Math.ceil(bits.length / 8));
  bits.forEach((b, i) => { if (b) bytes[i >> 3] |= 1 << (i & 7); });
  let s = "";
  bytes.forEach((b) => { s += String.fromCharCode(b); });
  return btoa(s);
}

export function decode(text) {
  const raw = atob(text);
  const bits = new Uint8Array(SIG_W * SIG_H);
  for (let i = 0; i < bits.length; i++) bits[i] = (raw.charCodeAt(i >> 3) >> (i & 7)) & 1;
  return bits;
}

/** จัดกลุ่มหน้าที่ลายเส้นเหมือนกัน: คืน { clusterOf: [index|null ต่อหน้า], clusters: [{ sig, pages }] } */
export function cluster(signatures) {
  const clusters = [];
  const clusterOf = signatures.map((sig, page) => {
    if (!sig) return null;
    let k = clusters.findIndex((c) => distance(c.sig, sig) <= SAME_FILE);
    if (k < 0) {
      clusters.push({ sig, pages: [] });
      k = clusters.length - 1;
    }
    clusters[k].pages.push(page);
    return k;
  });
  return { clusterOf, clusters };
}

/** หาชื่อแผนกจากลายเส้นที่จำไว้ ต้องใกล้พอ และชนะอันดับสองชัดเจน ไม่เช่นนั้นไม่เดา */
export function recall(sig, memory) {
  const scored = memory
    .map((m) => ({ name: m.name, d: distance(sig, m.bits) }))
    .sort((a, b) => a.d - b.d);
  const best = scored[0];
  if (!best || best.d > REMEMBERED) return null;
  const second = scored.find((s) => s.name !== best.name);
  if (second && second.d < Math.max(best.d * 2, best.d + 0.01)) return null;
  return best.name;
}
