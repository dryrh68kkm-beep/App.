"""สร้าง PDF จำลองสำหรับทดสอบ ข้อมูลทั้งหมดเป็นข้อมูลปลอม ไม่มีข้อมูลพนักงานจริง

PDF ถูกสร้างในหน่วยความจำระหว่างทดสอบเท่านั้น ไม่บันทึกลงดิสก์
"""
from __future__ import annotations

import sys
from dataclasses import dataclass
from pathlib import Path

import pymupdf

FONT_CANDIDATES = [
    "/usr/share/fonts/opentype/tlwg/Loma.otf",
    "/usr/share/fonts/truetype/tlwg/Loma.ttf",
    "/usr/share/fonts/truetype/noto/NotoSansThai-Regular.ttf",
    r"C:\Windows\Fonts\tahoma.ttf",
    r"C:\Windows\Fonts\LeelawUI.ttf",
    "/System/Library/Fonts/Supplemental/Thonburi.ttc",
]


def thai_font() -> str:
    for f in FONT_CANDIDATES:
        if Path(f).exists():
            return f
    raise RuntimeError("ไม่พบฟอนต์ภาษาไทยสำหรับสร้าง PDF ทดสอบ")


@dataclass
class FakePage:
    employee_id: str | None = None
    name: str | None = None
    department: str | None = None
    body: str = "วันที่ 01  เข้า 08:00  ออก 17:00\nวันที่ 02  ขาดงาน\nวันที่ 03  ลาป่วย 1 วัน"
    blank: bool = False
    header_style: str = "inline"  # inline | table (ป้ายกับค่าแยกบรรทัด)


def make_pdf(pages: list[FakePage]) -> bytes:
    font = thai_font()
    doc = pymupdf.open()
    for spec in pages:
        page = doc.new_page(width=595, height=842)  # A4
        if spec.blank:
            continue
        page.insert_font(fontname="th", fontfile=font)

        def put(x: float, y: float, text: str, size: float = 12) -> None:
            page.insert_text((x, y), text, fontname="th", fontsize=size)

        put(40, 50, "รายงานเวลาทำงานประจำเดือน (ข้อมูลจำลอง)", 14)
        if spec.header_style == "table":
            if spec.employee_id:
                put(40, 90, "รหัสพนักงาน")
                put(40, 106, spec.employee_id)
            if spec.name:
                put(220, 90, "ชื่อ-สกุล:")
                put(220, 106, spec.name)
            if spec.department:
                put(40, 140, "หน่วยงาน")
                put(40, 156, spec.department)
        else:
            parts = []
            if spec.employee_id:
                parts.append(f"รหัสพนักงาน: {spec.employee_id}")
            if spec.name:
                parts.append(f"ชื่อ-สกุล: {spec.name}")
            if parts:
                put(40, 95, "     ".join(parts))
            if spec.department:
                put(40, 120, f"หน่วยงาน: {spec.department}")
        # เนื้อหาเวลาทำงาน อยู่ต่ำกว่าส่วนหัว (เกิน 30% ของความสูงหน้า)
        y = 320
        for line in spec.body.splitlines():
            put(40, y, line, 11)
            y += 18
        # คำว่า "หน่วยงาน" ในเนื้อหา ต้องไม่ถูกอ่านเป็นหัวเอกสาร
        put(40, y + 30, "หมายเหตุ: หน่วยงาน อื่นๆ ไม่ใช่ส่วนหัว", 10)
    data = doc.tobytes()
    doc.close()
    return data


def text_sample() -> tuple[bytes, list[str | None]]:
    """PDF ข้อความจำลอง 6 หน้า พร้อมแผนกที่ควรเติมให้แต่ละหน้า"""
    pages = [
        FakePage("T0001", "ทดสอบ หนึ่ง", "แผนกจำลอง ก"),
        FakePage("T0002", "ทดสอบ สอง", "แผนกจำลอง ก"),
        FakePage("T0003", "ทดสอบ สาม", "แผนกจำลอง ข", header_style="table"),
        FakePage(body="วันที่ 20  เข้า 08:00  ออก 17:00"),  # หน้าต่อเนื่อง ไม่มีหัวเอกสาร
        FakePage(blank=True),
        FakePage("T0004", "ทดสอบ สี่", "แผนกจำลอง ค"),
    ]
    return make_pdf(pages), ["แผนกจำลอง ก", "แผนกจำลอง ก", "แผนกจำลอง ข", None, None, "แผนกจำลอง ค"]


# ---------------------------------------------------------------- รายงานแบบสแกน

