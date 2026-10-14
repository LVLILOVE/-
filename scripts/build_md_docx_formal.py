# -*- coding: utf-8 -*-
"""Markdown -> Word（正式方案文档版）
相比 build_md_docx.py 的改进：
1) 标题使用真正的 Word 命名样式（Heading 1-4），可生成导航窗格 / 目录
2) 首部插入自动目录（TOC 域）
3) 页眉页脚 + 页码
4) 代码块保留等宽字体与底纹
5) Markdown 表格 -> 真 Word 表格（表头跨页重复）
6) Markdown 图片 ![图题](路径) -> 居中插图 + 居中图题（按高度约束自动缩放）
用法: python build_md_docx_formal.py <输入.md> <输出.docx>
"""
import re
import sys
from pathlib import Path
from docx import Document
from docx.shared import Pt, Cm, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

try:  # PyMuPDF：仅用于读取图片宽高比，缺失时退化为固定宽度
    import pymupdf as fitz
except ImportError:
    try:
        import fitz
    except ImportError:
        fitz = None

DARK = RGBColor(0x1F, 0x2D, 0x3D)
ACCENT = RGBColor(0x1A, 0x5F, 0x8A)
BODY = RGBColor(0x2B, 0x2B, 0x2B)
GRAY = RGBColor(0x70, 0x70, 0x70)
RED = RGBColor(0xAA, 0x33, 0x33)
CN_FONT = 'Microsoft YaHei'
EN_FONT = 'Microsoft YaHei'

if len(sys.argv) >= 3:
    SRC, OUT = sys.argv[1], sys.argv[2]
else:
    raise SystemExit('用法: python build_md_docx_formal.py <输入.md> <输出.docx>')

ROOT = Path(__file__).resolve().parent.parent
SRC_DIR = Path(SRC).resolve().parent

doc = Document()
sec = doc.sections[0]
sec.page_width, sec.page_height = Cm(21.0), Cm(29.7)
sec.top_margin = Cm(2.0)
sec.bottom_margin = Cm(1.8)
sec.left_margin = sec.right_margin = Cm(2.0)

# ---------- 基础样式 ----------
normal = doc.styles['Normal']
normal.font.name = EN_FONT
normal.font.size = Pt(10.5)
normal.element.rPr.rFonts.set(qn('w:eastAsia'), CN_FONT)
normal.paragraph_format.space_before = Pt(0)
normal.paragraph_format.space_after = Pt(4)
normal.paragraph_format.line_spacing = 1.3

# 标题样式（覆盖内置样式，确保中文与颜色统一）
HEAD_CFG = {
    'Heading 1': (18, DARK, 16, 8),
    'Heading 2': (14.5, ACCENT, 14, 6),
    'Heading 3': (12, ACCENT, 10, 4),
    'Heading 4': (11, DARK, 8, 3),
}
for name, (size, color, sb, sa) in HEAD_CFG.items():
    st = doc.styles[name]
    st.font.name = EN_FONT
    st.font.size = Pt(size)
    st.font.bold = True
    st.font.color.rgb = color
    st.element.rPr.rFonts.set(qn('w:eastAsia'), CN_FONT)
    st.paragraph_format.space_before = Pt(sb)
    st.paragraph_format.space_after = Pt(sa)
    st.paragraph_format.line_spacing = 1.2
    st.paragraph_format.keep_with_next = True


def set_run(run, size=10.5, bold=False, color=BODY, italic=False,
            font=EN_FONT, mono=False):
    run.font.name = font
    run.font.size = Pt(size)
    run.font.bold = bold
    run.font.italic = italic
    run.font.color.rgb = color
    run._element.rPr.rFonts.set(qn('w:eastAsia'), CN_FONT)
    if mono:
        run._element.rPr.rFonts.set(qn('w:ascii'), 'Consolas')
        run._element.rPr.rFonts.set(qn('w:hAnsi'), 'Consolas')
    return run


def para(sb=0, sa=4, line=1.3, indent=0, style=None):
    p = doc.add_paragraph(style=style)
    p.paragraph_format.space_before = Pt(sb)
    p.paragraph_format.space_after = Pt(sa)
    p.paragraph_format.line_spacing = line
    if indent:
        p.paragraph_format.left_indent = Cm(indent)
    return p


