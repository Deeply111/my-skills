"""拼图（运行：uv run --no-project --python 3.12 --with-requirements ../requirements.lock python 拼图.py ...）：
把一个目录里的图按行拼成一张大图。第 3 步的画风对比图用它。

  python 拼图.py <目录> [--out 图.png] [--cell 260] [--title 标题]

<目录> 下每个子文件夹是一行，行名就是文件夹名；文件夹里的 png 按文件名排序，一张一格，格子下面写文件名。
子文件夹里有 说明.txt 的，内容写在这一行的左边（第 3 步放风格卡和"为什么适合这条片"）。
透明底的图（主体的关键姿势）垫浅灰底。不挑图：文件夹里有什么就拼什么。
"""
import argparse, sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

for _s in (sys.stdout, sys.stderr):
    try: _s.reconfigure(encoding='utf-8', errors='replace')
    except AttributeError: pass

SKILL = Path(__file__).resolve().parent.parent
FONT = SKILL / '字体' / 'NotoSerifSC-600.ttf'
ap = argparse.ArgumentParser()
ap.add_argument('dir'); ap.add_argument('--out'); ap.add_argument('--cell', type=int, default=260); ap.add_argument('--title')
a = ap.parse_args()
root = Path(a.dir).resolve()
rows = [d for d in sorted(root.iterdir()) if d.is_dir() and list(d.glob('*.png'))]
if not rows: sys.exit(f'{root} 下没有放着 png 的子文件夹')

cw = a.cell; ch = cw * 16 // 9; gap = 14; label_h = 34; side = 300; top = 70 if a.title else 16
f_row, f_cell, f_note, f_title = (ImageFont.truetype(str(FONT), s) for s in (30, 20, 20, 36))
ncol = max(len(list(d.glob('*.png'))) for d in rows)
W = side + ncol * (cw + gap) + gap
H = top + len(rows) * (ch + label_h + gap * 2)
im = Image.new('RGB', (W, H), '#ffffff'); dr = ImageDraw.Draw(im)
if a.title: dr.text((W // 2, top // 2), a.title, fill='#222', font=f_title, anchor='mm')

def wrap(text, font, width):
    out = []
    for para in text.splitlines():
        line = ''
        for ch_ in para:
            if dr.textlength(line + ch_, font=font) > width and ch_ not in '，。、；：！？）》」': out.append(line); line = ch_   # 标点不放行首
            else: line += ch_
        out.append(line)
    return out

y = top
for d in rows:
    dr.text((16, y + 6), d.name, fill='#222', font=f_row)
    note = d / '说明.txt'
    if note.exists():
        for i, line in enumerate(wrap(note.read_text(encoding='utf-8').strip(), f_note, side - 32)):
            dr.text((16, y + 52 + i * 30), line, fill='#555', font=f_note)
    for k, p in enumerate(sorted(d.glob('*.png'))):
        x = side + gap + k * (cw + gap)
        src = Image.open(p)
        if src.mode in ('RGBA', 'LA'):
            bg = Image.new('RGBA', src.size, '#e9e7e2'); bg.alpha_composite(src.convert('RGBA')); src = bg
        src = src.convert('RGB'); src.thumbnail((cw, ch), Image.LANCZOS)
        im.paste(src, (x + (cw - src.width) // 2, y + (ch - src.height) // 2))
        dr.text((x + cw // 2, y + ch + 8), p.stem, fill='#666', font=f_cell, anchor='mt')
    y += ch + label_h + gap * 2
    dr.line([(16, y - gap), (W - 16, y - gap)], fill='#e5e5e5', width=2)

out = Path(a.out) if a.out else root / f'{root.name}.png'
im.save(out); print(out)
