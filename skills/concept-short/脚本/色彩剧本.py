"""色彩剧本（运行：uv run --no-project --python 3.12 --with-requirements ../requirements.lock python 色彩剧本.py ...）：
第 4 步用。把 代码/色彩剧本.js 的格子渲出来，拼成交给用户的色彩剧本图，再出三张自查图。

  python 色彩剧本.py <片子目录> [--cell 220]

输出：
  <片子>/色彩剧本.png            交给用户（②）：一长条格子，每格下面标名字、时间、情绪；右边印颜色含义表
  <片子>/色彩剧本/自查/黑白.png   明暗起落一眼看得出来
  <片子>/色彩剧本/自查/模糊.png   大块的明暗对不对
  <片子>/色彩剧本/自查/曲线.png   每格量出的亮度、反差、冷暖、饱和度，和画面卡的情绪强度、音乐响度放在一起
                                 （布洛克《视觉故事》：故事越紧张，视觉对比越强）
自查图只给自己看。脚本还会打印几条提醒：情绪最强的那格反差是不是最强、相邻两格是不是太像。

情绪强度从 画面卡.md 的标题行读（"### <编号>　<字幕>　强度 <1–5>｜……"），每格取它对应的卡里最高的；
音乐响度读换算成片子时间的音乐地图（脚本/配乐.py，按 片子.json 的配乐速度和剪辑换算）。
"""
import argparse, json, re, subprocess, sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

for _s in (sys.stdout, sys.stderr):
    try: _s.reconfigure(encoding='utf-8', errors='replace')
    except AttributeError: pass

SKILL = Path(__file__).resolve().parent.parent
FONT_B, FONT_R = SKILL / '字体' / 'NotoSerifSC-600.ttf', SKILL / '字体' / 'NotoSerifSC-400.ttf'
BG, FG, DIM = (26, 24, 22), (239, 230, 214), (154, 146, 134)

ap = argparse.ArgumentParser()
ap.add_argument('film'); ap.add_argument('--cell', type=int, default=220)
a = ap.parse_args()
film = Path(a.film).resolve()
work = film / '色彩剧本'; cells_dir = work / '格子'; check_dir = work / '自查'
check_dir.mkdir(parents=True, exist_ok=True)

r = subprocess.run([sys.executable, str(SKILL / '脚本' / 'render.py'), str(film), '--cells', str(cells_dir)], capture_output=True, text=True, encoding='utf-8')
if r.returncode: sys.exit(r.stderr.strip() or r.stdout.strip())
info = json.loads((cells_dir / '格子.json').read_text(encoding='utf-8'))
cells, meaning = info['格子'], info['颜色含义']
imgs = [Image.open(cells_dir / f'{i + 1:02d}.png').convert('RGB') for i in range(len(cells))]
font = lambda f, s: ImageFont.truetype(str(f), s)

# ---------- 量每一格（OKLab：L 亮度，a/b 色相，b > 0 偏暖黄、b < 0 偏冷蓝） ----------
def oklab(img):
    x = np.asarray(img.resize((135, 240), Image.LANCZOS), dtype=np.float64) / 255
    x = np.where(x <= 0.04045, x / 12.92, ((x + 0.055) / 1.055) ** 2.4)
    lms = x @ np.array([[0.4122214708, 0.2119034982, 0.0883024619], [0.5363325363, 0.6806995451, 0.2817188376], [0.0514459929, 0.1073969566, 0.6299787005]])
    lms = np.cbrt(lms)
    return lms @ np.array([[0.2104542553, 1.9779984951, 0.0259040371], [0.7936177850, -2.4285922050, 0.7827717662], [-0.0040720468, 0.4505937099, -0.8086757660]])
M = []
for im in imgs:
    lab = oklab(im).reshape(-1, 3); L = lab[:, 0]
    M.append({'亮度': L.mean(), '反差': np.percentile(L, 95) - np.percentile(L, 5), '冷暖': lab[:, 2].mean(), '饱和度': np.hypot(lab[:, 1], lab[:, 2]).mean()})

# ---------- 情绪强度（画面卡）和音乐响度 ----------
card_file = film / '画面卡.md'
power = {}   # 卡号 → 强度，按画面卡里的先后排；卡号什么写法都行（3、A1、3b）
if card_file.exists():
    for line in card_file.read_text(encoding='utf-8').splitlines():
        m = re.match(r'###\s*(\S+)[\s　].*?强度\s*(\d)', line)
        if m: power[m[1]] = int(m[2])
