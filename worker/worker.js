// FamilyMoney API (Cloudflare Worker + D1)
// - ทุกคำขอต้องมีรหัสครอบครัว (ตั้งเป็น secret ชื่อ FAMILY_PASSWORD ใน Cloudflare)
// - เก็บเฉพาะรายการรายรับรายจ่าย ไม่มี log ข้อมูลรายการ
//
// GET  /api/ping              ตรวจรหัส → { ok: true }
// GET  /api/tx?since=<ms>     รายการที่แก้หลังเวลานั้น → { items, now }
// POST /api/tx { items: [] }  บันทึก/แก้/ลบ (deleted: 1) → { saved, now }
// GET/POST /api/debt          หนี้สิน (ชื่อ ยอดหนี้ตั้งต้น) แบบเดียวกัน

const ALLOWED_ORIGINS = [
  "https://dryrh68kkm-beep.github.io",
  "http://127.0.0.1:8800",
  "http://localhost:8800",
];
const MAX_ITEMS = 500;

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const cors = {
      "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Access-Control-Max-Age": "86400",
      Vary: "Origin",
    };
    const json = (body, status = 200) => new Response(JSON.stringify(body), {
      status, headers: { ...cors, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
    });

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return json({ error: "not_found" }, 404);

    if (!env.FAMILY_PASSWORD) return json({ error: "no_password", message: "ยังไม่ได้ตั้งรหัสครอบครัว (FAMILY_PASSWORD)" }, 500);
    if (!env.DB) return json({ error: "no_db", message: "ยังไม่ได้ผูกฐานข้อมูล D1 ชื่อ DB" }, 500);
    const given = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!(await sameSecret(given, env.FAMILY_PASSWORD))) {
      await new Promise((r) => setTimeout(r, 400)); // ชะลอการเดารหัส
      return json({ error: "unauthorized", message: "รหัสครอบครัวไม่ถูกต้อง" }, 401);
    }

    try {
      await ensureSchema(env.DB);
      if (url.pathname === "/api/ping" && request.method === "GET") return json({ ok: true, now: Date.now() });

      const col = COLLECTIONS[url.pathname.slice(5)];
      if (col && request.method === "GET") {
        const since = Math.max(0, Number(url.searchParams.get("since")) || 0);
        const { results } = await env.DB
          .prepare(`SELECT * FROM ${col.table} WHERE updated_at >= ? ORDER BY updated_at LIMIT 5000`)
          .bind(since).all();
        return json({ items: results, now: Date.now() });
      }

      if (col && request.method === "POST") {
        const body = await request.json().catch(() => null);
        const items = Array.isArray(body?.items) ? body.items : null;
        if (!items || items.length > MAX_ITEMS) return json({ error: "bad_request", message: "รูปแบบข้อมูลไม่ถูกต้อง" }, 400);
        const clean = items.map(col.validate);
        const bad = clean.findIndex((x) => !x);
        if (bad >= 0) return json({ error: "bad_item", index: bad, message: "มีรายการที่ข้อมูลไม่ถูกต้อง" }, 400);
        const now = Date.now();
        const cols = [...col.fields, "created_at", "updated_at", "deleted"];
        const keep = new Set(["id", "created_at"]); // ไม่เปลี่ยนเมื่อแก้
        const stmt = env.DB.prepare(
          `INSERT INTO ${col.table} (${cols.join(", ")}) VALUES (${cols.map((_, i) => `?${i + 1}`).join(", ")})
           ON CONFLICT(id) DO UPDATE SET ${cols.map((c, i) => (keep.has(c) ? null : `${c} = ?${i + 1}`)).filter(Boolean).join(", ")}`,
        );
        if (clean.length) {
          await env.DB.batch(clean.map((t) => stmt.bind(...cols.map((c) => (c === "updated_at" ? now : t[c])))));
        }
        return json({ saved: clean.length, now });
      }

      return json({ error: "not_found" }, 404);
    } catch (e) {
      return json({ error: "server", message: "ฐานข้อมูลขัดข้อง ลองใหม่อีกครั้ง" }, 500);
    }
  },
};

