"""ทดสอบแอปมือถือครบขั้นตอนในเบราว์เซอร์ ด้วย PDF จำลองเท่านั้น (ห้ามใช้ไฟล์จริงในเทสต์นี้)

วิธีรัน (ในเครื่อง):
    pip install pymupdf playwright
    python -m http.server 8800 --bind 127.0.0.1      # รันที่โฟลเดอร์หลักของ repo
    python tests/e2e_test.py

สิ่งที่ตรวจ:
- ไฟล์สแกน / ไฟล์ข้อความ / รายงานแบบ HRAL61X (ข้อมูลจำลอง)
- ค่าแนะนำแผนกจาก PDF ที่มีข้อความ และไม่มีค่าแนะนำสำหรับไฟล์สแกน
- กำหนดแผนกแบบ "ตามหน้าก่อน" → ครบทุกหน้า ไม่ซ้ำ
- ปุ่มแชร์กดไม่ได้จนกว่าจะยืนยันกลุ่ม
- ไฟล์ที่ส่งเข้าเมนูแชร์ (จำลอง) มีข้อความ/ภาพทุกหน้าเหมือนต้นฉบับ
- ZIP เปิดได้ ครบทุกหน้า
- ไม่มีคำขอไปเว็บภายนอก และไม่มี error
- ใช้งานออฟไลน์ได้หลังเปิดครั้งแรก
"""
import base64
import hashlib
import io
import os
import sys
import tempfile
import zipfile
from pathlib import Path

import pymupdf
from playwright.sync_api import sync_playwright

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fake_pdf import make_report_pdf, report_pages, scanned_sample, text_sample  # noqa: E402

URL = os.environ.get("DEPTFLOW_URL", "http://127.0.0.1:8800/")
CHROMIUM = os.environ.get("CHROMIUM_PATH")  # ถ้าต้องการระบุเบราว์เซอร์เอง

MOCK_SHARE = """
window.__shared = [];
navigator.canShare = (d) => !!(d && d.files && d.files.length);
navigator.share = async (d) => {
  for (const f of d.files) {
    const b = new Uint8Array(await f.arrayBuffer());
    let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
    window.__shared.push({name: f.name, type: f.type, b64: btoa(s)});
  }
};
"""


def fingerprint(doc, page):
    h = hashlib.sha256(page.get_text("text").encode())
    for img in page.get_images(full=True):
        h.update(doc.extract_image(img[0])["image"])
    h.update(repr(tuple(round(v, 1) for v in page.rect)).encode())
    return h.hexdigest()


def run_case(browser, name, pdf_bytes, starts, expect_prefill):
    errors, external = [], []
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / f"{name}.pdf"
        path.write_bytes(pdf_bytes)
        ctx = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
        ctx.add_init_script(MOCK_SHARE)
        page = ctx.new_page()
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        page.on("request", lambda r: external.append(r.url) if not r.url.startswith((URL.rstrip("/"), "blob:", "data:")) else None)
        page.goto(URL)
        page.set_input_files("#file-input", str(path))
        page.wait_for_selector("#step-assign:not([hidden])", timeout=60000)
        total = page.locator(".page-row").count()
        prefill = [page.input_value(f'.dept-input[data-i="{i}"]') for i in range(total)]
        assert [p for p in prefill if p] == expect_prefill, (name, prefill)
        for pno, dept in starts.items():
            page.fill(f'.dept-input[data-i="{pno - 1}"]', dept)
        page.click("#btn-split")
        page.wait_for_selector("#step-result:not([hidden])", timeout=60000)
        coverage = page.inner_text("#coverage")
        assert coverage.startswith("✓"), coverage
        n = page.locator("#group-list article").count()
        for k in range(n):
            page.click(f'#group-list article[data-k="{k}"] .btn.teal')
            page.wait_for_selector("#share-dialog[open]")
            assert page.is_disabled("#share-go"), "ปุ่มแชร์ต้องกดไม่ได้ก่อนยืนยัน"
            page.check("#share-confirm")
            page.click("#share-go")
            page.wait_for_timeout(300)
        shared = page.locator("body").evaluate("() => window.__shared")
        ctx.close()

    src = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    out = []
    for s in shared:
        d = pymupdf.open(stream=base64.b64decode(s["b64"]), filetype="pdf")
        out += [fingerprint(d, pg) for pg in d]
    assert sorted(out) == sorted(fingerprint(src, pg) for pg in src), f"{name}: เนื้อหาไม่ตรงต้นฉบับ"
    assert not external, external
    assert not errors, errors
    print(f"✓ {name}: {total} หน้า {n} ไฟล์ {coverage}")