@dataclass
class FakeReport:
    """หน้ารายงานเวลาทำงานแบบ HRAL61X (ข้อมูลปลอม) รหัสพนักงานปลอมขึ้นต้นด้วย 99"""
    employee_id: str | None
    department: str | None  # เช่น "DEMO01:FSH-Produce"
    unit_code: str | None  # เช่น "010-200-999-020-030-000-000"
    name: str = "นายทดสอบ สมมติ"
    page_no: int = 1


def make_report_pdf(pages: list[FakeReport]) -> bytes:
    font = thai_font()
    doc = pymupdf.open()
    for spec in pages:
        page = doc.new_page(width=595, height=842)
        page.insert_font(fontname="th", fontfile=font)

        def th(x, y, text, size=10):
            page.insert_text((x, y), text, fontname="th", fontsize=size)

        def en(x, y, text, size=9):
            page.insert_text((x, y), text, fontname="helv", fontsize=size)

        # ตำแหน่งเดียวกับรายงานจริง (ช่องชื่อหน่วยงานอยู่ใน DEPT_BOX ของ config.js)
        th(330, 22, "บริษัท ตัวอย่าง จำกัด (ข้อมูลจำลอง)", 11)
        th(100, 44, "ข้อมูลการมาปฏิบัติงานของพนักงาน", 11)
        th(70, 60, "รหัสพนักงาน", 9)
        if spec.employee_id:
            en(160, 60, f": {spec.employee_id}", 8)
            th(215, 60, spec.name, 9)
        th(70, 79, "รหัสหน่วยงาน", 9)
        if spec.unit_code:
            en(160, 79, f": {spec.unit_code}", 8)
        th(290, 79, "ชื่อหน่วยงาน", 9)
        if spec.department:
            en(362, 79, f": {spec.department}", 8)
        th(70, 97, "กลุ่มการจ่ายเงินเดือน", 9)
        en(160, 97, ": D", 8)
        th(290, 97, "ระหว่างวันที่", 9)
        en(362, 97, ": 16/08/2569 - 15/09/2569", 8)
        th(540, 110, "หน้า", 8)
        en(565, 110, str(spec.page_no), 8)
        y = 170
        for d in range(1, 26):
            en(40, y, f"{d:02d}/08/2569   W   8R   14:30   21:30   14:2{d % 10}   21:3{d % 10}")
            y += 20
    data = doc.tobytes()
    doc.close()
    return data


def rasterize(pdf_bytes: bytes, dpi: int = 145) -> bytes:
    """แปลงทุกหน้าเป็นภาพ เหมือนไฟล์สแกน (ไม่มีข้อความให้อ่าน)"""
    src = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    out = pymupdf.open()
    for page in src:
        pix = page.get_pixmap(dpi=dpi)
        new = out.new_page(width=page.rect.width, height=page.rect.height)
        new.insert_image(new.rect, pixmap=pix)
    data = out.tobytes(deflate=True)
    src.close()
    out.close()
    return data


def report_pages() -> list[FakeReport]:
    """รายงานจำลอง 5 หน้า 3 แผนก (รหัสพนักงานปลอมขึ้นต้นด้วย 99)"""
    code = "010-200-999-{}-000-000"
    return [
        FakeReport("9900001", "DEMO01:DRY-Dry Food", code.format("010-100"), page_no=2),
        FakeReport("9900002", "DEMO01:DRY-Dry Food", code.format("010-100"), page_no=3),
        FakeReport("9900003", "DEMO01:FSH-Produce", code.format("020-030"), page_no=5),
        FakeReport("9900004", "DEMO01:FSH-Produce", code.format("020-030"), page_no=6),
        FakeReport("9900005", "DEMO01:FSH-Seafood", code.format("020-020"), page_no=9),
    ]


def scanned_sample() -> bytes:
    """รายงานจำลองแบบสแกน (เป็นภาพล้วน ไม่มีข้อความ)"""
    return rasterize(make_report_pdf(report_pages()))


if __name__ == "__main__":
    # สำหรับลองเปิดโปรแกรมด้วยข้อมูลจำลอง: python tests/fake_pdf.py ตัวอย่างจำลอง.pdf
    out = Path(sys.argv[1] if len(sys.argv) > 1 else "ตัวอย่างจำลอง.pdf")
    kind = sys.argv[2] if len(sys.argv) > 2 else "text"
    out.write_bytes(scanned_sample() if kind == "scan" else text_sample()[0])
    print(f"สร้างไฟล์จำลอง {out} แล้ว (ข้อมูลปลอมทั้งหมด)")