// สร้าง/ปรับตารางครั้งแรก (ครั้งเดียวต่อ instance) — ตรงกับ worker/schema.sql
let schemaReady = null;
function ensureSchema(db) {
  schemaReady ||= (async () => {
    await db.batch([
      db.prepare(`CREATE TABLE IF NOT EXISTS tx (
        id TEXT PRIMARY KEY, date TEXT NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
        amount INTEGER NOT NULL, category TEXT NOT NULL,
        note TEXT NOT NULL DEFAULT '', member TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0)`),
      db.prepare("CREATE INDEX IF NOT EXISTS tx_updated ON tx(updated_at)"),
      db.prepare(`CREATE TABLE IF NOT EXISTS debt (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, principal INTEGER NOT NULL,
        note TEXT NOT NULL DEFAULT '', member TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0)`),
      db.prepare("CREATE INDEX IF NOT EXISTS debt_updated ON debt(updated_at)"),
    ]);
    // รุ่นแรกไม่มีคอลัมน์ debt_id (รายจ่ายที่ตัดยอดหนี้)
    const { results } = await db.prepare("PRAGMA table_info(tx)").all();
    if (!results.some((c) => c.name === "debt_id")) {
      await db.prepare("ALTER TABLE tx ADD COLUMN debt_id TEXT NOT NULL DEFAULT ''").run();
    }
  })().catch((e) => { schemaReady = null; throw e; });
  return schemaReady;
}

const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const okId = (id) => /^[A-Za-z0-9_-]{8,64}$/.test(id);
const okAmount = (n) => Number.isSafeInteger(n) && n >= 0 && n <= 1e13;
const stamp = (t) => {
  const created = Number(t.created_at);
  return { created_at: Number.isSafeInteger(created) && created > 0 ? created : Date.now(), deleted: t.deleted ? 1 : 0 };
};

/** ตรวจและจัดรูปรายการที่ส่งมา (null = ไม่ถูกต้อง) */
export function validate(t) {
  if (!t || typeof t !== "object") return null;
  const id = str(t.id, 64);
  const date = str(t.date, 10);
  const amount = Number(t.amount);
  const category = str(t.category, 40);
  const debtId = str(t.debt_id, 64);
  if (!okId(id)) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  if (t.type !== "income" && t.type !== "expense") return null;
  if (!okAmount(amount)) return null;
  if (!category) return null;
  if (debtId && !okId(debtId)) return null;
  return {
    id, date, type: t.type, amount, category,
    note: str(t.note, 200),
    member: str(t.member, 30),
    debt_id: t.type === "expense" ? debtId : "",
    ...stamp(t),
  };
}

/** หนี้: ชื่อ + ยอดหนี้ตั้งต้น (ยอดคงเหลือ = ตั้งต้น − รายจ่ายที่ตัดยอดหนี้นี้) */
export function validateDebt(t) {
  if (!t || typeof t !== "object") return null;
  const id = str(t.id, 64);
  const name = str(t.name, 60);
  const principal = Number(t.principal);
  if (!okId(id) || !name || !okAmount(principal)) return null;
  return { id, name, principal, note: str(t.note, 200), member: str(t.member, 30), ...stamp(t) };
}

const COLLECTIONS = {
  tx: { table: "tx", validate, fields: ["id", "date", "type", "amount", "category", "note", "member", "debt_id"] },
  debt: { table: "debt", validate: validateDebt, fields: ["id", "name", "principal", "note", "member"] },
};

/** เทียบรหัสแบบใช้เวลาเท่ากัน */
async function sameSecret(a, b) {
  const enc = new TextEncoder();
  const [x, y] = await Promise.all([a, b].map((s) => crypto.subtle.digest("SHA-256", enc.encode(String(s)))));
  const ua = new Uint8Array(x), ub = new Uint8Array(y);
  let diff = 0;
  for (let i = 0; i < ua.length; i++) diff |= ua[i] ^ ub[i];
  return diff === 0;
}
