// ตั้งค่า DeptFlow — แก้ไฟล์นี้ได้ ห้ามใส่ชื่อหรือรหัสพนักงานจริง

// ชื่อแผนกที่ให้เลือก (ใช้เป็นชื่อไฟล์ด้วย) พิมพ์ชื่อใหม่ในแอปได้เสมอ
export const DEPARTMENTS = [
  "DRY-DryFood",
  "FSH-Butchery",
  "FSH-Seafood",
  "FSH-Produce",
  "FSH-Delica",
  "FSH-Bakery",
  "FSH-Perishable",
  "FSH-Bakery&Delica",
  "FSH-Butchery&SeaFood",
  "NFD-NonFood",
  "SPR-LossPrevention",
  "SPR-Maintenance",
  "SPR-CustomerExperience",
  "SPR-Omnichannel",
  "SPR-Omnichannel-PickPa",
];

// กรอบภาพหัวเอกสารที่แสดงให้ดู [ซ้าย, บน, ขวา, ล่าง] เป็นสัดส่วนของหน้า
export const HEADER_BOX = [0.0, 0.045, 0.8, 0.125];

// ใช้เฉพาะ PDF ที่มีข้อความ: อ่านชื่อแผนกจากส่วนบนของหน้าเพื่อเติมให้ล่วงหน้า (ไฟล์สแกนต้องเลือกเอง)
export const HEADER_AREA = 0.3;
export const DEPARTMENT_PATTERNS = [
  /(?:ชื่อ)?(?:หน่วยงาน|แผนก|ฝ่าย)\s*[:：]?\s*(.+?)(?=\s{2,}|\s*(?:รหัส|ชื่อ|ตำแหน่ง|วันที่|ประจำ|หน้า|ระหว่าง)|$)/u,
  /(?:Dept|Department)\s*[:：]?\s*(.+?)(?=\s{2,}|\s*(?:Emp|Name|Date|Page)|$)/u,
];

// เปลี่ยนชื่อที่อ่านได้ให้เป็นชื่อที่ต้องการ เช่น { "FSH-Bakery&Delica": "FSH-Bakery" }
export const ALIASES = {};