def shade_para(p, fill):
    pPr = p._p.get_or_add_pPr()
    shd = OxmlElement('w:shd')
    shd.set(qn('w:val'), 'clear')
    shd.set(qn('w:fill'), fill)
    pPr.append(shd)


def shade_cell(cell, fill):
    tcPr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement('w:shd')
    shd.set(qn('w:val'), 'clear')
    shd.set(qn('w:fill'), fill)
    tcPr.append(shd)


def emit_runs(p, text, base_size=10.5, base_color=BODY, bold=False):
    """处理 **加粗** / `代码` / *斜体* 行内混排。

    ⚠️ 支持**嵌套**（如 ``**`EP-3` 执行记录**``）：加粗分支会**递归**再解析内层，
    否则内层的反引号会被当普通字符原样写进 Word/PDF
    （EP-3 导出时实测踩到：正文里出现「`EP-3` 执行记录」这种带反引号的丑陋文本）。
    """
    tokens = re.split(r'(\*\*.+?\*\*|`[^`]+`|(?<![\w*])\*[^*\s][^*]*\*(?![\w*]))', text)
    for tk in tokens:
        if not tk:
            continue
        if tk.startswith('**') and tk.endswith('**') and len(tk) > 4:
            # 加粗文字沿用既有配色（DARK），并把粗体标记向下传递
            emit_runs(p, tk[2:-2], base_size=base_size, base_color=DARK, bold=True)
        elif tk.startswith('`') and tk.endswith('`') and len(tk) > 2:
            set_run(p.add_run(tk[1:-1]), size=base_size - 0.5, bold=bold, color=ACCENT, mono=True)
        elif tk.startswith('*') and tk.endswith('*') and len(tk) > 2:
            set_run(p.add_run(tk[1:-1]), size=base_size, bold=bold, italic=True, color=base_color)
        else:
            set_run(p.add_run(tk), size=base_size, bold=bold, color=base_color)


def add_toc():
    """插入 TOC 域（打开 Word 后按 F9 或提示更新即可生成目录）"""
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.LEFT
    run = p.add_run()
    fld_begin = OxmlElement('w:fldChar')
    fld_begin.set(qn('w:fldCharType'), 'begin')
    instr = OxmlElement('w:instrText')
    instr.set(qn('xml:space'), 'preserve')
    instr.text = r'TOC \o "1-3" \h \z \u'
    fld_sep = OxmlElement('w:fldChar')
    fld_sep.set(qn('w:fldCharType'), 'separate')
    hint = OxmlElement('w:t')
    hint.text = '【请在 Word 中按 Ctrl+A 后按 F9 更新目录】'
    fld_end = OxmlElement('w:fldChar')
    fld_end.set(qn('w:fldCharType'), 'end')
    r = run._element
    r.append(fld_begin)
    r.append(instr)
    r.append(fld_sep)
    r.append(hint)
    r.append(fld_end)
    set_run(run, size=10, color=GRAY)


def add_page_number_footer():
    footer = doc.sections[0].footer
    p = footer.paragraphs[0]
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    set_run(p.add_run('第 '), size=9, color=GRAY)
    run = p.add_run()
    b = OxmlElement('w:fldChar'); b.set(qn('w:fldCharType'), 'begin')
    i = OxmlElement('w:instrText'); i.set(qn('xml:space'), 'preserve'); i.text = 'PAGE'
    e = OxmlElement('w:fldChar'); e.set(qn('w:fldCharType'), 'end')
    run._element.append(b); run._element.append(i); run._element.append(e)
    set_run(run, size=9, color=GRAY)
    set_run(p.add_run(' 页'), size=9, color=GRAY)


def add_md_table(rows):
    if not rows:
        return
    ncol = max(len(r) for r in rows)
    t = doc.add_table(rows=0, cols=ncol)
    t.style = 'Table Grid'
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    for ri, row in enumerate(rows):
        cells = t.add_row().cells
        for ci in range(ncol):
            txt = row[ci] if ci < len(row) else ''
            cell = cells[ci]
            cell.text = ''
            p = cell.paragraphs[0]
            p.paragraph_format.space_before = Pt(1.5)
            p.paragraph_format.space_after = Pt(1.5)
            p.paragraph_format.line_spacing = 1.15
            emit_runs(p, txt, base_size=9,
                      base_color=DARK if ri == 0 else BODY)
            if ri == 0:
                for r in p.runs:
                    r.font.bold = True
                    r.font.color.rgb = ACCENT
                shade_para(p, 'EAF1F7')
                shade_cell(cell, 'EAF1F7')
    trPr = t.rows[0]._tr.get_or_add_trPr()
    trPr.append(OxmlElement('w:tblHeader'))
    para(sa=5)


