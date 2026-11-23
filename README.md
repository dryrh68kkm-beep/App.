# รายรับรายจ่ายครอบครัว (แอปมือถือ)

บันทึกรายรับรายจ่ายของครอบครัว ทุกคนเห็นข้อมูลเดียวกันทุกเครื่อง
- ใช้งานได้แม้ไม่มีเน็ต: บันทึกในเครื่องก่อน แล้วส่งขึ้นเซิร์ฟเวอร์เองเมื่อกลับมาออนไลน์
- เซิร์ฟเวอร์คือ Cloudflare Worker + ฐานข้อมูล D1 ของเจ้าของบัญชี ไม่ใช้บริการอื่น
- ทุกคำขอต้องมี **รหัสครอบครัว** ที่ตั้งไว้ใน Cloudflare (ไม่อยู่ในโค้ด)

แอป: https://dryrh68kkm-beep.github.io/App./

## ใช้งาน

1. เปิดลิงก์ใน **Safari** → ปุ่มแชร์ → *เพิ่มไปยังหน้าจอโฮม*
2. แตะ ⚙︎ → ใส่ที่อยู่เซิร์ฟเวอร์ รหัสครอบครัว และชื่อของคุณ → **บันทึกและเชื่อมต่อ**
3. แตะ **+** → เลือกรายจ่าย/รายรับ → ใส่จำนวนเงิน → เลือกหมวด → **บันทึก**
4. แตะรายการเพื่อแก้หรือลบ · แท็บ **ตามหมวด** ดูสัดส่วนตามหมวดและตามคน
5. ⚙︎ → **ส่งลิงก์ชวนครอบครัว** (ลิงก์มีแค่ที่อยู่เซิร์ฟเวอร์ ไม่มีรหัส) · **ส่งออก CSV** สำรองข้อมูล

## ติดตั้งเซิร์ฟเวอร์ (ทำครั้งเดียว ใน Cloudflare Dashboard)

ตอน deploy Cloudflare จะสร้างฐานข้อมูล D1 ชื่อ `family-money` ในบัญชีให้เอง (`wrangler.toml`)
และ Worker สร้างตารางเองตอนใช้งานครั้งแรก (โครงสร้างใน `worker/schema.sql`)

1. **Workers & Pages → Create → Import a repository** → เลือก `dryrh68kkm-beep/App.`
2. Project name: **`family-money`** (ต้องตรงกับ `name` ใน `wrangler.toml`) · Build command: เว้นว่าง · Deploy command: `npx wrangler deploy` → **Deploy**
3. หน้า Worker → **Settings → Variables and Secrets → Add** · Type: **Secret** · Name: `FAMILY_PASSWORD` · Value: รหัสครอบครัว (ยาวอย่างน้อย 10 ตัว) → Deploy
4. คัดลอกที่อยู่ Worker (เช่น `https://family-money.<ชื่อบัญชี>.workers.dev`) ไปใส่ในแอป

ทุกครั้งที่แก้โค้ดใน `main` Cloudflare จะ deploy Worker ใหม่ให้เอง

## โครงสร้าง

```
index.html  style.css  app.js   หน้าแอป (ไม่มีสคริปต์จากภายนอก)
sw.js  manifest.webmanifest     ใช้ออฟไลน์ / ติดตั้งเป็นแอป (ไม่เก็บข้อมูลการเงินใน cache)
icons/                          ไอคอนแอป
worker/worker.js                API: /api/ping, GET/POST /api/tx
worker/schema.sql               ตาราง D1
wrangler.toml                   ตั้งค่า Worker + D1 (ไม่มีรหัส)
tests/                          Worker จำลอง + เทสต์ 2 เครื่อง (ข้อมูลจำลองเท่านั้น)
```

## ทดสอบ

```
node tests/dev_worker.mjs                      # Worker จำลอง รหัส test-pass
python -m http.server 8800 --bind 127.0.0.1
python tests/e2e_test.py
```

## ความปลอดภัย

- ห้ามใส่รหัสครอบครัวหรือข้อมูลการเงินจริงในโค้ด README Issues หรือไฟล์ทดสอบ
- รหัสครอบครัวเก็บในเครื่องที่เชื่อมต่อแล้ว ถ้ามือถือหายให้เปลี่ยน `FAMILY_PASSWORD` ใน Cloudflare
- Worker รับคำขอจากหน้าแอปนี้เท่านั้น (CORS) และตรวจข้อมูลทุกรายการก่อนบันทึก
