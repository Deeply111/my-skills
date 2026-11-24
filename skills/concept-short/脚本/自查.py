"""自查（运行：uv run --no-project --python 3.12 --with-requirements ../requirements.lock python 自查.py ...）：
交东西之前自己看的测试，一般不给用户看。

  剪影：python 自查.py 剪影 <png...> [--out 图.png]
        主体的关键姿势或状态单独画在透明底上（镜头里只画主体，不铺背景），这里把它涂成纯黑放在白底上，排成一排。
        只看黑影还认得出在做什么、什么情绪，才算过；认不出就改姿势。
  灰度：python 自查.py 灰度 <png...> [--out 图.png]
        每张样张转黑白，缩到邮票大小（108×192）排成一排。主体还能一眼找到才算过；找不到就改构图或明暗。
  格调：python 自查.py 格调 <png...> [--规格 格调.json] [--out 结果.txt]
        量出格调里能量化的三项，每张一行：有彩色几种（色相相近的算一种，占画面 1% 以上才算）、
        饱和度（最艳的 5% 像素有多艳，0–1）、留白（几乎没有细节的地方占画面多少，0–1）。
        给了 --规格（画风文件夹里的 格调.json）就逐项对门槛，超了列出来；只是提醒，不算硬伤，可能出于创作意图。
        不给规格只量数：从用户拍板过的画面量出来，用来定门槛。
"""
import argparse, json, sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

for _s in (sys.stdout, sys.stderr):
    try: _s.reconfigure(encoding='utf-8', errors='replace')
    except AttributeError: pass

SKILL = Path(__file__).resolve().parent.parent
FONT = ImageFont.truetype(str(SKILL / '字体' / 'NotoSerifSC-600.ttf'), 18)
ap = argparse.ArgumentParser()
ap.add_argument('kind', choices=['剪影', '灰度', '格调']); ap.add_argument('files', nargs='+'); ap.add_argument('--out')
ap.add_argument('--规格', dest='spec', help='格调.json（只用于 格调）')
a = ap.parse_args()
files = [Path(f) for f in a.files]

def tone(im):
    """一张图的三项格调数。颜色按 270×480 算，留白按邮票大小算：只看大块的取舍，纸纹、颗粒这类细纹不算进细节。"""
    import numpy as np
    rgb = np.asarray(im.convert('RGB').resize((270, 480), Image.LANCZOS), dtype=np.float32) / 255
    c = rgb.max(2) - rgb.min(2)   # 色度：最亮和最暗通道之差
    # 有彩色：色度够的像素按色相分 18 格（每格 20°），占画面 1% 以上的格子，相邻的连成一种
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    h = np.degrees(np.arctan2(np.sqrt(3) * (g - b), 2 * r - g - b)) % 360
    hist = np.bincount((h[c > .12] // 20).astype(int), minlength=18) / c.size
    on = hist > .01
    kinds = 1 if on.all() else sum(1 for i in range(18) if on[i] and not on[i - 1])
    sat = float(np.percentile(c, 95))
    # 留白：缩到邮票大小（108×192）再看，耙纹、纸纹这类均匀的细纹被抹平；4×4 的小块（原图约 40 像素见方）里明暗起伏很小，就算没有细节
    y = np.asarray(im.convert('L').resize((108, 192), Image.LANCZOS), dtype=np.float32) / 255
    empty = float((y.reshape(48, 4, 27, 4).std(axis=(1, 3)) < .02).mean())
    return {'有彩色': kinds, '饱和度': round(sat, 2), '留白': round(empty, 2)}

if a.kind == '格调':
    # 门槛：有彩色最多、饱和度最高、留白最少、留白最多，没写的那项不查
    spec = json.loads(Path(a.spec).read_text(encoding='utf-8-sig')) if a.spec else {}
    rules = [('有彩色', '有彩色最多', lambda v, t: v > t, ' 种，超过'), ('饱和度', '饱和度最高', lambda v, t: v > t, '，超过'),
             ('留白', '留白最少', lambda v, t: v < t, '，少于'), ('留白', '留白最多', lambda v, t: v > t, '，多于')]
    lines, n = [], 0
    for p in files:
        m = tone(Image.open(p))
        bad = [f'{k} {m[k]}{w} {spec[key]}' for k, key, f, w in rules if key in spec and f(m[k], spec[key])]
        n += bool(bad)
        lines.append(f"{p.name}　有彩色 {m['有彩色']}　饱和度 {m['饱和度']}　留白 {m['留白']}" + ('　← ' + '；'.join(bad) if bad else ''))
    if spec: lines.append(f'{len(files)} 张里 {n} 张超出 {Path(a.spec).name} 的门槛' if n else f'{len(files)} 张都在 {Path(a.spec).name} 的门槛内')
    print('\n'.join(lines))
    if a.out: Path(a.out).parent.mkdir(parents=True, exist_ok=True); Path(a.out).write_text('\n'.join(lines) + '\n', encoding='utf-8')
    sys.exit(0)

cells = []
for p in files:
    src = Image.open(p)
    if a.kind == '剪影':
        if src.mode != 'RGBA' or src.getchannel('A').getextrema()[0] == 255:
            sys.exit(f'{p.name} 没有透明底：剪影测试要把主体单独画在透明底上')
        al = src.getchannel('A').point(lambda v: 255 if v > 24 else 0)
        box = al.getbbox() or (0, 0, src.width, src.height)
        cell = Image.new('L', src.size, 255); cell.paste(0, mask=al); cell = cell.crop(box)
        cell.thumbnail((220, 300), Image.LANCZOS)
    else:
        cell = src.convert('L'); cell = cell.resize((108, 192), Image.LANCZOS)
    cells.append((p.stem, cell))

pad, lab = 20, 30
cw = max(c.width for _, c in cells); chh = max(c.height for _, c in cells)
im = Image.new('L', (pad + len(cells) * (cw + pad), pad + chh + lab), 255); dr = ImageDraw.Draw(im)
for i, (name, c) in enumerate(cells):
    x = pad + i * (cw + pad)
    im.paste(c, (x + (cw - c.width) // 2, pad + chh - c.height if a.kind == '剪影' else pad))
    dr.text((x + cw // 2, pad + chh + 6), name, fill=110, font=FONT, anchor='mt')
out = Path(a.out) if a.out else files[0].parent / '自查' / f'{a.kind}测试.png'   # 放进子文件夹，免得被拼图当成样张
out.parent.mkdir(parents=True, exist_ok=True); im.save(out); print(out)