# ---------- 图片 ----------
IMG_RE = re.compile(r'^!\[(.*?)\]\((.+?)\)\s*$')
IMG_MAX_W_CM = 16.4      # 版心宽 17cm，留极窄边距
IMG_MAX_H_CM = 19.5      # 正文区高约 25.9cm，限高以给图题和上下文留空间


def resolve_image(src: str) -> Path | None:
    """按「文档同目录 → 工作区根 → 原始路径」顺序解析图片路径。"""
    for cand in (SRC_DIR / src, ROOT / src, Path(src)):
        if cand.exists():
            return cand
    return None


def add_image(alt: str, src: str) -> None:
    """居中插入图片 + 居中图题。

    只设置宽度，高度由 python-docx 按原始比例推导；若该宽度会导致高度
    超过 IMG_MAX_H_CM（如竖长的分域 ER 图），则改为按高度约束、反推宽度。
    """
    path = resolve_image(src)
    if path is None:
        p = para(sb=4, sa=4)
        set_run(p.add_run(f'[缺图：{src}]'), size=9.5, color=RED)
        return

    w_cm = IMG_MAX_W_CM
    if fitz is not None:
        try:
            r = fitz.open(str(path))[0].rect
            ratio = (r.height / r.width) if r.width else 0
            if ratio and w_cm * ratio > IMG_MAX_H_CM:
                w_cm = IMG_MAX_H_CM / ratio
        except Exception:  # noqa: BLE001  图片不可读时退化为固定宽度
            pass

    p = para(sb=6, sa=3, line=1.0)
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.add_run().add_picture(str(path), width=Cm(w_cm))

    if alt:
        cap = para(sb=0, sa=10, line=1.1)
        cap.alignment = WD_ALIGN_PARAGRAPH.CENTER
        set_run(cap.add_run(alt), size=9, color=GRAY)


# ---------- 主流程 ----------
lines = open(SRC, encoding='utf-8').read().split('\n')
i = 0
first_h1_done = False
toc_inserted = False