order = list(power)
for c in cells:
    ks = []
    if c['卡']:   # 卡: [起, 止]，取画面卡里从起到止这一段（含两头）
        k0, k1 = (str(k) for k in c['卡'])
        if k0 in power and k1 in power: ks = [power[k] for k in order[order.index(k0):order.index(k1) + 1]]
        else: print(f'提醒：格子「{c["名"]}」的卡 {k0}–{k1} 在画面卡里找不到')
    c['强度'] = max(ks) if ks else None
import 配乐   # 换算成片子时间的音乐地图（按配乐速度和剪辑换算）
curve = np.array(配乐.film_map(film)[0]['响度曲线'])
loud_at = lambda t: curve[min(len(curve) - 1, int(np.searchsorted(curve[:, 0], t)))][1]
T = max(c['t'][1] for c in cells)

# ---------- 拼格子 ----------
def wrap(d, text, f, width):
    lines, cur = [], ''
    for ch in text:
        if d.textlength(cur + ch, font=f) > width and cur and ch not in '，。、；：！？）」』·':
            lines.append(cur); cur = ch
        else: cur += ch
    return lines + ([cur] if cur else [])

def grid(images, title, side=0, labels=True):
    n = len(images); rows = -(-n // 8); per = -(-n // rows)
    cw = a.cell; ch = cw * 16 // 9; gap = 16; lab = 92 if labels else 30; top = 96
    W = gap + per * (cw + gap) + side; H = top + rows * (ch + lab) + gap
    canvas = Image.new('RGB', (W, H), BG); d = ImageDraw.Draw(canvas)
    d.text((gap + 4, 22), title, font=font(FONT_B, 34), fill=FG)
    d.text((gap + 4, 66), '每格只看颜色、明暗和光，不看细节', font=font(FONT_R, 18), fill=DIM)
    for i, im in enumerate(images):
        x = gap + (i % per) * (cw + gap); y = top + (i // per) * (ch + lab)
        canvas.paste(im.resize((cw, ch), Image.LANCZOS), (x, y))
        c = cells[i]
        if labels:
            d.text((x, y + ch + 8), c['名'], font=font(FONT_B, 21), fill=FG)
            sub = f"{c['t'][0]:g}–{c['t'][1]:g}s" + (f" · {c['情绪']}" if c['情绪'] else '')
            for k, ln in enumerate(wrap(d, sub, font(FONT_R, 16), cw)[:2]):
                d.text((x, y + ch + 38 + k * 22), ln, font=font(FONT_R, 16), fill=DIM)
        else:
            d.text((x, y + ch + 4), c['名'], font=font(FONT_R, 16), fill=DIM)
    return canvas, W - side

main, x0 = grid(imgs, f'色彩剧本 · {film.name}', side=380 if meaning else 0)
if meaning:
    d = ImageDraw.Draw(main); x = x0 + 10; y = 110
    d.text((x, y), '颜色含义', font=font(FONT_B, 24), fill=FG); y += 48
    for name, (col, what) in meaning.items():
        d.rounded_rectangle((x, y, x + 40, y + 40), 6, fill=col, outline=(80, 76, 70))
        d.text((x + 54, y - 2), name, font=font(FONT_B, 20), fill=FG)
        lines = wrap(d, what, font(FONT_R, 17), 290)
        for k, ln in enumerate(lines): d.text((x + 54, y + 26 + k * 22), ln, font=font(FONT_R, 17), fill=DIM)
        y += max(56, 34 + len(lines) * 22)
main.save(film / '色彩剧本.png')
grid([im.convert('L').convert('RGB') for im in imgs], '自查 · 黑白', labels=False)[0].save(check_dir / '黑白.png')
grid([im.filter(ImageFilter.GaussianBlur(im.width / 18)) for im in imgs], '自查 · 模糊', labels=False)[0].save(check_dir / '模糊.png')

# ---------- 曲线 ----------
PW, PH, L0, top = 1500, 130, 190, 70
panels = [('情绪 / 音乐', None), ('亮度', '亮度'), ('反差', '反差'), ('冷暖', '冷暖'), ('饱和度', '饱和度')]
fig = Image.new('RGB', (L0 + PW + 40, top + len(panels) * (PH + 30) + 40), BG); d = ImageDraw.Draw(fig)
d.text((20, 18), f'自查 · 曲线（{film.name}）', font=font(FONT_B, 28), fill=FG)
X = lambda t: L0 + t / T * PW
for p, (label, key) in enumerate(panels):
    y0 = top + p * (PH + 30)
    d.rectangle((L0, y0, L0 + PW, y0 + PH), fill=(36, 33, 30))
    for i, c in enumerate(cells):
        if i % 2: d.rectangle((X(c['t'][0]), y0, X(c['t'][1]), y0 + PH), fill=(42, 39, 35))
        if p == 0: d.text((X(c['t'][0]) + 3, y0 + 3), str(i + 1), font=font(FONT_R, 13), fill=(106, 100, 92))
    d.text((20, y0 + PH / 2 - 14), label, font=font(FONT_B, 20), fill=DIM)
    if key == '冷暖': d.text((20, y0 + PH / 2 + 14), '中线以上暖、以下冷', font=font(FONT_R, 13), fill=(106, 100, 92))
    if key is None:
        pts = [(X(t), y0 + PH - loud_at(t) * PH * .9) for t in np.arange(0, T, 0.5)]
        d.line(pts, fill=(143, 168, 200), width=2)
        for c in cells:
            if c['强度']: y = y0 + PH - c['强度'] / 5 * PH * .9; d.line([(X(c['t'][0]), y), (X(c['t'][1]), y)], fill=(240, 194, 122), width=4)
        d.text((L0 + PW - 260, y0 + PH + 4), '— 情绪强度', font=font(FONT_R, 14), fill=(240, 194, 122))
        d.text((L0 + PW - 140, y0 + PH + 4), '— 音乐响度', font=font(FONT_R, 14), fill=(143, 168, 200))
    else:
        vs = np.array([m[key] for m in M]); lo, hi = vs.min(), vs.max()
        if key == '冷暖': lo, hi = min(lo, -abs(hi)), max(hi, abs(lo)); d.line([(L0, y0 + PH / 2), (L0 + PW, y0 + PH / 2)], fill=(70, 66, 60))
        nv = (vs - lo) / (hi - lo) if hi > lo else vs * 0 + .5
        for c, v in zip(cells, nv):
            y = y0 + PH - (.05 + v * .9) * PH; d.line([(X(c['t'][0]), y), (X(c['t'][1]), y)], fill=FG, width=4)
for t in range(0, int(T) + 1, 10):
    d.text((X(t) - 8, top + len(panels) * (PH + 30) - 6), f'{t}s', font=font(FONT_R, 13), fill=(106, 100, 92))
fig.save(check_dir / '曲线.png')

# ---------- 提醒 ----------
notes = []
has = [i for i, c in enumerate(cells) if c['强度']]
if not has: notes.append('没读到情绪强度（画面卡.md 不在，或格子没标"卡"），强度相关的检查跳过')
else:
    top_p = max(cells[i]['强度'] for i in has)
    rank = sorted(range(len(cells)), key=lambda i: -M[i]['反差'])
    for i in (i for i in has if cells[i]['强度'] == top_p):
        k = rank.index(i) + 1
        if k > 2: notes.append(f'情绪最强的「{cells[i]["名"]}」反差排第 {k}，反差最强的是「{cells[rank[0]]["名"]}」')
    if len(has) >= 3:
        r_ = np.corrcoef([cells[i]['强度'] for i in has], [M[i]['反差'] for i in has])[0, 1]
        notes.append(f'情绪强度和反差的相关系数 {r_:.2f}（越接近 1，对比越跟着情绪走）')
for i in range(1, len(cells)):
    p, q = M[i - 1], M[i]
    if abs(p['亮度'] - q['亮度']) < .03 and abs(p['反差'] - q['反差']) < .03 and abs(p['冷暖'] - q['冷暖']) < .01 and abs(p['饱和度'] - q['饱和度']) < .01:
        notes.append(f'相邻的「{cells[i - 1]["名"]}」和「{cells[i]["名"]}」颜色和明暗几乎一样')
print(f'{film / "色彩剧本.png"}（{len(cells)} 格）')
print(f'自查图：{check_dir}（黑白、模糊、曲线）')
for n_ in notes: print('提醒：' + n_)
