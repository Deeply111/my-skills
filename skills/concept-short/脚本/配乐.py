"""配乐：按 片子.json 的设置做出这条片的配乐，写出换算成片子时间的音乐地图，查卡拍。render.py 渲视频和 --check 时调用。
单独跑（第 2 步排时间、试剪音乐时用）：python 配乐.py <片子目录>   → <片子>/草稿/配乐.wav、配乐地图.json，打印检查结论

片子.json：
  "配乐速度": 0.9                       1、0.9、0.8，用 音乐/ 里对应的那一版
  "配乐": {
    "剪": [{ "删": [60.4, 67.87] }, { "重复": [37.89, 45.4] }],
        剪音乐对准关键时刻：删掉或重复整句，时间是 音乐地图.json 上的原速时间，两头都要在乐句边界上；接口交叉淡化 40 毫秒。
        全片最重的一刻离重拍点差 2 秒以内就挪画面，差得多才剪音乐（检查会算出删一句、重复一句各差多少）。
    "压低": [{ "从": 41.0, "到": 43.5, "降": 12 }]
        片子时间；降 30 分贝以上就是停下。降下去 0.3 秒，回来 0.5 秒；音乐在底下照样往前走，节拍不错位。
  }
开头：从第 0 秒放，0.05 秒极短淡入，只防爆音。
结尾：片尾落在最近的强拍上收住，余音 0.75 秒淡完；片尾和它差多少秒会提醒，由画面调。
"""
import json, re, subprocess, sys, tempfile
from pathlib import Path
import numpy as np

SKILL = Path(__file__).resolve().parent.parent
FILES = {1.0: '原速.mp3', 0.9: '0.9倍速.mp3', 0.8: '0.8倍速.mp3'}
SR, FPS = 48000, 30
XF, FADE_IN, TAIL, DOWN, UP = .04, .05, .75, .3, .5
NEAR = 2.0          # 最重的一刻离重拍点差多少秒以内挪画面就行
LUFS, TP = -14, -1  # 响度标准


def settings(film):
    state = json.loads((film / '片子.json').read_text(encoding='utf-8')) if (film / '片子.json').exists() else {}
    speed = float(state.get('配乐速度', 1))
    if speed not in FILES: sys.exit(f'配乐速度只能是 1、0.9、0.8：片子.json 里写的是 {speed}')
    return speed, state.get('配乐', {}) or {}


def plan(mm, cfg):
    """剪辑方案 → 原速时间上的片段 [(起, 止)]，和不在乐句边界上的剪点"""
    bounds, end, bad = [0.0] + mm['乐句'] + [mm['时长']], mm['时长'], []
    edits = sorted(cfg.get('剪', []), key=lambda e: (e.get('删') or e.get('重复'))[0])
    segs, cur = [], 0.0
    for e in edits:
        kind = '删' if '删' in e else '重复'
        a, b = e[kind]
        for x in (a, b):
            if min(abs(x - q) for q in bounds) > .05: bad.append(f'剪{kind} [{a}, {b}] 的 {x} 秒不在乐句边界上（乐句：音乐地图.json 的"乐句"）')
        if a < cur - 1e-6: bad.append(f'剪{kind} [{a}, {b}] 和前一处剪辑重叠'); continue
        segs.append((cur, a))
        if kind == '重复': segs += [(a, b), (a, b)]
        cur = b
    segs.append((cur, end))
    return [s for s in segs if s[1] - s[0] > 1e-6], bad


def to_film(segs, speed):
    """原速时间 → 片子时间（重复的那一句会对应两个时间）"""
    offs, acc = [], 0.0
    for a, b in segs: offs.append(acc); acc += b - a
    return lambda tau: [(o + tau - a) / speed for (a, b), o in zip(segs, offs) if a - 1e-6 <= tau < b - 1e-6 or (b == segs[-1][1] and tau == b)], acc / speed


def film_map(film):
    """换算成片子时间的音乐地图（不解码音频，色彩剧本也用它）"""
    mm = json.loads((SKILL / '音乐' / '音乐地图.json').read_text(encoding='utf-8'))
    speed, cfg = settings(film)
    segs, bad = plan(mm, cfg)
    f, length = to_film(segs, speed)
    conv = lambda xs: sorted(t for x in xs for t in f(x))
    step = mm['曲线间隔秒']
    out = {'说明': '片子时间（已按配乐速度和剪辑换算）', '配乐速度': speed, 'BPM': mm['BPM'], '剪': cfg.get('剪', []), '时长': round(length, 3),
           **{k: [round(t, 3) for t in conv(mm[k])] for k in ('节拍', '强拍', '乐句', '换段', '重拍点')},
           '响度曲线': sorted([round(t, 2), v] for i, v in enumerate(mm['响度曲线']) for t in f(i * step)),
           '剪点': [round(t, 3) for t in np.cumsum([(b - a) / speed for a, b in segs])[:-1]]}
    return out, segs, speed, cfg, bad


