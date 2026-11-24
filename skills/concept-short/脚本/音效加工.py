"""把原始录音做成能直接用的音效片段（运行：uv run --no-project --python 3.12 --with-requirements ../requirements.lock python 音效加工.py <片子目录>）。
读 <片子>/代码/音效素材.json，从 <片子>/草稿/音效/原始/ 取录音（素材.py 下载的），用 pedalboard 切、变调、均衡、压缩、套真实空间的回响，
写成 <片子>/草稿/音效/素材/<名>.wav（48k 立体声，峰值 -1 dBFS），再量出每条"响起"和"最响"在第几秒，存进 素材/对齐.json（音效.py 按它对齐画面）。
同一个配方每次做出来都一样（随机按名字定种子）。改了配方再跑一遍就行。

音效素材.json：
{ "空间": ["教堂", .2],                          ← 默认的空间回响和湿声比例（skill 的 音效/空间/ 里有的：教堂、大厅），风格卡里定
  "素材": {
    "盖章_0": { "源": "freesound/470710.mp3", "切": [.45, 1.1], "变调": -3, "低架": [140, 6], "空间": ["大厅", .22] },
    "脚步":   { "源": "bbc/07004162.wav", "点": [4.63, 5.26, 5.88], "前": .025, "后": .42, "变调": -2.2, "变调随机": .6,
                "叠": [{ "源": "freesound/527698.mp3", "随机切": [4, 40], "长": .4, "偏": -.17, "增益": .12, "高通": 500 }] },
    "风_石原": { "层": [{ "源": "bbc/NHU05039063.wav", "切": [2, 62], "增益": .8 }, { "源": "freesound/825860.mp3", "切": [2, 62], "增益": .55 }],
                "高通": 45, "低通": 5200, "压缩": [-24, 2], "电平": -10 }
  } }
每条素材可以写：
  源 + 切 [起, 止]（秒）或 点 [...]（从录音的这几个时刻各切一段，做成 名_00、名_01……，前/后 是每个点往前、往后取多少秒）；
  层 [...]：几条录音叠成一条（每层可写 源、切、增益、偏 起点偏移秒、以及下面任何处理）；叠 [...]：在主声音上再叠（偏 可以是负数：比主声音早）
  处理：变调（半音）、变调随机（每段在 ± 这么多半音里随机）、高通、低通、低架 [频率, dB]、高架 [频率, dB]、压缩 [门限 dB, 比]、
        空间 [名, 湿] 或 false（不要回响）、倒放 true、淡入、淡出（秒）、补尾（结尾补多少秒静音给回响拖尾）、电平（峰值 dBFS，默认 -1）
"""
import json, sys, zlib
from pathlib import Path
import numpy as np
from pedalboard import Pedalboard, PitchShift, LowpassFilter, HighpassFilter, LowShelfFilter, HighShelfFilter, Convolution, Compressor
from pedalboard.io import AudioFile

for _s in (sys.stdout, sys.stderr):
    try: _s.reconfigure(encoding='utf-8', errors='replace')
    except AttributeError: pass

SKILL = Path(__file__).resolve().parent.parent
SR = 48000
film = Path(sys.argv[1]).resolve()
cfg_f = film / '代码' / '音效素材.json'
if not cfg_f.exists(): sys.exit(f'没有 {cfg_f}：先写配方（格式见这个脚本开头）')
cfg = json.loads(cfg_f.read_text(encoding='utf-8'))
RAW, OUT = film / '草稿' / '音效' / '原始', film / '草稿' / '音效' / '素材'
OUT.mkdir(parents=True, exist_ok=True)
SPACES = {p.stem: p for p in (SKILL / '音效' / '空间').glob('*.wav')}
_cache = {}


def load(src):
    if src not in _cache:
        p = RAW / src
        if not p.exists(): sys.exit(f'找不到原始录音 {p}：先用 素材.py 下载')
        with AudioFile(str(p)).resampled_to(SR) as a: x = a.read(a.frames)
        _cache[src] = np.vstack([x, x]) if x.shape[0] == 1 else x[:2]
    return _cache[src]


def cut(x, a, b, fi=.004, fo=.05):
    y = x[:, max(0, int(a * SR)):int(b * SR)].copy(); n = y.shape[1]
    k = min(int(fi * SR), n); y[:, :k] *= np.linspace(0, 1, k) if k else 1
    k = min(int(fo * SR), n); y[:, n - k:] *= np.linspace(1, 0, k) ** 2 if k else 1
    return y