while i < len(lines):
    line = lines[i]
    s = line.strip()

    # 代码块
    if s.startswith('```'):
        i += 1
        buf = []
        while i < len(lines) and not lines[i].strip().startswith('```'):
            buf.append(lines[i].rstrip())
            i += 1
        i += 1
        if buf:
            for c in buf:
                p = para(sa=0.5, line=1.05, indent=0.3)
                shade_para(p, 'F4F6F8')
                set_run(p.add_run(c if c else ' '), size=8.5,
                        color=RGBColor(0x1A, 0x3A, 0x5A), mono=True)
            para(sa=4)
        continue

    # 表格
    if s.startswith('|'):
        block = []
        while i < len(lines) and lines[i].strip().startswith('|'):
            bl = lines[i].strip()
            cells = [c.strip() for c in bl.strip('|').split('|')]
            if not all(re.fullmatch(r':?-{2,}:?', c) for c in cells if c):
                block.append(cells)
            i += 1
        add_md_table(block)
        continue

    i += 1

    # 图片：![图题](路径)
    m_img = IMG_RE.match(s)
    if m_img:
        add_image(m_img.group(1), m_img.group(2))
        continue

    if not s:
        para(sa=3)
        continue

    # 分隔线
    if s == '---':
        p = para(sa=4, sb=4)
        pPr = p._p.get_or_add_pPr()
        bd = OxmlElement('w:pBdr')
        bt = OxmlElement('w:bottom')
        bt.set(qn('w:val'), 'single'); bt.set(qn('w:sz'), '6')
        bt.set(qn('w:space'), '1'); bt.set(qn('w:color'), 'C8D8E5')
        bd.append(bt); pPr.append(bd)
        continue

    # 标题
    if s.startswith('#'):
        lvl = len(s) - len(s.lstrip('#'))
        txt = s.lstrip('#').strip()
        txt = re.sub(r'\*\*(.+?)\*\*', r'\1', txt)
        # 标题里的行内代码标记（反引号）一律去掉：Word 标题不需要代码字体，
        # 留着会渲染成「7.4 `EP-3` 前台产品首页」这种带反引号的标题。
        txt = txt.replace('`', '')
        if lvl == 1 and not first_h1_done:
            # 主标题页：居中大标题 + 副信息
            p = para(sb=0, sa=10)
            p.alignment = WD_ALIGN_PARAGRAPH.CENTER
            set_run(p.add_run(txt), size=22, bold=True, color=DARK)
            first_h1_done = True
            continue
        if lvl == 1:
            doc.add_page_break()
        style = f'Heading {min(lvl, 4)}'
        p = doc.add_paragraph(style=style)
        set_run(p.add_run(txt),
                size=HEAD_CFG[style][0], bold=True, color=HEAD_CFG[style][1])
        # 一级标题在目录之后首次出现时插入 TOC
        if lvl == 1 and first_h1_done and not toc_inserted:
            pass
        continue

    # 引用块
    if s.startswith('>'):
        q = s.lstrip('>').strip()
        if q.startswith('```'):
            continue
        p = para(sb=2, sa=2, indent=0.3)
        shade_para(p, 'FFF8E6')
        emit_runs(p, q, base_size=9.5, base_color=RGBColor(0x6B, 0x4E, 0x10))
        continue

    # 复选框
    if re.match(r'^-\s*\[[ x]\]', s):
        box = '☐' if '[ ]' in s[:6] else '☑'
        p = para(sa=2, line=1.3, indent=0.4)
        set_run(p.add_run(box + ' '), size=11, color=ACCENT)
        emit_runs(p, s[5:].strip(), base_size=10.5)
        continue

    # 有序列表
    m = re.match(r'^(\d+)\.\s+(.*)$', s)
    if m:
        p = para(sa=2, line=1.3, indent=0.4)
        set_run(p.add_run(f'{m.group(1)}. '), size=10.5, bold=True, color=ACCENT)
        emit_runs(p, m.group(2), base_size=10.5)
        continue

    # 二级无序（缩进）
    if re.match(r'^\s{2,}-\s', line):
        p = para(sa=1.5, line=1.3, indent=1.0)
        set_run(p.add_run('– '), size=10, color=GRAY)
        emit_runs(p, re.sub(r'^\s*-\s*', '', line), base_size=10)
        continue

    # 无序列表
    if s.startswith('- '):
        p = para(sa=2, line=1.3, indent=0.5)
        set_run(p.add_run('· '), size=10.5, bold=True, color=ACCENT)
        emit_runs(p, s[2:].strip(), base_size=10.5)
        continue

    # 普通段落
    p = para(sa=4, line=1.3)
    emit_runs(p, s, base_size=10.5)

add_page_number_footer()

# 在「第一个 H2（第一章）」之前插入「目录」页，使顺序为：封面 -> 目录 -> 正文
anchor = None
for p in doc.paragraphs:
    if p.style.name == 'Heading 2':
        anchor = p
        break
if anchor is not None:
    blank = anchor.insert_paragraph_before('')
    blank.paragraph_format.space_after = Pt(0)
    toc_title = anchor.insert_paragraph_before('目  录')
    toc_title.alignment = WD_ALIGN_PARAGRAPH.CENTER
    toc_title.paragraph_format.space_after = Pt(10)
    set_run(toc_title.add_run(''), size=16, bold=True, color=DARK)
    for r in toc_title.runs:
        r.text = ''
    toc_title.runs[0].text = '目  录'

    # 目录域：插入真正的 TOC 域，Word 打开后 F9 即自动生成带页码的目录
    toc_p = anchor.insert_paragraph_before('')
    run = toc_p.add_run()
    fb = OxmlElement('w:fldChar'); fb.set(qn('w:fldCharType'), 'begin')
    instr = OxmlElement('w:instrText'); instr.set(qn('xml:space'), 'preserve')
    instr.text = r'TOC \o "1-3" \h \z \u'
    fs = OxmlElement('w:fldChar'); fs.set(qn('w:fldCharType'), 'separate')
    hint = OxmlElement('w:t')
    hint.text = '【请在 Word 中按 Ctrl+A 后按 F9 更新目录】'
    fe = OxmlElement('w:fldChar'); fe.set(qn('w:fldCharType'), 'end')
    for el in (fb, instr, fs, hint, fe):
        run._element.append(el)
    set_run(run, size=10, color=GRAY)

    pb = anchor.insert_paragraph_before('')
    pb.add_run().add_break(WD_BREAK.PAGE)

doc.save(OUT)
print('SAVED:', OUT)
