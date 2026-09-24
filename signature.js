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

export async function pageSignature(page, box) {
  const base = page.getViewport({ scale: 1 });
  const scale = RENDER_WIDTH / ((box[2] - box[0]) * base.width);
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
  const px = ctx.getImageData(0, 0, w, h).data;
  canvas.width = canvas.height = 0;

  const bits = new Uint8Array(SIG_W * SIG_H);
  let ink = 0;
  for (let ty = 0; ty < SIG_H; ty++) {
    const y0 = Math.floor((ty * h) / SIG_H), y1 = Math.floor(((ty + 1) * h) / SIG_H);
    for (let tx = 0; tx < SIG_W; tx++) {
      const x0 = Math.floor((tx * w) / SIG_W), x1 = Math.floor(((tx + 1) * w) / SIG_W);
      let sum = 0, n = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const k = (y * w + x) * 4;
          sum += 0.299 * px[k] + 0.587 * px[k + 1] + 0.114 * px[k + 2];
          n++;
        }
      }
      const on = n && sum / n < INK_LEVEL ? 1 : 0;
      bits[ty * SIG_W + tx] = on;
      ink += on;
    }
  }
  return ink / bits.length < MIN_INK ? null : bits;
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
