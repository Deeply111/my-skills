"""找真实录音素材（运行：uv run --no-project --python 3.12 --with-requirements ../requirements.lock python 素材.py ...）。
  检索：python 素材.py 检索 "footsteps stone stairs" "rubber stamp" [--库 bbc,freesound] [--条 12]
        BBC 音效库用它的检索接口（英文关键词最准）；Freesound 只列 CC0（公有领域）的，按下载量排。打印 编号、时长、描述。
  下载：python 素材.py 下载 <片子目录> bbc:07004162 freesound:470710 ...
        存到 <片子>/草稿/音效/原始/（bbc/ 原始 wav；freesound/ 128k 的 mp3 预览，CC0 的不用登录就能下），并把出处和授权追加进 原始/来源.txt。

授权（写进 SKILL.md 规矩 10）：
  BBC 音效库是 RemArc 许可，只能个人、教育、研究用途，不能商用；用了它的片子交片时说明"含 BBC 素材，不可商用"。
  Freesound 只用 CC0，可以随便用，不用署名（来源.txt 照样记）。
下载的是外来文件：只当数据读（音效加工.py 用 pedalboard 解码），不执行。
"""
import argparse, html, json, re, sys, urllib.parse, urllib.request
from pathlib import Path

for _s in (sys.stdout, sys.stderr):
    try: _s.reconfigure(encoding='utf-8', errors='replace')
    except AttributeError: pass

UA = {'User-Agent': 'Mozilla/5.0'}
BBC_API = 'https://sound-effects-api.bbcrewind.co.uk/api/sfx/search'
BBC_WAV = 'https://sound-effects-media.bbcrewind.co.uk/wav/{}.wav'
FS_SEARCH = 'https://freesound.org/search/?'


def bbc(q, n):
    req = urllib.request.Request(BBC_API, data=json.dumps({'criteria': {'from': 0, 'size': n, 'query': q}}).encode(), headers={'Content-Type': 'application/json', **UA})
    r = json.load(urllib.request.urlopen(req, timeout=40))
    return r['total'], [(x['id'], x['duration'] / 1000, x['description']) for x in r['results']]


def freesound(q, n):
    u = FS_SEARCH + urllib.parse.urlencode({'q': q, 'f': 'license:"Creative Commons 0"', 's': 'Downloads (most first)'})
    t = urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=40).read().decode('utf-8', 'replace')
    out = []
    for b in re.findall(r'class="bw-player"(.*?)tabindex', t, re.S)[:n]:
        g = lambda k: (re.search(rf'data-{k}="([^"]*)"', b) or [None, ''])[1]
        out.append((g('sound-id'), float(g('duration') or 0), f'{html.unescape(g("title"))}（下载 {g("num-downloads")}）', g('mp3').replace('-lq.mp3', '-hq.mp3')))
    return out


def fs_preview(sid):
    """Freesound 某个编号的 128k 预览地址（从它的页面读）"""
    t = urllib.request.urlopen(urllib.request.Request(f'https://freesound.org/s/{sid}/', headers=UA), timeout=40).read().decode('utf-8', 'replace')
    m = re.search(r'data-mp3="([^"]+)"', t); lic = re.search(r'creativecommons\.org/(publicdomain/zero|licenses/[a-z-]+)', t)
    title = re.search(r'data-title="([^"]*)"', t)
    if not m: sys.exit(f'freesound:{sid} 找不到预览')
    return m.group(1).replace('-lq.mp3', '-hq.mp3'), (lic.group(1) if lic else '?'), html.unescape(title.group(1)) if title else ''


ap = argparse.ArgumentParser()
sub = ap.add_subparsers(dest='cmd', required=True)
s1 = sub.add_parser('检索'); s1.add_argument('词', nargs='+'); s1.add_argument('--库', default='bbc,freesound'); s1.add_argument('--条', type=int, default=12)
s2 = sub.add_parser('下载'); s2.add_argument('film'); s2.add_argument('编号', nargs='+')
a = ap.parse_args()

if a.cmd == '检索':
    for q in a.词:
        if 'bbc' in a.库:
            total, rs = bbc(q, a.条); print(f'## BBC「{q}」共 {total} 条')
            for i, d, desc in rs: print(f'  bbc:{i:<12} {d:6.1f}s  {desc[:110]}')
        if 'freesound' in a.库:
            rs = freesound(q, a.条); print(f'## Freesound CC0「{q}」')
            for i, d, desc, _ in rs: print(f'  freesound:{i:<8} {d:6.1f}s  {desc[:110]}')
else:
    film = Path(a.film).resolve(); raw = film / '草稿' / '音效' / '原始'
    log = raw / '来源.txt'; raw.mkdir(parents=True, exist_ok=True)
    lines = log.read_text(encoding='utf-8').splitlines() if log.exists() else ['# 原始录音的出处和授权（素材.py 自动写）', '']
    for item in a.编号:
        lib, _, sid = item.partition(':')
        if lib == 'bbc':
            out = raw / 'bbc' / f'{sid}.wav'; url, lic, note = BBC_WAV.format(sid), 'BBC RemArc（个人、教育、研究用途，不可商用）', ''
            try: note = next((d for i, _, d in bbc(sid, 3)[1] if i == sid), '')
            except Exception: pass
        elif lib == 'freesound':
            url, lic, note = fs_preview(sid)
            if 'zero' not in lic: sys.exit(f'freesound:{sid} 不是 CC0（{lic}），不用')
            lic = 'CC0 公有领域'; out = raw / 'freesound' / f'{sid}.mp3'
        else: sys.exit(f'编号要写成 bbc:<编号> 或 freesound:<编号>：{item}')
        out.parent.mkdir(parents=True, exist_ok=True)
        if not out.exists(): out.write_bytes(urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=300).read())
        entry = f'{lib}:{sid}　{lic}　{note[:80]}　→ {out.relative_to(raw).as_posix()}'
        if not any(l.startswith(f'{lib}:{sid}　') for l in lines): lines.append(entry)
        print(f'{item} → {out}（{out.stat().st_size // 1024} KB）')
    log.write_text('\n'.join(lines) + '\n', encoding='utf-8')
    print('出处 →', log)