def decode(path):
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', str(path), '-f', 'f32le', '-ac', '2', '-ar', str(SR), '-'], capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.float32).reshape(-1, 2).copy()


def splice(src, segs, speed):
    """按剪辑方案拼片段，接口交叉淡化 40 毫秒（等功率）。
    后一段多取接口前的 40 毫秒，和前一段的最后 40 毫秒叠在一起：拼出来的总长不变，每一段的起点都落在 to_film 算的片子时间上，
    剪了几刀拍点也不会漂（重叠的那 40 毫秒如果从总长里扣掉，每刀都会让后面的拍点早 40 毫秒，比一帧还多）"""
    out, n = None, int(XF * SR)
    for a, b in segs:
        i0, i1 = int(round(a / speed * SR)), int(round(b / speed * SR))
        if out is None: out = src[i0:i1]; continue
        k = min(n, len(out), i0)   # 接口前能多取多少（最前面那段前面没有东西）
        piece = src[i0 - k:i1]; w = np.linspace(0, np.pi / 2, k)[:, None]
        out = np.concatenate([out[:len(out) - k], out[len(out) - k:] * np.cos(w) + piece[:k] * np.sin(w), piece[k:]])
    return out


def build(film, length, 让=()):
    """做出配乐 wav（已统一响度），返回 (路径, 地图, 硬伤, 提醒)。length = 片长（秒）；让 = 重击的时刻，配乐在那里让 3 分贝、0.15 秒"""
    fm, segs, speed, cfg, bad = film_map(film)
    hard, warn = list(bad), []
    out = splice(decode(SKILL / '音乐' / FILES[speed]), segs, speed)
    # 结尾：片尾附近最近的强拍收住，余音 0.75 秒
    beats = [t for t in fm['强拍'] if t + TAIL <= fm['时长']]
    if length > fm['时长'] - TAIL: hard.append(f'片长 {length:.1f} 秒，配乐（剪辑后）只有 {fm["时长"]:.1f} 秒：重复一句，或者缩短片子')
    hit = min(beats, key=lambda t: abs(t + TAIL - length))
    end = int(length * SR); out = out[:end] if len(out) >= end else np.concatenate([out, np.zeros((end - len(out), 2), np.float32)])
    t = np.arange(len(out)) / SR
    g = np.clip(t / FADE_IN, 0, 1)
    g *= np.clip(1 - (t - hit) / TAIL, 0, 1) ** 2
    # 压低和停下
    for d in cfg.get('压低', []):
        lo = 0 if d['降'] >= 30 else 10 ** (-d['降'] / 20)
        k = np.clip(np.minimum((t - (d['从'] - DOWN)) / DOWN, ((d['到'] + UP) - t) / UP), 0, 1)
        g *= 1 - (1 - lo) * k
    # 给重击让一下：-3 分贝，0.02 秒压下、保持 0.15 秒、0.15 秒回来
    for h in 让:
        k = np.clip(np.minimum((t - (h - .02)) / .02, ((h + .3) - t) / .15), 0, 1)
        g *= 1 - (1 - 10 ** (-3 / 20)) * k
    out = (out * g[:, None]).astype(np.float32)
    wav = film / '草稿' / '配乐.wav'; wav.parent.mkdir(parents=True, exist_ok=True)
    tmp = Path(tempfile.gettempdir()) / f'cs_music_{film.name}.f32'
    tmp.write_bytes(out.tobytes())
    h2, w2 = normalize(['-f', 'f32le', '-ac', '2', '-ar', str(SR), '-i', str(tmp)], wav)
    tmp.unlink(); hard += h2; warn += w2
    fm['收尾强拍'] = round(hit, 3)
    (film / '草稿' / '配乐地图.json').write_text(json.dumps(fm, ensure_ascii=False, indent=1), encoding='utf-8')
    return wav, fm, hard, warn


def normalize(inp, wav, lra=False):
    """统一响度：先量，再按量到的值一次线性调到 -14 LUFS、峰值 -1 dBTP，再量一遍核对峰值。返回 (硬伤, 提醒)"""
    hard, warn = [], []
    m = loud(inp)
    gain = LUFS - m['input_i']
    if m['input_tp'] + gain > TP - 1: gain = TP - 1 - m['input_tp']   # 峰值先到顶：宁可整体轻一点也不削波；留 1 dB 给 AAC 编码抬高的峰值（实测约 +0.8）
    subprocess.run(['ffmpeg', '-y', '-v', 'error'] + inp + ['-af', f'volume={gain:.2f}dB', '-c:a', 'pcm_s24le', str(wav)], check=True)
    r = loud(['-i', str(wav)])
    if r['input_tp'] > TP + .05: hard.append(f'响度：峰值 {r["input_tp"]:.1f} dBTP，超过 {TP}')
    return hard, warn


