// รัน Worker ในเครื่องสำหรับทดสอบ (ฐานข้อมูล SQLite ชั่วคราวในหน่วยความจำ ข้อมูลจำลองเท่านั้น)
// node tests/dev_worker.mjs  → http://127.0.0.1:8787  รหัสครอบครัว: test-pass
import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";
import worker from "../worker/worker.js";

const sqlite = new DatabaseSync(":memory:");
// ไม่สร้างตารางล่วงหน้า: Worker ต้องสร้างเอง (ensureSchema)

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
