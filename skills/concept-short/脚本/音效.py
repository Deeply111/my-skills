"""音效：把镜头里标的声音和每场的环境底汇总成音效表，交给 procedural-sfx 合成、和配乐一起混，统一响度。render.py 调用。
需要 procedural-sfx skill（~/.claude/skills/procedural-sfx）；这个 skill 自己的配方在 音效/配方.py。

镜头里标声音（t 是镜头内的秒数，和动画用同一个数）：
  SHOT('B3', { 声: [{ t: 2.1, 类: 'thump', 参数: { f: 60 }, 增益: .6, x: 540, 层: 1, 名: '木箱落地' }], board: ... })
  类 = procedural-sfx 的配方名（click clack crash thump step creak whoosh ding pop rumble heartbeat ……）或 音效/配方.py 里的；
  增益 0–1，不写 0.5；x 是声音在画面上的横向位置，左右按它轻轻分开（手机外放大多是单声道，左右只做一点点，不靠它传达信息）；
  层 是它画在哪一层的景深系数（远 0.3、中 1、近 1.6），远的声音小。
  whoosh 的 t 写动作最快、离镜头最近的那一帧，声音会自动提前一半长度起（最响的点落在那一帧）。
每场的环境底：画面卡里场的开头写一行"环境：风"（风、室内、夜、水，或任何配方名；可以跟强度，"环境：风 0.3"）。

真实录音（v4）：先用 脚本/素材.py 找、下载，再用 脚本/音效加工.py 按 代码/音效素材.json 做成 草稿/音效/素材/<名>.wav，镜头里这样标：
  声: [{ t: 2.1, 素材: '盖章_0', 增益: .7, x: 900, 对齐: '响起', 让: true }]
  对齐：'响起'（默认）t 是声音响起来的那一帧，'最响' t 是最响的那一帧（风声、呼啸对准切点用这个）；按 素材/对齐.json 里量好的偏移自动往前挪。
  让: true 这个声音响时配乐让开 3.5 dB（脚步、落地、盖章这类要听清的瞬态）。
  环境底也可以是素材："环境：风_石原"，取那条录音从头开始的一段，铺满这一场、首尾淡 0.8 秒；强度当增益（默认 1）。
"""
import json, os, re, subprocess, sys
from pathlib import Path

SKILL = Path(__file__).resolve().parent.parent
SFX = Path.home() / '.claude' / 'skills' / 'procedural-sfx' / 'scripts'
W, FPS = 1920, 30   # W 是画面宽（声音左右按它分）；render.py 按片子的画幅改：音效.W = W
HEAVY = {'crash', 'explosion', 'thump'}   # 重击：全片两次左右，配乐让一下，撞上之前留一小段空
BED_GAIN = .06
DUCK_DB = 3.5   # 标了 让 的声音响时配乐让多少


def assets(film):
    d = film / '草稿' / '音效' / '素材'
    f = d / '对齐.json'
    return d, (json.loads(f.read_text(encoding='utf-8')) if f.exists() else {})


def scenes(film):
    """画面卡每场的"环境："那一行"""
    f, out, scene = film / '画面卡.md', [], None
    for line in (f.read_text(encoding='utf-8').splitlines() if f.exists() else []):
        m = re.match(r'##\s+场\s*(\S+)', line)
        if m: scene = {'场': m.group(1), '卡': [], '环境': None}; out.append(scene); continue
        m = re.match(r'###\s*(\S+)[\s　]', line)
        if m and scene: scene['卡'].append(m.group(1)); continue
        m = re.match(r'\s*环境[:：]\s*(\S+)\s*([\d.]+)?', line)
        if m and scene and not scene['卡']: scene['环境'] = (m.group(1), float(m.group(2)) if m.group(2) else None)
    return out


def bad_beds(film):
    """环境行写的既不是录音素材，也不是配方：混音时才会失败。返回要改的地方；找不到 procedural-sfx 时不查（混音那一步会报）"""
    if not (SFX / 'recipes.py').exists(): return []
    code = (SFX / 'recipes.py').read_text(encoding='utf-8') + (SKILL / '音效' / '配方.py').read_text(encoding='utf-8')
    recipes = set(re.findall(r'^def\s+(\w+)', code, re.M)) | set(re.findall(r'["\'](\w+)["\']\s*:', code))
    f = film / '代码' / '音效素材.json'; planned = set(json.loads(f.read_text(encoding='utf-8')).get('素材', {})) if f.exists() else set()   # 配方写了、还没加工出来的素材也算
    ad = assets(film)[0]
    return [f'场 {s["场"]}「环境：{s["环境"][0]}」不是录音素材，也不是配方。想法写到"声音想法："，这里只写素材名或配方名（风、室内、夜、水……）'
            for s in scenes(film) if s['环境'] and s['环境'][0] not in recipes and s['环境'][0] not in planned and not (ad / f'{s["环境"][0]}.wav').exists()]


