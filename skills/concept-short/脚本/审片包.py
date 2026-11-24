"""审片包（运行：uv run --no-project --python 3.12 --with-requirements ../requirements.lock python 审片包.py <片子目录> [--video 成片.mp4]）：
给独立审片人准备的东西，存进 <片子>/审片/包/。只放观众看得到、听得到的，不放画面卡和意图。

  开头.png        前 3 秒，每 0.25 秒一张：第一次只给这张，问会不会停下来
  接触表_01.png…  每 5 秒一张：每 0.5 秒一格，再加每个镜头的第一帧（标"切"），短镜头不会漏；每格标时间，字幕已经在画面里
  字幕表.md       每条字幕的文字和起止时间
  声音表.md       听得到什么、在第几秒：音效、环境声、音乐变强变轻、压低停下。不写为什么这样安排
派审片人的做法见 模板/审片人说明.md。
"""
import argparse, json, subprocess, sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFont
import 检查

for _s in (sys.stdout, sys.stderr):
    try: _s.reconfigure(encoding='utf-8', errors='replace')
    except AttributeError: pass

SKILL = Path(__file__).resolve().parent.parent
FPS, CW, CH, BAR, COLS = 30, 270, 480, 30, 4
FONT = ImageFont.truetype(str(SKILL / '字体' / 'NotoSerifSC-600.ttf'), 20)
TITLE = ImageFont.truetype(str(SKILL / '字体' / 'NotoSerifSC-600.ttf'), 26)

ap = argparse.ArgumentParser()
ap.add_argument('film'); ap.add_argument('--video')
a = ap.parse_args()
film = Path(a.film).resolve()
video = Path(a.video) if a.video else film / f'{film.name}.mp4'
if not video.exists(): sys.exit(f'找不到成片：{video}')
_v = json.loads(subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'json', str(video)], capture_output=True, text=True).stdout)['streams'][0]
if _v['width'] > _v['height']: CW, CH, COLS = 480, 270, 3   # 横屏：格子横着放，一行 3 格（竖屏 270×480、一行 4 格）
timeline = json.loads((film / '代码' / '时间轴.json').read_text(encoding='utf-8'))
length = max(s['to'] for s in timeline)
out = film / '审片' / '包'; out.mkdir(parents=True, exist_ok=True)
for old in out.glob('*.png'): old.unlink()

# 要哪些帧：开头每 0.25 秒；全片每 0.5 秒，加每个镜头的第一帧
cuts = {round(s['from'] * FPS) for s in timeline}
head = [round(t * FPS) for t in np.arange(0, min(3, length), .25)]
body = sorted({round(t * FPS) for t in np.arange(0, length, .5)} | cuts)
need = set(head) | set(body)
grab = {}
p = subprocess.Popen(['ffmpeg', '-v', 'error', '-i', str(video), '-vf', f'scale={CW}:{CH}', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], stdout=subprocess.PIPE)
i = 0
while True:
    buf = p.stdout.read(CW * CH * 3)
    if len(buf) < CW * CH * 3: break
    if i in need: grab[i] = Image.frombuffer('RGB', (CW, CH), buf, 'raw', 'RGB', 0, 1).copy()
    i += 1
p.wait()


def sheet(idx, title, path):
    idx = [k for k in idx if k in grab]
    rows = (len(idx) + COLS - 1) // COLS
    im = Image.new('RGB', (CW * COLS, 44 + rows * (CH + BAR)), '#1b1b1b'); d = ImageDraw.Draw(im)
    d.text((12, 8), title, font=TITLE, fill='#eeeeee')
    for n, k in enumerate(idx):
        x, y = n % COLS * CW, 44 + n // COLS * (CH + BAR)
        im.paste(grab[k], (x, y + BAR))
        d.text((x + 8, y + 3), f'{k / FPS:.2f}s' + ('  切' if k in cuts and k else ''), font=FONT, fill='#f0c27a' if k in cuts else '#dddddd')
    im.save(path)
    return path


files = [sheet(head, '前 3 秒（每 0.25 秒）', out / '开头.png')]
for n, t0 in enumerate(np.arange(0, length, 5), 1):
    files.append(sheet([k for k in body if t0 * FPS <= k < (t0 + 5) * FPS], f'第 {t0:.0f}–{min(t0 + 5, length):.0f} 秒', out / f'接触表_{n:02d}.png'))

# 字幕表
subs, _ = 检查.load_subs(film, timeline)
lines = ['# 字幕表', '', '| 时间 | 字幕 |', '|---|---|'] + [f'| {s["from"]:.1f}–{s["to"]:.1f}s | {" ".join(检查.plain(l) for l in s["行"])} |' for s in subs]
(out / '字幕表.md').write_text('\n'.join(lines) + '\n', encoding='utf-8')

# 声音表：只写听得到的
items = []
ev = film / '草稿' / '音效' / 'events.json'
for e in (json.loads(ev.read_text(encoding='utf-8'))['events'] if ev.exists() else []):
    name = e.get('name') or e['type']
    if len(name) > 3 and name[-3] == '_' and name[-2:].isdigit(): name = name[:-3]   # 同一种声音的第几条（纸摞_03）只写种类
    if e.get('bus') == 'bed':
        d = e.get('args', {}).get('d') or (__import__('soundfile').info(str(ev.parent / e['file'])).duration if e.get('file') else 0)   # 录音素材的环境底没有 args，按文件长度
        items.append((max(0, e['t'] + .4), f'{max(0, e["t"] + .4):.1f}–{e["t"] + d - .4:.1f}s', f'一直有环境声（{name.split("：")[-1]}）'))
    else:
        t = e['t'] + (e['args'].get('d', .35) / 2 if e['type'] == 'whoosh' else 0)
        items.append((t, f'{t:.1f}s', name))
fm_f = film / '草稿' / '配乐地图.json'
if fm_f.exists():
    fm = json.loads(fm_f.read_text(encoding='utf-8'))
    curve = fm.get('响度曲线', [])
    avg = lambda t0, t1: np.mean([v for t, v in curve if t0 <= t < t1] or [0])
    for t in fm.get('换段', []):
        if t >= length: continue
        dv = avg(t, t + 2) - avg(t - 2, t)
        items.append((t, f'{t:.1f}s', '音乐变强' if dv > .08 else '音乐变轻' if dv < -.08 else '音乐换了一段'))
state = json.loads((film / '片子.json').read_text(encoding='utf-8')) if (film / '片子.json').exists() else {}
for dip in (state.get('配乐') or {}).get('压低', []):
    items.append((dip['从'], f'{dip["从"]:.1f}–{dip["到"]:.1f}s', '音乐停下' if dip.get('降', 0) >= 30 else '音乐压低'))
lines = ['# 声音表', '', '审片人听不到声音，这里写观众会听到什么。', '', '| 时间 | 听到 |', '|---|---|'] + [f'| {w} | {s} |' for _, w, s in sorted(items)]
(out / '声音表.md').write_text('\n'.join(lines) + '\n', encoding='utf-8')

print(f'审片包 → {out}（{len(files)} 张图、字幕表、声音表）')
