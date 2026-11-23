"""ทดสอบแอปรายรับรายจ่าย 2 เครื่อง (ข้อมูลจำลองเท่านั้น)

    node tests/dev_worker.mjs                         # Worker จำลอง พอร์ต 8787 รหัส test-pass
    python -m http.server 8800 --bind 127.0.0.1      # รันที่โฟลเดอร์หลักของ repo
    python tests/e2e_test.py
"""
import os

from playwright.sync_api import sync_playwright

URL = os.environ.get("APP_URL", "http://127.0.0.1:8800/")
API = os.environ.get("API_URL", "http://127.0.0.1:8787")
CHROMIUM = os.environ.get("CHROMIUM_PATH")


def device(browser, errors):
    ctx = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
    page = ctx.new_page()
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" and "401" not in m.text and "INTERNET_DISCONNECTED" not in m.text else None)
    page.goto(URL)
    return ctx, page


def add(page, kind, amount, cat, note=""):
    page.click("#btn-add")
    page.click(f"#type-{kind}")
    page.fill("#f-amount", amount)
    if page.locator(f'#f-cats .chip:text-is("{cat}")').count():
        page.click(f'#f-cats .chip:text-is("{cat}")')
    else:
        page.click("#f-cats .chip.add")
        page.fill("#f-cat-new", cat)
    page.fill("#f-note", note)
    page.click("#tx-save")
    page.wait_for_selector("#tx-dialog[open]", state="detached")


def connect(page, name, password="test-pass"):
    page.click("#btn-settings")
    page.fill("#s-url", API)
    page.fill("#s-pass", password)
    page.fill("#s-member", name)
    page.click("#set-save")


def sync(page):
    page.click("#btn-settings")
    page.click("#btn-sync")
    page.wait_for_timeout(600)
    page.click("#set-cancel")