def chain(o, rnd):
    fx = []
    p = o.get('变调', 0) + (rnd.uniform(-o['变调随机'], o['变调随机']) if o.get('变调随机') else 0)
    if p: fx.append(PitchShift(p))
    if o.get('高通'): fx.append(HighpassFilter(o['高通']))
    if o.get('低通'): fx.append(LowpassFilter(o['低通']))
    if o.get('低架'): fx.append(LowShelfFilter(*o['低架']))
    if o.get('高架'): fx.append(HighShelfFilter(*o['高架']))
    if o.get('压缩'): fx.append(Compressor(o['压缩'][0], o['压缩'][1], 40, 400))
    return fx


def space(o):
    sp = o.get('空间', cfg.get('空间'))
    if not sp: return []
    if sp[0] not in SPACES: sys.exit(f'没有空间回响「{sp[0]}」：skill 的 音效/空间/ 里有 {"、".join(SPACES) or "（空）"}')
    return [Convolution(str(SPACES[sp[0]]), mix=sp[1])]


def piece(o, rnd, a=None, b=None):
    """一段：切（或用给定的 a, b）→ 处理"""
    x = load(o['源'])
    if a is None:
        if o.get('随机切'): a = rnd.uniform(*o['随机切']); b = a + o.get('长', .4)
        else: a, b = o.get('切', [0, x.shape[1] / SR])
    y = cut(x, a, b, o.get('淡入', .004), o.get('淡出', .05))
    fx = chain(o, rnd)
    return Pedalboard(fx)(y, SR) if fx else y


def mix(parts):   # [(x, 起点秒, 增益)]，起点可以是负数（整体往后挪）
    lo = min(0, min(o for _, o, _ in parts)); n = max(int((o - lo) * SR) + p.shape[1] for p, o, _ in parts); y = np.zeros((2, n))
    for p, o, g in parts: i = int((o - lo) * SR); y[:, i:i + p.shape[1]] += p * g
    return y, -lo


def build(name, o, rnd, a=None, b=None):
    if o.get('层'): main, shift = mix([(piece(L, rnd), L.get('偏', 0), L.get('增益', 1)) for L in o['层']])
    else: main, shift = piece(o, rnd, a, b), 0
    parts = [(main / (np.abs(main).max() + 1e-9), 0, 1)]
    for L in o.get('叠', []):
        q = piece(L, rnd); parts.append((q / (np.abs(q).max() + 1e-9), L.get('偏', 0), L.get('增益', 1)))
    y, _ = mix(parts) if len(parts) > 1 else (parts[0][0], 0)
    if o.get('层'):   # 层的整体处理（高通、低通、压缩……）在叠完以后做
        fx = chain({k: v for k, v in o.items() if k not in ('变调', '变调随机')}, rnd)
        if fx: y = Pedalboard(fx)(y, SR)
    y = np.hstack([y, np.zeros((2, int(o.get('补尾', .6 if space(o) else 0) * SR)))])
    sp = space(o)
    if sp: y = Pedalboard(sp)(y, SR)
    if o.get('倒放'): y = y[:, ::-1].copy()
    y = y * (10 ** (o.get('电平', -1) / 20) / (np.abs(y).max() + 1e-9))
    with AudioFile(str(OUT / f'{name}.wav'), 'w', SR, 2) as f: f.write(y.astype(np.float32))
    m = np.abs(y).max(0); pk = m.max()
    return {'响起': round(float(np.argmax(m > pk * .2)) / SR, 3), '最响': round(float(np.argmax(m)) / SR, 3), '长': round(y.shape[1] / SR, 3)}


align = {}
for name, o in cfg['素材'].items():
    rnd = np.random.default_rng(zlib.crc32(name.encode('utf-8')))   # 随机按名字定种子：改别的素材不影响这一条
    if o.get('点'):
        for k, h in enumerate(o['点']):
            align[f'{name}_{k:02d}'] = build(f'{name}_{k:02d}', o, rnd, h - o.get('前', .02), h + o.get('后', .4))
    else: align[name] = build(name, o, rnd)
(OUT / '对齐.json').write_text(json.dumps(align, ensure_ascii=False, indent=1), encoding='utf-8')
print(f'{len(align)} 条 → {OUT}')
for k, v in align.items(): print(f'  {k:14s} 长 {v["长"]:5.2f}s  响起 {v["响起"]:.3f}s  最响 {v["最响"]:.3f}s')
