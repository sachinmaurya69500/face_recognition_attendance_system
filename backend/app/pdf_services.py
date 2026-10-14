"""
PRATYAKSH ACADEMIC FACIAL ATTENDANCE SYSTEM
PDF Report Generation Services

Provides modular, robust PDF generation for:
1. Option A: Course-Wise Student Face PDF (Face Grid Layout)
2. Option B: Complete Student Details PDF (Detailed Table with Photos)
3. Option C: Student Text-Only Report (Compact Text Table, No Biometrics)
"""

from __future__ import annotations

import io
import re
from datetime import datetime
from typing import Any

from PIL import Image, ImageDraw, ImageFont, ImageOps
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas
from reportlab.platypus import (
    HRFlowable,
    Image as PdfImage,
    KeepTogether,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)


# -----------------------------------------------------------------------------
# TWO-PASS NUMBERED CANVAS (Running header & page numbers: "Page X of Y")
# -----------------------------------------------------------------------------
class NumberedCanvas(canvas.Canvas):
    """Two-pass canvas that accumulates page count and renders running headers/footers."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._saved_page_states: list[dict[str, Any]] = []

    def showPage(self):
        self._saved_page_states.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        num_pages = len(self._saved_page_states)
        for state in self._saved_page_states:
            self.__dict__.update(state)
            self.draw_page_decorations(num_pages)
            super().showPage()
        super().save()

    def draw_page_decorations(self, page_count: int):
        self.saveState()
        self.setFont("Helvetica", 7.5)
        self.setFillColor(colors.HexColor("#64748B"))

        page_w, page_h = A4
        margin_x = 12 * mm
        margin_bottom = 8 * mm

        # Running Footer
        footer_text = f"Page {self._pageNumber} of {page_count}"
        self.drawRightString(page_w - margin_x, margin_bottom, footer_text)
        self.drawString(
            margin_x,
            margin_bottom,
            "Pratyaksh Academic Facial Attendance Management System • Official Session Record",
        )

        # Thin footer rule
        self.setStrokeColor(colors.HexColor("#E2E8F0"))
        self.setLineWidth(0.5)
        self.line(margin_x, margin_bottom + 3 * mm, page_w - margin_x, margin_bottom + 3 * mm)

        self.restoreState()


# -----------------------------------------------------------------------------
# IMAGE UTILITIES: THUMBNAILS & NEUTRAL PLACEHOLDER
# -----------------------------------------------------------------------------
def _generate_placeholder_image(width_px: int = 120, height_px: int = 120, label: str = "NO PHOTO") -> bytes:
    """Generate a clean neutral placeholder thumbnail image."""
    img = Image.new("RGB", (width_px, height_px), color="#F1F5F9")
    draw = ImageDraw.Draw(img)

    # Rounded border
    draw.rectangle([1, 1, width_px - 2, height_px - 2], outline="#CBD5E1", width=1)

    # Stylized head & shoulders avatar silhouette
    cx = width_px // 2
    head_r = int(width_px * 0.2)
    head_cy = int(height_px * 0.38)
    draw.ellipse([cx - head_r, head_cy - head_r, cx + head_r, head_cy + head_r], fill="#94A3B8")

    body_top = head_cy + head_r + 4
    draw.pieslice([cx - head_r * 2, body_top, cx + head_r * 2, body_top + head_r * 3], 180, 360, fill="#94A3B8")

    # Label text at bottom
    try:
        font = ImageFont.load_default()
        bbox = draw.textbbox((0, 0), label, font=font)
        tw = bbox[2] - bbox[0]
        draw.text((cx - tw // 2, height_px - 14), label, fill="#64748B", font=font)
    except Exception:
        pass

    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=85)
    return buf.getvalue()


_PLACEHOLDER_BYTES = _generate_placeholder_image(120, 140, "NO PHOTO")
_SMALL_PLACEHOLDER_BYTES = _generate_placeholder_image(70, 70, "NO PHOTO")


def _prepare_student_photo_pdf_image(
    photo_bytes: bytes | memoryview | None,
    width_mm: float,
    height_mm: float,
    is_small: bool = False,
) -> PdfImage:
    """Safely prepare a student photograph or neutral placeholder with preserved aspect ratio."""
    raw_data: bytes | None = None
    if photo_bytes:
        try:
            raw_data = bytes(photo_bytes)
        except Exception:
            raw_data = None

    if raw_data:
        try:
            with Image.open(io.BytesIO(raw_data)) as orig:
                rgb_img = ImageOps.exif_transpose(orig).convert("RGB")
                target_w_px = int(width_mm * 5.0)  # ~125-150 dpi
                target_h_px = int(height_mm * 5.0)
                rgb_img.thumbnail((target_w_px, target_h_px), Image.Resampling.LANCZOS)
                buf = io.BytesIO()
                rgb_img.save(buf, format="JPEG", quality=85, optimize=True)
                buf.seek(0)
                return PdfImage(buf, width=width_mm * mm, height=height_mm * mm)
        except Exception:
            pass

    # Fallback to placeholder
    buf = io.BytesIO(_SMALL_PLACEHOLDER_BYTES if is_small else _PLACEHOLDER_BYTES)
    return PdfImage(buf, width=width_mm * mm, height=height_mm * mm)


def _sanitize_filename(name: str) -> str:
    """Create a safe, clean filesystem filename without special characters."""
    clean = re.sub(r"[^\w\-_\.]", "_", name.strip())
    return re.sub(r"_+", "_", clean)


# -----------------------------------------------------------------------------
# REPORTLAB STYLES
# -----------------------------------------------------------------------------
def _get_report_styles() -> dict[str, ParagraphStyle]:
    sample = getSampleStyleSheet()

    title_style = ParagraphStyle(
        "ReportTitle",
        parent=sample["Normal"],
        fontName="Helvetica-Bold",
        fontSize=15,
        leading=18,
        textColor=colors.HexColor("#0F172A"),
    )

    subtitle_style = ParagraphStyle(
        "ReportSubtitle",
        parent=sample["Normal"],
        fontName="Helvetica-Bold",
        fontSize=10.5,
        leading=13,
        textColor=colors.HexColor("#163A5F"),
    )

    meta_style = ParagraphStyle(
        "ReportMeta",
        parent=sample["Normal"],
        fontName="Helvetica",
        fontSize=8,
        leading=11,
        textColor=colors.HexColor("#475569"),
    )

    badge_style = ParagraphStyle(
        "SummaryBadge",
        parent=sample["Normal"],
        fontName="Helvetica-Bold",
        fontSize=8,
        leading=10,
        textColor=colors.HexColor("#0F172A"),
    )

    tbl_header_style = ParagraphStyle(
        "TblHeader",
        parent=sample["Normal"],
        fontName="Helvetica-Bold",
        fontSize=8,
        leading=10,
        textColor=colors.white,
        alignment=1,  # Center
    )

    tbl_cell_style = ParagraphStyle(
        "TblCell",
        parent=sample["Normal"],
        fontName="Helvetica",
        fontSize=7.5,
        leading=9.5,
        textColor=colors.HexColor("#1E293B"),
    )

    tbl_cell_bold = ParagraphStyle(
        "TblCellBold",
        parent=tbl_cell_style,
        fontName="Helvetica-Bold",
    )

    tbl_cell_center = ParagraphStyle(
        "TblCellCenter",
        parent=tbl_cell_style,
        alignment=1,
    )

    face_name_style = ParagraphStyle(
        "FaceCardName",
        parent=sample["Normal"],
        fontName="Helvetica-Bold",
        fontSize=7.5,
        leading=9,
        textColor=colors.HexColor("#0F172A"),
        alignment=1,
    )

    face_sub_style = ParagraphStyle(
        "FaceCardSub",
        parent=sample["Normal"],
        fontName="Helvetica",
        fontSize=6.5,
        leading=8,
        textColor=colors.HexColor("#64748B"),
        alignment=1,
    )

    hierarchy_text_style = ParagraphStyle(
        "HierarchySectionText",
        parent=sample["Normal"],
        fontName="Helvetica",
        fontSize=7.5,
        leading=10.5,
        textColor=colors.HexColor("#1E293B"),
        keepWithNext=True,
    )

    return {
        "title": title_style,
        "subtitle": subtitle_style,
        "meta": meta_style,
        "badge": badge_style,
        "tbl_header": tbl_header_style,
        "tbl_cell": tbl_cell_style,
        "tbl_cell_bold": tbl_cell_bold,
        "tbl_cell_center": tbl_cell_center,
        "face_name": face_name_style,
        "face_sub": face_sub_style,
        "hierarchy_text": hierarchy_text_style,
    }


def group_students_hierarchically(
    students: list[dict[str, Any]]
) -> dict[str, dict[str, dict[str, dict[str, dict[str, list[dict[str, Any]]]]]]]:
    """
    Group students into the required academic hierarchy:
    University
      └── School
           └── Faculty
                └── Department
                     └── Course (Program)
                          └── Semester
                               └── Student Records
    """
    hierarchy: dict[str, dict[str, dict[str, dict[str, dict[str, list[dict[str, Any]]]]]]] = {}

    for st in students:
        school = (st.get("school") or "School Not Specified").strip()
        faculty = (st.get("faculty") or "Faculty Not Specified").strip()
        dept = (st.get("department") or "Department Not Specified").strip()
        course = (st.get("program") or "Course Not Specified").strip()
        sem = (st.get("semester") or "Semester Not Specified").strip()

        if school not in hierarchy:
            hierarchy[school] = {}
        if faculty not in hierarchy[school]:
            hierarchy[school][faculty] = {}
        if dept not in hierarchy[school][faculty]:
            hierarchy[school][faculty][dept] = {}
        if course not in hierarchy[school][faculty][dept]:
            hierarchy[school][faculty][dept][course] = {}
        if sem not in hierarchy[school][faculty][dept][course]:
            hierarchy[school][faculty][dept][course][sem] = []

        hierarchy[school][faculty][dept][course][sem].append(st)

    # Sort each level deterministically
    sorted_hierarchy = {}
    for school in sorted(hierarchy.keys()):
        sorted_hierarchy[school] = {}
        for faculty in sorted(hierarchy[school].keys()):
            sorted_hierarchy[school][faculty] = {}
            for dept in sorted(hierarchy[school][faculty].keys()):
                sorted_hierarchy[school][faculty][dept] = {}
                for course in sorted(hierarchy[school][faculty][dept].keys()):
                    sorted_hierarchy[school][faculty][dept][course] = {}
                    for sem in sorted(hierarchy[school][faculty][dept][course].keys()):
                        sem_students = sorted(
                            hierarchy[school][faculty][dept][course][sem],
                            key=lambda s: (str(s.get("name") or "").lower(), str(s.get("student_id") or "")),
                        )
                        sorted_hierarchy[school][faculty][dept][course][sem] = sem_students

    return sorted_hierarchy


def _build_hierarchy_section_header(
    school: str,
    faculty: str,
    dept: str,
    course: str,
    semester: str,
    sem_students: list[dict[str, Any]],
    styles: dict[str, ParagraphStyle],
) -> Table:
    """Build a distinct, elegant hierarchy section header reflecting University -> School -> Faculty -> Department -> Course -> Semester."""
    sem_total = len(sem_students)
    sem_present = sum(1 for s in sem_students if str(s.get("status", "")).upper() == "PRESENT")
    sem_absent = sem_total - sem_present
    sem_rate = round((sem_present / sem_total * 100), 1) if sem_total > 0 else 0.0

    lines = [
        f"<b>School:</b> {school}",
        f"&nbsp;&nbsp;&nbsp;&nbsp;<b>Faculty:</b> {faculty}",
        f"&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<b>Department:</b> {dept}",
        f"&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<b>Course:</b> {course}",
        f"&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<b>Semester:</b> {semester} &nbsp;&nbsp;&nbsp;&nbsp;"
        f"[ <font color='#059669'><b>Present: {sem_present}</b></font> &nbsp;|&nbsp; "
        f"<font color='#DC2626'><b>Absent: {sem_absent}</b></font> &nbsp;|&nbsp; "
        f"<b>Total: {sem_total}</b> ({sem_rate}%) ]",
        f"&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<i>Student Attendance Records:</i>",
    ]
    content = "<br/>".join(lines)
    p = Paragraph(content, styles["hierarchy_text"])

    t = Table([[p]], colWidths=[186 * mm])
    t.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#F1F5F9")),
                ("BOX", (0, 0), (-1, -1), 0.75, colors.HexColor("#CBD5E1")),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ]
        )
    )
    return t


def _build_summary_banner_table(
    summary: dict[str, int],
    records_count: int,
    styles: dict[str, ParagraphStyle],
) -> Table:
    """Build a compact, clean KPI summary block for report headers."""
    total_eligible = summary.get("total_students", 0)
    present_cnt = summary.get("present_students", 0)
    absent_cnt = summary.get("absent_students", 0)

    ratio = round((present_cnt / total_eligible * 100), 1) if total_eligible > 0 else 0.0

    cells = [
        [
            Paragraph(f"<b>Total Eligible:</b> {total_eligible}", styles["badge"]),
            Paragraph(f"<font color='#059669'><b>Present:</b> {present_cnt}</font>", styles["badge"]),
            Paragraph(f"<font color='#DC2626'><b>Absent:</b> {absent_cnt}</font>", styles["badge"]),
            Paragraph(f"<b>Attendance Rate:</b> {ratio}%", styles["badge"]),
            Paragraph(f"<b>Records in Report:</b> {records_count}", styles["badge"]),
        ]
    ]

    t = Table(cells, colWidths=[36 * mm, 34 * mm, 34 * mm, 38 * mm, 44 * mm], hAlign="LEFT")
    t.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#F8FAFC")),
                ("BOX", (0, 0), (-1, -1), 0.75, colors.HexColor("#CBD5E1")),
                ("INNERGRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#E2E8F0")),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("ALIGN", (0, 0), (-1, -1), "CENTER"),
                ("TOPPADDING", (0, 0), (-1, -1), 3),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
            ]
        )
    )
    return t


# -----------------------------------------------------------------------------
# OPTION A: COURSE-WISE STUDENT FACE PDF (GRID OF FACES)
# -----------------------------------------------------------------------------
def generate_course_wise_face_pdf(
    session: dict[str, Any],
    students: list[dict[str, Any]],
    summary: dict[str, int],
    course_filter: str | None = None,
    status_filter: str = "both",
) -> bytes:
    """Generate Course-Wise Student Face PDF arranged in an aspect-preserved grid."""
    output = io.BytesIO()
    doc = SimpleDocTemplate(
        output,
        pagesize=A4,
        leftMargin=12 * mm,
        rightMargin=12 * mm,
        topMargin=12 * mm,
        bottomMargin=14 * mm,
        title=f"Face Attendance - {session.get('session_id')}",
        author="Pratyaksh Academic Attendance",
    )

    styles = _get_report_styles()
    story: list[Any] = []

    # Header section
    session_title = session.get("title") or "Attendance Session"
    session_course = course_filter if (course_filter and course_filter.lower() != "all") else session.get("course") or "All Courses / Groups"
    event_date = str(session.get("event_date") or "")
    starts_at = str(session.get("starts_at") or "")[:5]
    ends_at = str(session.get("ends_at") or "")[:5]
    room = session.get("room") or "—"
    now_str = datetime.now().strftime("%Y-%m-%d %H:%M")

    filter_label = status_filter.upper()
    if filter_label == "BOTH":
        filter_label = "Both (Present & Absent)"

    story.append(Paragraph("Course-Wise Student Face Attendance PDF", styles["title"]))
    story.append(Spacer(1, 1.5 * mm))
    story.append(
        Paragraph(
            f"<b>{session_title}</b> &nbsp;|&nbsp; <b>Course/Group:</b> {session_course}",
            styles["subtitle"],
        )
    )
    story.append(
        Paragraph(
            f"<b>Session ID:</b> {session.get('session_id')} &nbsp;|&nbsp; <b>Date:</b> {event_date} "
            f"({starts_at} - {ends_at}) &nbsp;|&nbsp; <b>Room:</b> {room} &nbsp;|&nbsp; "
            f"<b>Filter:</b> {filter_label} &nbsp;|&nbsp; <b>Generated:</b> {now_str}",
            styles["meta"],
        )
    )
    story.append(Spacer(1, 3 * mm))

    # Summary KPI banner
    story.append(_build_summary_banner_table(summary, len(students), styles))
    story.append(Spacer(1, 5 * mm))

    if not students:
        story.append(
            Paragraph(
                "<i>No students matched the selected course and attendance filter criteria.</i>",
                styles["meta"],
            )
        )
        doc.build(story, canvasmaker=NumberedCanvas)
        return output.getvalue()

    # Build 4-column Face Cards Grid for each semester in the academic hierarchy
    hierarchy = group_students_hierarchically(students)

    COLS = 4
    col_width = 46.5 * mm
    photo_w = 32.0  # mm
    photo_h = 36.0  # mm

    for school, faculties in hierarchy.items():
        for faculty, depts in faculties.items():
            for dept, courses in depts.items():
                for course, semesters in courses.items():
                    for sem, sem_students in semesters.items():
                        hdr = _build_hierarchy_section_header(
                            school, faculty, dept, course, sem, sem_students, styles
                        )
                        story.append(hdr)
                        story.append(Spacer(1, 2.5 * mm))

                        if not sem_students:
                            story.append(
                                Paragraph(
                                    "<i>No student face records for this semester under the active filter.</i>",
                                    styles["meta"],
                                )
                            )
                            story.append(Spacer(1, 3 * mm))
                            continue

                        grid_rows: list[list[Any]] = []
                        current_row: list[Any] = []

                        for st in sem_students:
                            scholar_no = st.get("roll_number") or st.get("student_id") or "—"
                            name = st.get("name") or "Unknown Student"
                            status = str(st.get("status") or "ABSENT").upper()
                            is_present = status == "PRESENT"
                            status_color = "#059669" if is_present else "#DC2626"

                            pdf_img = _prepare_student_photo_pdf_image(st.get("profile_photo"), photo_w, photo_h, is_small=False)

                            card_elements = [
                                Spacer(1, 1 * mm),
                                pdf_img,
                                Spacer(1, 1.5 * mm),
                                Paragraph(name, styles["face_name"]),
                                Paragraph(f"Scholar No: <b>{scholar_no}</b>", styles["face_sub"]),
                                Paragraph(
                                    f"<font color='{status_color}'><b>[{status}]</b></font>",
                                    styles["face_sub"],
                                ),
                                Spacer(1, 1.5 * mm),
                            ]

                            card_table = Table([[elem] for elem in card_elements], colWidths=[col_width - 2 * mm])
                            border_color = colors.HexColor("#10B981") if is_present else colors.HexColor("#CBD5E1")
                            card_table.setStyle(
                                TableStyle(
                                    [
                                        ("BOX", (0, 0), (-1, -1), 0.75, border_color),
                                        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#FFFFFF")),
                                        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
                                        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                                        ("TOPPADDING", (0, 0), (-1, -1), 2),
                                        ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
                                    ]
                                )
                            )

                            current_row.append(card_table)
                            if len(current_row) == COLS:
                                grid_rows.append(current_row)
                                current_row = []

                        # Pad final row if not complete
                        if current_row:
                            while len(current_row) < COLS:
                                current_row.append("")
                            grid_rows.append(current_row)

                        main_grid = Table(grid_rows, colWidths=[col_width] * COLS, repeatRows=0)
                        main_grid.setStyle(
                            TableStyle(
                                [
                                    ("ALIGN", (0, 0), (-1, -1), "CENTER"),
                                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                                    ("LEFTPADDING", (0, 0), (-1, -1), 1),
                                    ("RIGHTPADDING", (0, 0), (-1, -1), 1),
                                    ("TOPPADDING", (0, 0), (-1, -1), 3),
                                    ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
                                ]
                            )
                        )
                        story.append(main_grid)
                        story.append(Spacer(1, 4 * mm))

    doc.build(story, canvasmaker=NumberedCanvas)
    return output.getvalue()


# -----------------------------------------------------------------------------
# OPTION B: COMPLETE STUDENT DETAILS PDF (TABLE WITH PHOTOS)
# -----------------------------------------------------------------------------
def generate_complete_student_details_pdf(
    session: dict[str, Any],
    students: list[dict[str, Any]],
    summary: dict[str, int],
    course_filter: str | None = None,
    status_filter: str = "both",
) -> bytes:
    """Generate Complete Student Details PDF with Photo, Scholar No., Name, Mobile, and Status."""
    output = io.BytesIO()
    doc = SimpleDocTemplate(
        output,
        pagesize=A4,
        leftMargin=12 * mm,
        rightMargin=12 * mm,
        topMargin=12 * mm,
        bottomMargin=14 * mm,
        title=f"Detailed Attendance - {session.get('session_id')}",
        author="Pratyaksh Academic Attendance",
    )

    styles = _get_report_styles()
    story: list[Any] = []

    # Header info
    session_title = session.get("title") or "Attendance Session"
    session_course = course_filter if (course_filter and course_filter.lower() != "all") else session.get("course") or "All Courses / Groups"
    event_date = str(session.get("event_date") or "")
    starts_at = str(session.get("starts_at") or "")[:5]
    ends_at = str(session.get("ends_at") or "")[:5]
    room = session.get("room") or "—"
    now_str = datetime.now().strftime("%Y-%m-%d %H:%M")

    filter_label = status_filter.upper()
    if filter_label == "BOTH":
        filter_label = "Both (Present & Absent)"

    story.append(Paragraph("Complete Student Details Attendance Report", styles["title"]))
    story.append(Spacer(1, 1.5 * mm))
    story.append(
        Paragraph(
            f"<b>{session_title}</b> &nbsp;|&nbsp; <b>Course / Group:</b> {session_course}",
            styles["subtitle"],
        )
    )
    story.append(
        Paragraph(
            f"<b>Session ID:</b> {session.get('session_id')} &nbsp;|&nbsp; <b>Date:</b> {event_date} "
            f"({starts_at} - {ends_at}) &nbsp;|&nbsp; <b>Room:</b> {room} &nbsp;|&nbsp; "
            f"<b>Filter:</b> {filter_label} &nbsp;|&nbsp; <b>Generated:</b> {now_str}",
            styles["meta"],
        )
    )
    story.append(Spacer(1, 3 * mm))

    # Summary KPI banner
    story.append(_build_summary_banner_table(summary, len(students), styles))
    story.append(Spacer(1, 4 * mm))

    if not students:
        story.append(
            Paragraph(
                "<i>No students matched the selected course and attendance filter criteria.</i>",
                styles["meta"],
            )
        )
        doc.build(story, canvasmaker=NumberedCanvas)
        return output.getvalue()

    # Required table columns:
    # Photo | Scholar No. | Student Name | Mobile No. | Attendance Status
    # Total width = 186mm
    # Widths: Photo (20mm), Scholar No. (30mm), Student Name (66mm), Mobile No. (38mm), Status (32mm)
    col_widths = [20 * mm, 30 * mm, 66 * mm, 38 * mm, 32 * mm]
    hierarchy = group_students_hierarchically(students)

    for school, faculties in hierarchy.items():
        for faculty, depts in faculties.items():
            for dept, courses in depts.items():
                for course, semesters in courses.items():
                    for sem, sem_students in semesters.items():
                        hdr = _build_hierarchy_section_header(
                            school, faculty, dept, course, sem, sem_students, styles
                        )
                        story.append(hdr)
                        story.append(Spacer(1, 2.5 * mm))

                        if not sem_students:
                            story.append(
                                Paragraph(
                                    "<i>No student records for this semester under the active filter.</i>",
                                    styles["meta"],
                                )
                            )
                            story.append(Spacer(1, 3 * mm))
                            continue

                        table_data = [
                            [
                                Paragraph("Photo", styles["tbl_header"]),
                                Paragraph("Scholar No.", styles["tbl_header"]),
                                Paragraph("Student Name", styles["tbl_header"]),
                                Paragraph("Mobile No.", styles["tbl_header"]),
                                Paragraph("Attendance Status", styles["tbl_header"]),
                            ]
                        ]

                        for st in sem_students:
                            scholar_no = st.get("roll_number") or st.get("student_id") or "—"
                            name = st.get("name") or "Unknown"
                            mobile = st.get("phone") or "Not available"
                            status = str(st.get("status") or "ABSENT").upper()
                            is_present = status == "PRESENT"
                            status_color = "#059669" if is_present else "#DC2626"

                            pdf_thumb = _prepare_student_photo_pdf_image(st.get("profile_photo"), 15.0, 15.0, is_small=True)

                            status_text = f"<font color='{status_color}'><b>{status}</b></font>"
                            if st.get("is_manual_override"):
                                status_text += "<br/><font color='#64748B' size='6'>(Manual)</font>"

                            sub_info = ""
                            prog = st.get("program")
                            sem_info = st.get("semester")
                            if prog or sem_info:
                                sub_info = f"<br/><font color='#64748B' size='6'>{prog or ''} {sem_info or ''}</font>"

                            table_data.append(
                                [
                                    pdf_thumb,
                                    Paragraph(f"<b>{scholar_no}</b>", styles["tbl_cell_center"]),
                                    Paragraph(f"<b>{name}</b>{sub_info}", styles["tbl_cell"]),
                                    Paragraph(mobile, styles["tbl_cell_center"]),
                                    Paragraph(status_text, styles["tbl_cell_center"]),
                                ]
                            )

                        t = Table(table_data, colWidths=col_widths, repeatRows=1, hAlign="LEFT")
                        t.setStyle(
                            TableStyle(
                                [
                                    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#163A5F")),
                                    ("ALIGN", (0, 0), (-1, 0), "CENTER"),
                                    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                                    ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#CBD5E1")),
                                    ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F8FAFC")]),
                                    ("TOPPADDING", (0, 0), (-1, -1), 3),
                                    ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
                                ]
                            )
                        )
                        story.append(t)
                        story.append(Spacer(1, 4 * mm))

    doc.build(story, canvasmaker=NumberedCanvas)
    return output.getvalue()


# -----------------------------------------------------------------------------
# OPTION C: STUDENT TEXT-ONLY REPORT (NO BIOMETRICS/PHOTOS)
# -----------------------------------------------------------------------------
def generate_student_text_only_pdf(
    session: dict[str, Any],
    students: list[dict[str, Any]],
    summary: dict[str, int],
    course_filter: str | None = None,
    status_filter: str = "both",
) -> bytes:
    """Generate Student Text-Only Report with Scholar No., Name, Mobile, and Status (NO PHOTOS)."""
    output = io.BytesIO()
    doc = SimpleDocTemplate(
        output,
        pagesize=A4,
        leftMargin=12 * mm,
        rightMargin=12 * mm,
        topMargin=12 * mm,
        bottomMargin=14 * mm,
        title=f"Text Attendance - {session.get('session_id')}",
        author="Pratyaksh Academic Attendance",
    )

    styles = _get_report_styles()
    story: list[Any] = []

    # Header info
    session_title = session.get("title") or "Attendance Session"
    session_course = course_filter if (course_filter and course_filter.lower() != "all") else session.get("course") or "All Courses / Groups"
    event_date = str(session.get("event_date") or "")
    starts_at = str(session.get("starts_at") or "")[:5]
    ends_at = str(session.get("ends_at") or "")[:5]
    room = session.get("room") or "—"
    now_str = datetime.now().strftime("%Y-%m-%d %H:%M")

    filter_label = status_filter.upper()
    if filter_label == "BOTH":
        filter_label = "Both (Present & Absent)"

    story.append(Paragraph("Student Text-Only Attendance Report", styles["title"]))
    story.append(Spacer(1, 1.5 * mm))
    story.append(
        Paragraph(
            f"<b>{session_title}</b> &nbsp;|&nbsp; <b>Course / Group:</b> {session_course}",
            styles["subtitle"],
        )
    )
    story.append(
        Paragraph(
            f"<b>Session ID:</b> {session.get('session_id')} &nbsp;|&nbsp; <b>Date:</b> {event_date} "
            f"({starts_at} - {ends_at}) &nbsp;|&nbsp; <b>Room:</b> {room} &nbsp;|&nbsp; "
            f"<b>Filter:</b> {filter_label} &nbsp;|&nbsp; <b>Generated:</b> {now_str}",
            styles["meta"],
        )
    )
    story.append(Spacer(1, 3 * mm))

    # Summary KPI banner
    story.append(_build_summary_banner_table(summary, len(students), styles))
    story.append(Spacer(1, 4 * mm))

    if not students:
        story.append(
            Paragraph(
                "<i>No students matched the selected course and attendance filter criteria.</i>",
                styles["meta"],
            )
        )
        doc.build(story, canvasmaker=NumberedCanvas)
        return output.getvalue()

    # Required table columns:
    # Scholar No. | Student Name | Mobile No. | Attendance Status
    # Total width = 186mm
    # Widths: Scholar No. (35mm), Student Name (76mm), Mobile No. (42mm), Status (33mm)
    col_widths = [35 * mm, 76 * mm, 42 * mm, 33 * mm]
    hierarchy = group_students_hierarchically(students)

    for school, faculties in hierarchy.items():
        for faculty, depts in faculties.items():
            for dept, courses in depts.items():
                for course, semesters in courses.items():
                    for sem, sem_students in semesters.items():
                        hdr = _build_hierarchy_section_header(
                            school, faculty, dept, course, sem, sem_students, styles
                        )
                        story.append(hdr)
                        story.append(Spacer(1, 2.5 * mm))

                        if not sem_students:
                            story.append(
                                Paragraph(
                                    "<i>No student records for this semester under the active filter.</i>",
                                    styles["meta"],
                                )
                            )
                            story.append(Spacer(1, 3 * mm))
                            continue

                        table_data = [
                            [
                                Paragraph("Scholar No.", styles["tbl_header"]),
                                Paragraph("Student Name", styles["tbl_header"]),
                                Paragraph("Mobile No.", styles["tbl_header"]),
                                Paragraph("Attendance Status", styles["tbl_header"]),
                            ]
                        ]

                        for st in sem_students:
                            scholar_no = st.get("roll_number") or st.get("student_id") or "—"
                            name = st.get("name") or "Unknown"
                            mobile = st.get("phone") or "Not available"
                            status = str(st.get("status") or "ABSENT").upper()
                            is_present = status == "PRESENT"
                            status_color = "#059669" if is_present else "#DC2626"

                            status_text = f"<font color='{status_color}'><b>{status}</b></font>"
                            if st.get("is_manual_override"):
                                status_text += " <font color='#64748B' size='6'>(Manual)</font>"

                            sub_info = ""
                            prog = st.get("program")
                            sem_info = st.get("semester")
                            if prog or sem_info:
                                sub_info = f"<br/><font color='#64748B' size='6'>{prog or ''} {sem_info or ''}</font>"

                            table_data.append(
                                [
                                    Paragraph(f"<b>{scholar_no}</b>", styles["tbl_cell_center"]),
                                    Paragraph(f"<b>{name}</b>{sub_info}", styles["tbl_cell"]),
                                    Paragraph(mobile, styles["tbl_cell_center"]),
                                    Paragraph(status_text, styles["tbl_cell_center"]),
                                ]
                            )

                        t = Table(table_data, colWidths=col_widths, repeatRows=1, hAlign="LEFT")
                        t.setStyle(
                            TableStyle(
                                [
                                    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#163A5F")),
                                    ("ALIGN", (0, 0), (-1, 0), "CENTER"),
                                    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                                    ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#CBD5E1")),
                                    ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F8FAFC")]),
                                    ("TOPPADDING", (0, 0), (-1, -1), 3),
                                    ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
                                ]
                            )
                        )
                        story.append(t)
                        story.append(Spacer(1, 4 * mm))

    doc.build(story, canvasmaker=NumberedCanvas)
    return output.getvalue()


# -----------------------------------------------------------------------------
# MAIN SERVICE DISPATCHER & FILENAME GENERATOR
# -----------------------------------------------------------------------------
def build_session_attendance_pdf(
    session: dict[str, Any],
    students: list[dict[str, Any]],
    summary: dict[str, int],
    report_type: str = "detailed_pdf",
    status_filter: str = "both",
    course_filter: str | None = None,
) -> tuple[bytes, str]:
    """Generate attendance PDF based on report_type and return (pdf_bytes, filename)."""
    norm_report = report_type.lower().strip()
    norm_status = status_filter.lower().strip()
    session_id = str(session.get("session_id", "session"))

    # Build safe descriptive filename
    course_part = _sanitize_filename(course_filter) if course_filter and course_filter.lower() != "all" else "all_courses"

    if norm_report in {"face_pdf", "face"}:
        pdf_bytes = generate_course_wise_face_pdf(session, students, summary, course_filter, norm_status)
        filename = f"{_sanitize_filename(session_id)}_{course_part}_faces_{norm_status}.pdf"
    elif norm_report in {"text_pdf", "text"}:
        pdf_bytes = generate_student_text_only_pdf(session, students, summary, course_filter, norm_status)
        filename = f"{_sanitize_filename(session_id)}_{course_part}_text_attendance_{norm_status}.pdf"
    else:  # detailed_pdf / default
        pdf_bytes = generate_complete_student_details_pdf(session, students, summary, course_filter, norm_status)
        filename = f"{_sanitize_filename(session_id)}_{course_part}_detailed_attendance_{norm_status}.pdf"

    return pdf_bytes, filename
