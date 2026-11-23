// รัน Worker ในเครื่องสำหรับทดสอบ (ฐานข้อมูล SQLite ชั่วคราวในหน่วยความจำ ข้อมูลจำลองเท่านั้น)
// node tests/dev_worker.mjs  → http://127.0.0.1:8787  รหัสครอบครัว: test-pass
import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";
import worker from "../worker/worker.js";

const sqlite = new DatabaseSync(":memory:");
// ไม่สร้างตารางล่วงหน้า: Worker ต้องสร้างเอง (ensureSchema)
// OLD_SCHEMA=1 จำลองฐานข้อมูลรุ่นแรก (ไม่มี debt_id / ตาราง debt) เพื่อทดสอบการอัปเกรด
if (process.env.OLD_SCHEMA) {
  sqlite.exec(`CREATE TABLE tx (id TEXT PRIMARY KEY, date TEXT NOT NULL, type TEXT NOT NULL CHECK (type IN ('income','expense')),
    amount INTEGER NOT NULL, category TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', member TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0);
    INSERT INTO tx VALUES ('oldrow0001','2026-01-05','expense',5000,'อาหาร','','',1,1,0);`);
}

// ตัวแทน D1 แบบย่อ (prepare/bind/all/run/batch)
const DB = {
  prepare(sql) {
    const make = (params) => ({
      bind: (...p) => make(p),
      all: async () => ({ results: sqlite.prepare(sql).all(...params) }),
      run: async () => sqlite.prepare(sql).run(...params),
    });
    return make([]);
  },
  async batch(stmts) {
    sqlite.exec("BEGIN");
    try { const out = []; for (const s of stmts) out.push(await s.run()); sqlite.exec("COMMIT"); return out; }
    catch (e) { sqlite.exec("ROLLBACK"); throw e; }
  },
};
const env = { DB, FAMILY_PASSWORD: "test-pass" };

createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const request = new Request(`http://127.0.0.1:8787${req.url}`, { method: req.method, headers: req.headers, body: req.method === "GET" || req.method === "HEAD" ? undefined : body });
  const r = await worker.fetch(request, env);
  res.writeHead(r.status, Object.fromEntries(r.headers));
  res.end(Buffer.from(await r.arrayBuffer()));
}).listen(8787, "127.0.0.1", () => console.log("dev worker on http://127.0.0.1:8787"));