def loud(inp):
    err = subprocess.run(['ffmpeg', '-hide_banner', '-nostats'] + inp + ['-af', 'loudnorm=print_format=json', '-f', 'null', '-'], capture_output=True, text=True, encoding='utf-8', errors='replace').stderr
    return {k: float(v) for k, v in json.loads(err[err.rindex('{'):err.rindex('}') + 1]).items() if k in ('input_i', 'input_tp', 'input_lra')}


def checks(film, fm, timeline):
    """卡拍：切点对强拍、最重的一刻对重拍点。都是提醒，返回提醒列表"""
    warn = []
    cuts = sorted({s['from'] for s in timeline if s['from'] > 0})
    off = []
    for c in cuts:
        b = min(fm['强拍'], key=lambda q: abs(q - c)); fr = round((c - b) * FPS)
        if abs(fr) > 2: off.append(f'{c:.2f}s（离强拍 {fr:+d} 帧）')
    if off: warn.append(f'切点卡拍：{len(cuts)} 个切点里 {len(off)} 个离强拍超过 2 帧（理想是早 1 帧，故意错拍的不用管）：' + '、'.join(off[:12]) + ('……' if len(off) > 12 else ''))
    # 画面卡：每张卡的强度
    cards, marked = {}, []
    f = film / '画面卡.md'
    for line in (f.read_text(encoding='utf-8').splitlines() if f.exists() else []):
        m = re.match(r'###\s*(\S+)[\s　]+.*?强度\s*(\d)', line)
        if m:
            cards[m.group(1)] = int(m.group(2))
            if re.search(r'[｜|]\s*最重', line[m.end():]): marked.append(m.group(1))   # 标题行末尾写了「｜最重」：全片最重的一刻
    start = {}
    for s in timeline:
        if '卡' in s: start[str(s['卡'])] = min(start.get(str(s['卡']), 1e9), s['from'])
    have = [k for k in cards if k in start]
    if len(marked) > 1: warn.append(f'最重的一刻：画面卡里标了 {len(marked)} 张（{"、".join(marked)}），只能有一张，先按卡 {marked[0]} 算')
    if have and fm['重拍点']:
        if marked and marked[0] in start: k = marked[0]
        else:
            top = max(cards[k] for k in have); k = next(k for k in have if cards[k] == top)
            warn.append(f'最重的一刻：标的卡 {marked[0]} 时间轴里没有，先按强度最高的第一张卡 {k} 算' if marked else
                        f'最重的一刻：画面卡没标，先按强度最高的第一张卡 {k} 算；在最重的那张卡的标题行末尾写「｜最重」')
        h = start[k]
        r = min(fm['重拍点'], key=lambda q: abs(q - h)); d = h - r
        if abs(d) > 1 / FPS:
            if abs(d) <= NEAR: warn.append(f'最重的一刻：卡 {k} 在 {h:.2f}s，重拍点在 {r:.2f}s，差 {d:+.2f} 秒，挪画面对上')
            else:
                L = 4 * 4 * 60 / fm['BPM'] / fm['配乐速度']   # 一句（4 小节）的长度，片子时间
                # 重拍点之前删 n 句，重拍点提前 n 句；重复 n 句，推后 n 句
                opts = sorted(((abs(d - n * L), n) for n in (-2, -1, 1, 2)))
                best, n = opts[0]
                if best >= abs(d): warn.append(f'最重的一刻：卡 {k} 在 {h:.2f}s，重拍点在 {r:.2f}s，差 {d:+.2f} 秒；一句长 {L:.2f} 秒，剪音乐只会差得更多，挪画面对上')
                else: warn.append(f'最重的一刻：卡 {k} 在 {h:.2f}s，重拍点在 {r:.2f}s，差 {d:+.2f} 秒，挪画面太多；在重拍点之前{"重复" if n > 0 else "删"} {abs(n)} 句，剩下差 {d - n * L:+.2f} 秒再挪画面')
    return warn


if __name__ == '__main__':
    for _s in (sys.stdout, sys.stderr):
        try: _s.reconfigure(encoding='utf-8', errors='replace')
        except AttributeError: pass
    film = Path(sys.argv[1]).resolve()
    tl_file = film / '代码' / '时间轴.json'
    tl = json.loads(tl_file.read_text(encoding='utf-8')) if tl_file.exists() else []
    length = max((s['to'] for s in tl), default=0) or (float(sys.argv[2]) if len(sys.argv) > 2 else 0)
    if not length: sys.exit('没有 代码/时间轴.json，不知道片长：python 配乐.py <片子目录> <片长秒数>')
    wav, fm, hard, warn = build(film, length)
    warn += checks(film, fm, tl)
    print(f'配乐 → {wav}（{fm["配乐速度"]} 倍速，剪辑后 {fm["时长"]:.1f} 秒，收在第 {fm["收尾强拍"]:.2f} 秒的强拍上）')
    for h in hard: print('硬伤：' + h)
    for w in warn: print('提醒：' + w)