def run_zip_and_offline(browser):
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "scan.pdf"
        path.write_bytes(scanned_sample())
        ctx = browser.new_context(viewport={"width": 390, "height": 844})
        ctx.add_init_script(MOCK_SHARE + "Object.defineProperty(navigator,'userAgent',{get:()=>'iPhone'});")
        page = ctx.new_page()
        page.goto(URL)
        page.wait_for_timeout(2000)
        page.reload()
        ctx.set_offline(True)
        page.reload()
        page.set_input_files("#file-input", str(path))
        page.wait_for_selector("#step-assign:not([hidden])", timeout=60000)
        page.fill('.dept-input[data-i="0"]', "A")
        page.fill('.dept-input[data-i="2"]', "B")
        page.fill('.dept-input[data-i="4"]', "B")  # หน้า 5 เป็นกลุ่มใหม่จากภาพ ต้องใส่ชื่อด้วย
        page.click("#btn-split")
        page.wait_for_selector("#step-result:not([hidden])")
        page.click("#btn-zip")
        page.wait_for_selector("#share-dialog[open]")
        page.check("#share-confirm")
        page.click("#share-go")
        page.wait_for_timeout(500)
        shared = page.locator("body").evaluate("() => window.__shared")
        ctx.close()
    z = zipfile.ZipFile(io.BytesIO(base64.b64decode(shared[0]["b64"])))
    assert z.testzip() is None
    assert sorted(z.namelist()) == ["A.pdf", "B.pdf", "สรุป.txt"], z.namelist()
    pages = sum(pymupdf.open(stream=z.read(n), filetype="pdf").page_count for n in z.namelist() if n.endswith(".pdf"))
    assert pages == 5
    print("✓ ZIP + ใช้งานออฟไลน์")


def run_auto_group(browser):
    """จัดแผนกอัตโนมัติจากภาพ: รอบแรกตั้งชื่อกลุ่ม รอบสองแอปต้องจำได้เอง"""
    names = ["DRY-DryFood", "FSH-Produce", "FSH-Seafood"]
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "scan.pdf"
        path.write_bytes(scanned_sample())
        ctx = browser.new_context(viewport={"width": 390, "height": 844})
        ctx.add_init_script(MOCK_SHARE)
        page = ctx.new_page()
        page.goto(URL)

        page.set_input_files("#file-input", str(path))
        page.wait_for_selector("#step-assign:not([hidden])", timeout=60000)
        assert page.locator(".auto-row").count() == 3, "ต้องแยกได้ 3 กลุ่ม"
        assert "ระบุแล้ว 0/5" in page.inner_text("#assign-count"), "ข้อมูลจำลองต้องไม่ถูกเดาชื่อจากลายเส้นที่รู้จัก"
        for k, name in enumerate(names):
            page.fill(f'.auto-row[data-k="{k}"] .dept-input', name)
        assert "ระบุแล้ว 5/5" in page.inner_text("#assign-count")
        page.click("#btn-split")
        page.wait_for_selector("#step-result:not([hidden])")
        page.click("#btn-new")

        page.set_input_files("#file-input", str(path))
        page.wait_for_selector("#step-assign:not([hidden])", timeout=60000)
        got = [page.input_value(f'.auto-row[data-k="{k}"] .dept-input') for k in range(3)]
        assert got == names, got
        assert "ระบุแล้ว 5/5" in page.inner_text("#assign-count")
        ctx.close()
    print("✓ จัดแผนกอัตโนมัติ + จำชื่อได้ครั้งต่อไป")


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=CHROMIUM) if CHROMIUM else p.chromium.launch()
        run_case(browser, "scanned", scanned_sample(), {1: "DRY-DryFood", 3: "FSH-Produce", 5: "FSH-Seafood"}, [])
        run_case(browser, "report-text", make_report_pdf(report_pages()), {},
                 ["DRY-DryFood", "FSH-Produce", "FSH-Seafood"])
        data, _ = text_sample()
        run_case(browser, "text", data, {}, ["แผนกจำลอง ก", "แผนกจำลอง ข", "แผนกจำลอง ค"])
        run_auto_group(browser)
        run_zip_and_offline(browser)
        browser.close()
    print("ผ่านทั้งหมด")


if __name__ == "__main__":
    main()