def beds(film, timeline):
    """每场的环境行 → 环境底事件"""
    ev, (ad, _) = [], assets(film)
    for sc in scenes(film):
        ts = [(s['from'], s['to']) for s in timeline if str(s.get('卡')) in sc['卡']]
        if not sc['环境'] or not ts: continue
        a, b = min(t[0] for t in ts), max(t[1] for t in ts)
        name, k = sc['环境']
        if (ad / f'{name}.wav').exists():   # 录音素材当环境底：裁成这一场的长度，首尾淡 0.8 秒
            import numpy as np, soundfile as sf
            x, sr = sf.read(str(ad / f'{name}.wav'), always_2d=True); n = int((b - a + .8) * sr)
            if len(x) < n: x = np.tile(x, (n // len(x) + 1, 1))
            x = x[:n].copy(); fd = int(.8 * sr); ramp = np.linspace(0, 1, fd)[:, None]; x[:fd] *= ramp; x[-fd:] *= ramp[::-1]
            seg = ad / f'_环境_场{sc["场"]}.wav'; sf.write(str(seg), x, sr)
            ev.append({'t': round(max(0, a - .4), 3), 'type': 'file', 'file': f'素材/{seg.name}', 'gain': k if k is not None else 1.0, 'bus': 'bed', 'name': f'场 {sc["场"]} 环境：{name}'})
            continue
        args = {'d': round(b - a + .8, 3)}   # 多 0.8 秒，和下一场的底交叠着淡过去
        if k is not None and name == '风': args['强'] = k
        ev.append({'t': round(max(0, a - .4), 3), 'type': name, 'args': args, 'gain': BED_GAIN, 'bus': 'bed', 'name': f'场 {sc["场"]} 环境：{name}'})
    return ev


def convert(raw, timeline, film=None):
    """页面汇总的声音 → procedural-sfx 的事件；顺手查定义错误。返回 (事件, 硬伤)"""
    ev, hard = [], []
    ad, align = assets(film) if film else (None, {})
    for e in raw:
        shot = next(s for s in timeline if s['id'] == e['镜头'])
        nm = e.get('名') or e.get('素材') or e.get('类')
        if not 0 <= e['t'] <= shot['to'] - shot['from'] + 1e-6: hard.append(f'镜头 {e["镜头"]} 的声音「{nm}」在镜内 {e["t"]} 秒，超出了这一镜（{shot["to"] - shot["from"]:.2f} 秒）')
        t, args = e['全片t'], dict(e.get('参数') or {})
        gain = e.get('增益', .5)
        if e.get('层') is not None: gain *= min(1.25, max(.5, .5 + .5 * (e['层'] - .3) / .7))
        if e.get('素材'):   # 真实录音：按量好的起响点或峰值往前挪，让"响起/最响"落在 t 上
            m = e['素材']
            if not ad or not (ad / f'{m}.wav').exists(): hard.append(f'镜头 {e["镜头"]} 用了素材「{m}」，但 草稿/音效/素材/{m}.wav 不存在：先跑 脚本/音效加工.py'); continue
            off = (align.get(m) or {}).get('最响' if e.get('对齐') == '最响' else '响起', 0)
            x = {'t': round(t - off, 4), 'type': 'file', 'file': f'素材/{m}.wav', 'gain': round(gain, 3), 'name': nm, 'bus': 'bed' if e.get('环境') else 'vo' if e.get('让') else 'sfx', '画面t': e['全片t']}   # 环境: true 走环境底（镜内硬切处同一帧换一层环境声）
            if e.get('x') is not None: x['pan'] = round(max(-.3, min(.3, (e['x'] / W * 2 - 1) * .3)), 3)
            ev.append(x); continue
        if e['类'] == 'whoosh': t -= args.get('d', .35) / 2
        x = {'t': round(t, 4), 'type': e['类'], 'args': args, 'gain': round(gain, 3), 'name': nm, '画面t': e['全片t']}
        if e.get('让'): x['bus'] = 'vo'
        if e.get('x') is not None: x['pan'] = round(max(-.3, min(.3, (e['x'] / W * 2 - 1) * .3)), 3)
        ev.append(x)
    return ev, hard


def checks(ev, raw, fm):
    """听得出来的毛病：两个重击挤在一起糊成一下。是提醒"""
    warn, sfx = [], sorted((e for e in ev if e.get('bus') != 'bed'), key=lambda e: e['画面t'])
    hits = [e for e in sfx if e['type'] in HEAVY]
    for a, b in zip(hits, hits[1:]):
        if b['画面t'] - a['画面t'] < 4 / FPS: warn.append(f'两个重击 {a["画面t"]:.2f}s 和 {b["画面t"]:.2f}s 挤在几帧之内，会糊成一下')
    return warn


def build(film, timeline, raw, length, music_wav, fm):
    """混出成品声音：音效 + 环境底 + 配乐，统一响度。返回 (wav 或 None, 硬伤, 提醒)；没有声音也没有环境底就返回 None，只用配乐"""
    ev, hard = convert(raw, timeline, film)
    ev += beds(film, timeline)
    if not ev: return None, hard, []
    if not SFX.exists(): return None, hard + [f'这条片有音效，但找不到 procedural-sfx：{SFX}'], []
    warn = checks(ev, raw, fm)
    d = film / '草稿' / '音效'; d.mkdir(parents=True, exist_ok=True)
    (d / 'events.json').write_text(json.dumps({'dur': round(length, 3), 'events': [{k: v for k, v in e.items() if k != '画面t'} for e in ev]}, ensure_ascii=False, indent=1), encoding='utf-8')
    mix = d / '混音.wav'
    r = subprocess.run([sys.executable, str(SFX / 'mix.py'), str(d / 'events.json'), '-o', str(mix), '--recipes', str(SKILL / '音效' / '配方.py'),
                        '--music', str(Path(music_wav).resolve()), '--duck-db', str(DUCK_DB), '--audition', str(film / '草稿' / '试听')], capture_output=True, text=True, encoding='utf-8', errors='replace',
                       env={**os.environ, 'PYTHONUTF8': '1', 'PYTHONIOENCODING': 'utf-8'})   # 配方文件里有中文，Windows 默认按 GBK 读会出错
    (d / '混音报告.txt').write_text(r.stdout + r.stderr, encoding='utf-8')
    if r.returncode: return None, hard + ['混音失败：' + (r.stderr.strip().splitlines() or ['见 草稿/音效/混音报告.txt'])[-1]], warn
    for line in r.stdout.splitlines():
        if 'CHECK' in line: warn.append('混音：' + line.strip().replace('CHECK', '可能听不见：', 1))
    table = [l for l in r.stdout.splitlines() if l.startswith('|')]
    rec = {}   # 录音素材加工过（变调、均衡、回响），同样没经人耳听过：按素材列出用在哪几秒
    for e in ev:
        if e['type'] == 'file': rec.setdefault(e['file'], []).append(f"{e.get('画面t', e['t']):.2f}")
    n = max(0, len(table) - 2)
    if rec:
        table += ([''] if table else []) + ['| 录音素材 | 用在（秒） | 文件 |', '| --- | --- | --- |'] + \
                 [f"| {Path(f).stem} | {'、'.join(ts[:8])}{'……' if len(ts) > 8 else ''} | 草稿/音效/{f} |" for f, ts in rec.items()]
    if table:
        (film / '草稿' / '试听').mkdir(parents=True, exist_ok=True)
        (film / '草稿' / '试听' / '试听表.md').write_text('# 没经人耳调过的声音（请用户听）\n\n' + '\n'.join(table) + '\n', encoding='utf-8')
        warn.append(f'有 {n + len(rec)} 个声音没经人耳调过（含 {len(rec)} 条录音素材），试听表在 草稿/试听/试听表.md，交片时请用户听')
    import 配乐
    out = film / '草稿' / '成品声音.wav'
    h2, w2 = 配乐.normalize(['-i', str(mix)], out, lra=True)
    return out, hard + h2, warn + w2


def hits(raw):
    """重击的画面时刻：配乐在这里让 3 分贝"""
    return [e['全片t'] for e in raw if e.get('类') in HEAVY]
