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
