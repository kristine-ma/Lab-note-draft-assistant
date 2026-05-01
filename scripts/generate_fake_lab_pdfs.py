from pathlib import Path

from PIL import Image, ImageDraw, ImageFont
from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.pdfgen import canvas


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "test-assets"
OUT.mkdir(exist_ok=True)

TEXT_PDF = OUT / "fake-labs-text.pdf"
IMAGE_PNG = OUT / "fake-labs-scan.png"
IMAGE_PDF = OUT / "fake-labs-image-only.pdf"

LAB_ROWS = [
    ("CBC", "WBC", "7.2", "4.0-11.0", ""),
    ("CBC", "Hgb", "10.8", "12.0-16.0", "LOW"),
    ("CBC", "Platelets", "240", "150-400", ""),
    ("CMP", "Creatinine", "1.4", "0.6-1.1", "HIGH"),
    ("CMP", "eGFR", "48", ">60", "LOW"),
    ("CMP", "Sodium", "139", "135-145", ""),
    ("CMP", "Potassium", "4.6", "3.5-5.1", ""),
    ("Diabetes", "HbA1c", "8.2", "<7.0", "HIGH"),
    ("Lipids", "LDL", "142", "<100", "HIGH"),
    ("Thyroid", "TSH", "2.1", "0.4-4.5", ""),
]


def draw_text_pdf():
    pdf = canvas.Canvas(str(TEXT_PDF), pagesize=letter)
    width, height = letter
    y = height - 0.7 * inch

    pdf.setFont("Helvetica-Bold", 16)
    pdf.drawString(0.7 * inch, y, "Fake Laboratory Report")
    y -= 0.3 * inch

    pdf.setFont("Helvetica", 10)
    pdf.drawString(0.7 * inch, y, "Patient: Jane Sample    DOB: 1972-04-14    MRN: TEST-12345")
    y -= 0.22 * inch
    pdf.drawString(0.7 * inch, y, "Collection date: 2026-05-01    Status: Final")
    y -= 0.35 * inch

    draw_pdf_header(pdf, y)
    y -= 0.24 * inch

    for panel, test, value, ref_range, flag in LAB_ROWS:
        is_abnormal = bool(flag)
        pdf.setFont("Helvetica", 10)
        pdf.setFillColor(colors.black)
        pdf.drawString(0.75 * inch, y, panel)
        pdf.drawString(1.75 * inch, y, test)

        pdf.setFillColor(colors.firebrick if is_abnormal else colors.black)
        pdf.setFont("Helvetica-Bold" if is_abnormal else "Helvetica", 10)
        pdf.drawString(3.2 * inch, y, value)
        pdf.drawString(4.2 * inch, y, ref_range)
        pdf.drawString(5.3 * inch, y, flag)
        y -= 0.22 * inch

    y -= 0.25 * inch
    pdf.setFillColor(colors.black)
    pdf.setFont("Helvetica-Bold", 11)
    pdf.drawString(0.7 * inch, y, "Clinical context for testing:")
    y -= 0.22 * inch
    pdf.setFont("Helvetica", 10)
    pdf.drawString(0.7 * inch, y, "PMH includes T2DM, HTN, HLD, CKD3a, and iron deficiency anemia.")
    y -= 0.2 * inch
    pdf.drawString(0.7 * inch, y, "Current meds include metformin ER, empagliflozin, lisinopril, atorvastatin, and iron.")

    pdf.showPage()
    pdf.save()


def draw_pdf_header(pdf, y):
    pdf.setFont("Helvetica-Bold", 10)
    pdf.drawString(0.75 * inch, y, "Panel")
    pdf.drawString(1.75 * inch, y, "Test")
    pdf.drawString(3.2 * inch, y, "Result")
    pdf.drawString(4.2 * inch, y, "Reference")
    pdf.drawString(5.3 * inch, y, "Flag")


def draw_image_pdf():
    image = Image.new("RGB", (1600, 2100), "white")
    draw = ImageDraw.Draw(image)
    font = ImageFont.load_default()
    bold = ImageFont.load_default()

    y = 90
    draw.text((110, y), "Fake Laboratory Report", fill="#17202a", font=bold)
    y += 44
    draw.text((110, y), "Patient: Jane Sample    DOB: 1972-04-14    MRN: TEST-12345", fill="#17202a", font=font)
    y += 32
    draw.text((110, y), "Collection date: 2026-05-01    Status: Final", fill="#17202a", font=font)
    y += 56

    headers = ["Panel", "Test", "Result", "Reference", "Flag"]
    xs = [110, 360, 700, 930, 1160]
    for x, header in zip(xs, headers):
        draw.text((x, y), header, fill="#17202a", font=bold)
    y += 32
    draw.line((100, y, 1350, y), fill="#d7dde6", width=3)
    y += 18

    for panel, test, value, ref_range, flag in LAB_ROWS:
        color = "#b42318" if flag else "#17202a"
        draw.text((xs[0], y), panel, fill="#17202a", font=font)
        draw.text((xs[1], y), test, fill="#17202a", font=font)
        draw.text((xs[2], y), value, fill=color, font=bold if flag else font)
        draw.text((xs[3], y), ref_range, fill=color, font=bold if flag else font)
        draw.text((xs[4], y), flag, fill=color, font=bold if flag else font)
        y += 34

    y += 40
    draw.text((110, y), "Clinical context for testing:", fill="#17202a", font=bold)
    y += 34
    draw.text((110, y), "PMH includes T2DM, HTN, HLD, CKD3a, and iron deficiency anemia.", fill="#17202a", font=font)
    y += 34
    draw.text((110, y), "Current meds include metformin ER, empagliflozin, lisinopril, atorvastatin, and iron.", fill="#17202a", font=font)

    image.save(IMAGE_PNG)
    image.save(IMAGE_PDF, "PDF", resolution=150.0)


if __name__ == "__main__":
    draw_text_pdf()
    draw_image_pdf()
    print(TEXT_PDF)
    print(IMAGE_PDF)
    print(IMAGE_PNG)