def main():
    errors = []
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=CHROMIUM) if CHROMIUM else p.chromium.launch()
        ctx_a, a = device(browser, errors)
        ctx_b, b = device(browser, errors)

        # เครื่อง A ใช้แบบไม่เชื่อมต่อก่อน
        assert "ยังไม่เชื่อมต่อ" in a.inner_text("#sync-status")
        add(a, "income", "25,000", "เงินเดือน")
        add(a, "expense", "120.50", "อาหาร", "ข้าวเที่ยง (จำลอง)")
        add(a, "expense", "80", "ค่าขนมแมว")  # หมวดใหม่
        assert a.inner_text("#sum-income") == "25,000", a.inner_text("#sum-income")
        assert a.inner_text("#sum-expense") == "200.5", a.inner_text("#sum-expense")
        assert a.inner_text("#sum-balance") == "24,799.5"

        # รหัสผิด
        connect(a, "พ่อ", "wrong")
        a.wait_for_selector('#set-msg:has-text("ไม่ถูกต้อง")', timeout=5000)
        a.click("#set-cancel")

        # เชื่อมต่อ A แล้วรายการเดิมต้องขึ้นเซิร์ฟเวอร์
        connect(a, "พ่อ")
        a.wait_for_selector("#set-dialog[open]", state="detached", timeout=8000)
        assert "ซิงก์แล้ว" in a.inner_text("#sync-status"), a.inner_text("#sync-status")

        # B เปิดลิงก์ชวน แล้วใส่รหัส
        b.goto(f"{URL}#join={API}")
        b.wait_for_selector("#set-dialog[open]")
        assert b.input_value("#s-url") == API
        b.fill("#s-pass", "test-pass")
        b.fill("#s-member", "แม่")
        b.click("#set-save")
        b.wait_for_selector("#set-dialog[open]", state="detached", timeout=8000)
        assert b.inner_text("#sum-balance") == "24,799.5", b.inner_text("#sum-balance")

        # B เพิ่มและแก้ A ต้องเห็น
        add(b, "expense", "1,500", "น้ำ-ไฟ-เน็ต")
        b.click('.tx:has-text("ค่าขนมแมว")')
        b.fill("#f-amount", "100")
        b.click("#tx-save")
        b.wait_for_timeout(500)
        sync(a)
        assert a.inner_text("#sum-expense") == "1,720.5", a.inner_text("#sum-expense")
        assert "แม่" in a.inner_text("#tx-list")

        # A ออฟไลน์ เพิ่มรายการ → รอส่ง → กลับมาออนไลน์ส่งเอง
        ctx_a.set_offline(True)
        add(a, "expense", "60", "เดินทาง")
        a.wait_for_selector('#sync-status:has-text("รอส่ง 1")', timeout=5000)
        ctx_a.set_offline(False)
        a.evaluate("dispatchEvent(new Event('online'))")
        a.wait_for_selector('#sync-status:has-text("ซิงก์แล้ว")', timeout=5000)

        # ลบที่ A แล้ว B ต้องหาย
        a.once("dialog", lambda d: d.accept())
        a.click('.tx:has-text("เดินทาง")')
        a.click("#tx-delete")
        a.wait_for_timeout(500)
        sync(b)
        assert "เดินทาง" not in b.inner_text("#tx-list")
        assert b.inner_text("#sum-expense") == "1,720.5", b.inner_text("#sum-expense")

        # มุมมองตามหมวด
        b.click("#tab-cats")
        assert "น้ำ-ไฟ-เน็ต" in b.inner_text("#cat-list")
        assert "แม่" in b.inner_text("#member-list")

        # หนี้สิน: ย้ายรายการที่เป็นยอดหนี้ทั้งก้อนไปหนี้สิน แล้วผ่อนด้วยรายจ่ายที่ตัดยอดหนี้
        b.click("#tab-list")
        add(b, "expense", "1,000,000", "บ้าน/ค่าเช่า", "สินเชื่อบ้าน (จำลอง)")
        assert b.inner_text("#sum-expense") == "1,001,720.5", b.inner_text("#sum-expense")
        b.once("dialog", lambda d: d.accept())
        b.click('.tx:has-text("สินเชื่อบ้าน")')
        b.click("#tx-to-debt")
        b.wait_for_selector("#tx-dialog[open]", state="detached")
        assert b.inner_text("#sum-expense") == "1,720.5", b.inner_text("#sum-expense")
        assert b.inner_text("#sum-debt") == "1,000,000"
        b.click("#tab-debt")
        b.click("#btn-add-debt")
        b.fill("#d-name", "บัตรเครดิต (จำลอง)")
        b.fill("#d-principal", "20000")
        b.click("#debt-form button[type=submit]")
        b.wait_for_selector("#debt-dialog[open]", state="detached")
        assert b.inner_text("#debt-total") == "1,020,000", b.inner_text("#debt-total")
        b.click("#btn-add")
        b.click("#type-expense")
        b.fill("#f-amount", "5000")
        b.click('#f-cats .chip:text-is("ผ่อน/หนี้")')
        b.select_option("#f-debt", label="บัตรเครดิต (จำลอง) (เหลือ 20,000)")
        b.click("#tx-save")
        b.wait_for_selector("#tx-dialog[open]", state="detached")
        b.click("#tab-debt")
        assert b.inner_text("#debt-total") == "1,015,000", b.inner_text("#debt-total")
        assert "จ่ายแล้ว 5,000" in b.inner_text("#debt-list")
        sync(a)
        a.click("#tab-debt")
        assert a.inner_text("#debt-total") == "1,015,000", a.inner_text("#debt-total")
        assert a.inner_text("#sum-expense") == "6,720.5", a.inner_text("#sum-expense")
        b.click("#tab-list")

        # เปิดใหม่แบบออฟไลน์ยังเห็นข้อมูล
        a.reload()
        ctx_a.set_offline(True)
        a.reload()
        assert a.inner_text("#sum-expense") == "6,720.5"
        assert a.inner_text("#sum-debt") == "1,015,000"
        ctx_a.set_offline(False)

        # ส่งออก CSV
        b.click("#btn-settings")
        with b.expect_download() as d:
            b.click("#btn-export")
        csv = open(d.value.path(), encoding="utf-8-sig").read()
        assert "น้ำ-ไฟ-เน็ต" in csv and "บัตรเครดิต (จำลอง)" in csv and "15000.00" in csv, csv

        browser.close()
    assert not errors, errors
    print("ผ่านทั้งหมด")


if __name__ == "__main__":
    main()
