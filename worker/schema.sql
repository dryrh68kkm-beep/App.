-- ตารางรายการรายรับรายจ่าย (amount เป็นสตางค์ เช่น 125.50 บาท = 12550)
CREATE TABLE IF NOT EXISTS tx (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
  amount INTEGER NOT NULL,
  category TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  member TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS tx_updated ON tx(updated_at);

-- รายจ่ายที่ตัดยอดหนี้ (เพิ่มในรุ่นที่ 2: Worker เพิ่มให้เองถ้ายังไม่มี)
-- ALTER TABLE tx ADD COLUMN debt_id TEXT NOT NULL DEFAULT '';

-- หนี้สิน: ยอดคงเหลือ = principal − ผลรวมรายจ่ายที่ debt_id ตรงกัน
CREATE TABLE IF NOT EXISTS debt (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  principal INTEGER NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  member TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS debt_updated ON debt(updated_at);
