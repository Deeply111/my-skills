"""渲染（运行：uv run --no-project --python 3.12 --with-requirements ../requirements.lock python render.py ...）：
把一条片的镜头画成静帧或视频（横屏 1920×1080 为主，片子.json 写 "画幅": "竖" 出 1080×1920；30 帧）。
  --cpu：不用显卡（SwiftShader 软件模拟，慢二三十倍，只用来排查显卡问题）

  静帧：python render.py <片子目录> --stills A3@1.2,B1 [--version board|final] [--out 目录] [--safe]
        A3@1.2 = 镜头 A3 的第 1.2 秒；不写 @ 就是第 0 秒。默认存到 <片子>/草稿/静帧/
        --safe 叠上安全区参考线（自己构图用，交给用户的图不带）
        --label 顶部压镜头标注：镜号、时间码、哪一版（给用户看的动态分镜用）；--label 详 再加卡号、镜头、观众明白（自查用）。成片不带
  视频：python render.py <片子目录> --video <输出.mp4> [--from 秒 --to 秒] [--audio 音频] [--version ...]
        配乐和音效按 片子.json、镜头和画面卡自动做好、混好（脚本/配乐.py、音效.py，统一到 -14 LUFS）；--audio 换成别的音频，同样先统一响度
        按 代码/时间轴.json 播放；码率上限 12M。
  只检查：python render.py <片子目录> --check [--from 秒 --to 秒] [--version ...]
        逐帧画一遍但不出视频，只跑下面的检查。渲视频时也会跑。
  色彩剧本的格子：python render.py <片子目录> --cells <输出目录>
        把 代码/色彩剧本.js 的每一格渲成 01.png、02.png……，格子信息和颜色含义表写进 格子.json。一般由 色彩剧本.py 调用。

页面走本地 HTTP 服务（ES 模块不能从 file:// 加载）：/skill/ 是这个 skill，/film/ 是这条片；浏览器用 Edge 走显卡（D3D11），开头打印显卡名。
页面加载顺序：引擎/第三方（opentype.min.js、budoux-zh-hans.js、gsap、CustomEase）→ 引擎/lib（util、paint、kit、mg）→ 引擎/stage.js、subs.js、camera.js、motion.js、finish.js → 片子.json 里"笔刷库"列出的 引擎/笔刷库/*.js
→ "画风"列出的 <片子>/画风/<画风名>/*.js（只从片子里读，不读 skill 的 画风/）→ 代码/*.js（这条片共用的）→ 代码/镜头/*.js → 引擎/3d.js（ES 模块，three.js；镜头写了 三维: 才渲 3D）。字幕字体用 skill 自带的 字体/NotoSerifSC-VF.ttf（宋体），family 名 "Song"；找不到就不渲，不退回系统字体。
字幕从 画面卡.md 和 代码/时间轴.json 排出来（脚本/检查.py），画在镜头之上（引擎/subs.js）；摄像机和分层视差见 引擎/camera.js。
检查（--video、--check 时跑，脚本/检查.py）：
  字：字幕的断行、强调、读字时间，字幕和登记过的画里的字、关键字的安全区、读字时间、对比度，正在读的字跟着镜头跑得太快；
  摄像机：露边、太快没拖影、推得太猛、动得太小、"接上一镜"切点两边速度对不上；
  配乐：剪点在不在乐句边界、结尾差几秒、切点卡拍、最重的一刻对重拍点、换场对换段、响度；
  动作和质感：落地、预备动作的次数，画面停太久、突然跳动，质感把颜色调偏、色带；
  代码动画常见的毛病：同一帧画两次不一样（没固定种子的随机数）、东西凭空出现或消失、动作提前做完僵住、镜头开头已经动到一半、
    切点前后画面几乎一样却有一块跳了、细线闪烁、推得多的镜头线条变粗、中近层露边、几样东西同时起步一样快、数值算坏（NaN）；
  音效：重击和呼啸的次数、挤在一起、撞上前没留空、画面外、结尾里有音效、混音里可能听不见的、响度起伏。
镜头里标了声音（声: [...]）或画面卡写了环境底，就用 procedural-sfx 混出成品声音（脚本/音效.py），否则只用配乐。
出视频时再查成片文件（脚本/终检.py）：规格、码率、声画对齐、编码后峰值、光敏闪烁。
结论写进 <片子>/草稿/检查.txt，有硬伤时退出码为 1。
脚本只输出结论（文件路径、用的是哪一版），不刷日志。

待做（用到时实现，做成默认行为）：
  - 按镜头缓存：每个镜头单独渲成一段并记指纹（镜头代码、画风文件、引擎），指纹没变就不重渲，最后拼接不重编码
  - 自查用半尺寸（540×960）；交付才渲全尺寸
  - 长片切段并行渲（多开浏览器）
  - --segment 起-止：只渲一段，给用户看问题处
"""
import argparse, base64, json, re, subprocess, sys, threading, time
import 检查, 配乐, 音效, 终检, 画幅
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from urllib.parse import unquote
from pathlib import Path
from playwright.sync_api import sync_playwright

for _s in (sys.stdout, sys.stderr):
    try: _s.reconfigure(encoding='utf-8', errors='replace')
    except AttributeError: pass

SKILL = Path(__file__).resolve().parent.parent
FPS, MAXRATE = 30, 12
FONT = SKILL / '字体' / 'NotoSerifSC-VF.ttf'

ap = argparse.ArgumentParser()
ap.add_argument('film')
ap.add_argument('--stills')
ap.add_argument('--video')
ap.add_argument('--out')
ap.add_argument('--version', choices=['board', 'final'])
ap.add_argument('--from', dest='t0', type=float, default=0)
ap.add_argument('--to', dest='t1', type=float)
ap.add_argument('--audio')
ap.add_argument('--safe', action='store_true')
ap.add_argument('--cells')
ap.add_argument('--check', action='store_true')
ap.add_argument('--label', nargs='?', const='简', choices=['简', '详'])
ap.add_argument('--cpu', action='store_true')
a = ap.parse_args()
film = Path(a.film).resolve()
for k in ('video', 'out'):   # 输出的相对路径按片子目录算：工作目录通常是 skill 的 脚本/，不能写进 skill
    v = getattr(a, k)
    if v and not Path(v).is_absolute(): setattr(a, k, str(film / v))
modes = [m for m, on in (('--stills', a.stills), ('--cells', a.cells), ('--video / --check', a.video or a.check)) if on]
if not modes: sys.exit('要 --stills、--video、--check 或 --cells')
if len(modes) > 1: sys.exit(f'{"、".join(modes)} 一次只能做一样，分开跑')
if a.video and Path(a.video).resolve() == film / f'{film.name}.mp4':
    if a.label: sys.exit('成片不带镜头标注：去掉 --label')
    if a.safe: sys.exit('成片不带安全区参考线：去掉 --safe')

state = json.loads((film / '片子.json').read_text(encoding='utf-8')) if (film / '片子.json').exists() else {}
LAYOUT = 画幅.of_state(state); W, H = LAYOUT['W'], LAYOUT['H']; 检查.set_layout(LAYOUT); 音效.W = W
scripts = [SKILL / '引擎' / '第三方' / n for n in ('opentype.min.js', 'budoux-zh-hans.js', 'gsap/gsap.min.js', 'gsap/CustomEase.min.js')] + [SKILL / '引擎' / 'lib' / n for n in ('util.js', 'paint.js', 'kit.js', 'mg.js')] + [SKILL / '引擎' / 'stage.js', SKILL / '引擎' / 'subs.js', SKILL / '引擎' / 'camera.js', SKILL / '引擎' / 'motion.js', SKILL / '引擎' / 'finish.js']
for name in state.get('笔刷库', []):
    f = SKILL / '引擎' / '笔刷库' / f'{name}.js'
    if not f.exists(): sys.exit(f'片子.json 里的笔刷库不存在：{f}')
    scripts.append(f)
for name in state.get('画风', []):
    d = film / '画风' / name
    if not d.is_dir(): sys.exit(f'片子.json 里的画风不存在：{d}')
    scripts += sorted(d.glob('*.js'))
scripts += sorted((film / '代码').glob('*.js')) + sorted((film / '代码' / '镜头').glob('*.js'))
mods3d = [p for name in state.get('画风', []) for p in sorted((film / '画风' / name / '三维').glob('*.js'))] + sorted((film / '代码' / '三维').glob('*.js'))   # 3D 布景（ES 模块，引擎/3d.js 加载）
timeline = film / '代码' / '时间轴.json'
tl = timeline.read_text(encoding='utf-8') if timeline.exists() else '[]'
ids = [s['id'] for s in json.loads(tl)]
dup = sorted({i for i in ids if ids.count(i) > 1})
if dup: sys.exit(f'时间轴里同一个镜头出现了不止一次：{"、".join(dup)}。要重复用，另登记一个镜头（比如 A3b）')   # 按 id 找镜头的地方（字幕、质感、静帧）只认第一次
subs, sub_notes = 检查.load_subs(film, json.loads(tl))
if a.video or a.check:   # 环境行写错要到混音才报，那时画面已经渲完了，所以开渲之前先查
    bad = 音效.bad_beds(film)
    if bad: sys.exit('画面卡的环境行写错了，开渲之前先改：\n' + '\n'.join('  ' + b for b in bad))

frozen = {f.stem: json.loads(f.read_text(encoding='utf-8')) for f in sorted((film / '代码' / '冻结').glob('*.json'))}   # U.freeze 存的布局（引擎/lib/util.js）
if not FONT.exists(): sys.exit(f'找不到字幕字体：{FONT}')
def url(p):   # 本地文件 → 页面里的地址：skill 下的走 /skill/，片子下的走 /film/
    p = Path(p).resolve()
    for root, pre in ((SKILL, '/skill/'), (film, '/film/')):
        try: return pre + p.relative_to(root).as_posix()
        except ValueError: pass
    sys.exit(f'页面要用的文件不在 skill 或片子目录里：{p}')
glyph_fonts = json.dumps({f'Song-{w}': url(SKILL / '字体' / f'NotoSerifSC-{w}.ttf') for w in (400, 600, 900)})   # 字变形状用的固定字重
font_css = f"@font-face {{ font-family: 'Song'; src: url('{url(FONT)}'); }}"
html = f"""<!doctype html><meta charset="utf-8"><style>{font_css} body{{margin:0;background:#000}}</style>
<canvas id="c" width="{W}" height="{H}"></canvas>
<script>window.STAGE_INIT = {{ W: {W}, H: {H} }}; window.LAYOUT = {json.dumps(LAYOUT, ensure_ascii=False)}; window.SKILL_URL = '/skill/'; window.FILM_URL = '/film/';
window.FROZEN = {json.dumps(frozen, ensure_ascii=False)}; window.S3_FILES = {json.dumps([url(p) for p in mods3d], ensure_ascii=False)};
window.TIMELINE = {tl}; window.SUBS = {json.dumps(subs, ensure_ascii=False)}; window.LABEL = {json.dumps(a.label, ensure_ascii=False)}; window.CARDS = {json.dumps(检查.load_cards(film) if a.label else {}, ensure_ascii=False)}; window.GLYPH_FONTS = {glyph_fonts}; window.SAFE = {'true' if a.safe else 'false'};</script>
""" + ''.join(f'<script src="{url(p)}"></script>\n' for p in scripts) + """<script type="importmap">{"imports":{"three":"/skill/引擎/第三方/three/three.module.min.js","three/addons/":"/skill/引擎/第三方/three/addons/","three/examples/jsm/":"/skill/引擎/第三方/three/addons/","postprocessing":"/skill/引擎/第三方/pp/postprocessing.js","n8ao":"/skill/引擎/第三方/pp/N8AO.js","troika-three-text":"/skill/引擎/第三方/troika/troika-three-text.js","troika-three-utils":"/skill/引擎/第三方/troika/troika-three-utils.js","troika-worker-utils":"/skill/引擎/第三方/troika/troika-worker-utils.js","webgl-sdf-generator":"/skill/引擎/第三方/troika/webgl-sdf-generator.js","bidi-js":"/skill/引擎/第三方/troika/bidi.js","gsap":"/skill/引擎/第三方/gsap/gsap.esm.js"}}</script>
<script type="module" src="/skill/引擎/3d.js"></script>
<script>window.__c = document.getElementById('c').getContext('2d');
// 分镜版每秒只有 12 个画面：和上一帧同一顿（字幕也没在动）就返回 null，Python 端复用上一帧
// 返回 { img（img 为 false 时不出图）, texts 这一帧画的要读的字, cam 摄像机记录, id }；measure 为真时量字的对比度
// img 用质量 1 的 JPEG：0.95 会把 finish.js 防色带的 ±1 抖动抹平（实测成片里平段最长 225 像素，质量 1 是 36，PNG 是 123 且大三倍）
window.__frame = (t, ver, img, measure) => { const s = TIMELINE.find(q => t >= q.from && t < q.to) || TIMELINE[TIMELINE.length - 1], v = SHOTS[s.id];
  const k = ver || ['final', 'board'].find(k => v[k]), key = k === 'board' ? s.id + '@' + Math.floor((t - s.from) * 12 + 1e-6) + '|' + SUBKEY(t, s.id) + (window.LABEL || v.机 && v.机.动(t - s.from, s.to - s.from) ? '@' + t : '') : null;   // 摄像机在动、压着时间码的帧也不复用
  if (key && key === window.__lastKey) return null; window.__lastKey = key;
  window.__MEASURE = measure; drawAt(__c, t, ver); window.__MEASURE = false;
  return { img: img ? document.getElementById('c').toDataURL('image/jpeg', 1).split(',')[1] : null, texts: __TEXTS, cam: window.__CAMREC, id: s.id + (window.__SEG ? '#' + window.__SEG : ''),   // 镜内硬切后的帧当新的一段检查
           motion: __MOTION, moves: window.__MOVES, finish: window.__FINISHREC, diff: window.__DIFFV, nan: window.__NANREC, lt: t - s.from, ver: k,
           fresh: window.__FRESH }; };   // fresh：这一帧换了一张画（一顿一顿的画风停住的帧不算），动作和代码动画的检查只拿换了画的帧比前后
// 和上一帧差多少，在加质感之前量（颗粒每帧都变）。返回 { 全 整幅平均（0–255，缩成 1/20 比）, 块 48 块各自的平均（查局部凭空出现、消失）, 闪 细线闪烁的像素占比 }
// 细线闪烁：缩成半尺寸的灰度，连续四帧里同一个像素亮、暗、亮（或反过来）来回翻，每次差 12 以上；一根线扫过去只翻一次，来回翻的是锯齿和波纹
// 缩略图按画幅：竖屏 54×96（6 列 8 行分块）、横屏 96×54（8 列 6 行），每块都是 9×12 或 12×9 像素
const __TW = STAGE.W / 20, __TH = STAGE.H / 20, __BC = STAGE.W > STAGE.H ? 8 : 6, __BW = __TW / __BC, __BH = __TH / (48 / __BC), __HW = STAGE.W / 2, __HH = STAGE.H / 2;
const __th = Object.assign(document.createElement('canvas'), { width: __TW, height: __TH }), __tg = __th.getContext('2d', { willReadFrequently: true }); let __prev = null;
const __hh = Object.assign(document.createElement('canvas'), { width: __HW, height: __HH }), __hg = __hh.getContext('2d', { willReadFrequently: true }), __hist = [];
window.__diff = c => { __tg.drawImage(c.canvas, 0, 0, __TW, __TH); const d = __tg.getImageData(0, 0, __TW, __TH).data; let s = 0; const blk = new Array(48).fill(0);
  if (__prev) for (let i = 0; i < d.length; i += 4) { const v = Math.abs(d[i] - __prev[i]) + Math.abs(d[i + 1] - __prev[i + 1]) + Math.abs(d[i + 2] - __prev[i + 2]), p = i >> 2;
    s += v; blk[((p / __TW | 0) / __BH | 0) * __BC + ((p % __TW) / __BW | 0)] += v; }
  __prev = d.slice();
  __hg.drawImage(c.canvas, 0, 0, __HW, __HH); const e = __hg.getImageData(0, 0, __HW, __HH).data, g = new Uint8Array(__HW * __HH);
  for (let i = 0, p = 0; p < g.length; i += 4, p++) g[p] = (e[i] * 77 + e[i + 1] * 150 + e[i + 2] * 29) >> 8;
  __hist.push(g); if (__hist.length > 4) __hist.shift();
  let flick = 0;
  if (__hist.length === 4) { const [a, b, q, r] = __hist;
    for (let p = 0; p < g.length; p++) { const d1 = b[p] - a[p], d2 = q[p] - b[p], d3 = r[p] - q[p];
      if (d1 * d2 < 0 && d2 * d3 < 0 && Math.abs(d1) > 12 && Math.abs(d2) > 12 && Math.abs(d3) > 12) flick++; } }
  return { 全: s / (__TW * __TH * 3), 块: blk.map(v => +(v / (__BW * __BH * 3)).toFixed(2)), 闪: flick / g.length }; };
// 同一帧画两次一样不一样：先画别的时刻打乱状态，再画回来比像素。不一样就是用了没固定种子的随机数，或者画法依赖上一帧
window.__same = (t, other, ver) => { const c = __c, read = () => c.getImageData(0, 0, c.canvas.width, c.canvas.height).data;
  drawAt(c, t, ver); const a = read(); drawAt(c, other, ver); drawAt(c, t, ver); const b = read(); let n = 0;
  for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 6) n++;
  return n / (a.length / 4); };
// 所有镜头里标的声音，换算成全片时间（音效.py）
window.__SFX = () => TIMELINE.flatMap(s => ((SHOTS[s.id] || {}).声 || []).map(e => Object.assign({}, e, { 全片t: s.from + e.t, 镜头: s.id })));
window.__ready = Promise.all([document.fonts.load("600 58px Song"), MG.loadGlyphFonts(), new Promise(r => { const w = () => window.S3 ? r(window.S3.ready) : setTimeout(w, 20); w(); })]).then(([f, , s3]) => s3 !== true ? String(s3) : f.length > 0 ? (checkSubGlyphs(), true) : '字幕字体没加载上', e => String(e));   // s3：3D 布景建好没有</script>"""
# 本地 HTTP 服务：/page.html 是这一页，/skill/ 和 /film/ 各指一个目录
class _H(SimpleHTTPRequestHandler):
    extensions_map = dict(SimpleHTTPRequestHandler.extensions_map, **{'.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json'})
    def log_message(self, *a): pass
    def translate_path(self, path):
        p = unquote(path.split('?', 1)[0])
        for pre, root in (('/skill/', SKILL), ('/film/', film)):
            if p.startswith(pre): return str(root / p[len(pre):])
        return str(SKILL / '__没有这个文件__')
    def do_GET(self):
        if self.path.split('?', 1)[0] != '/page.html': return super().do_GET()
        b = html.encode('utf-8'); self.send_response(200); self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Content-Length', str(len(b))); self.end_headers(); self.wfile.write(b)
ThreadingHTTPServer.request_queue_size = 128   # 页面一次并发几十个请求，默认队列 5 会被拒绝连接
srv = ThreadingHTTPServer(('127.0.0.1', 0), _H); threading.Thread(target=srv.serve_forever, daemon=True).start()
PAGE = f'http://127.0.0.1:{srv.server_address[1]}/page.html'
GPU_ARGS = ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--force_high_performance_gpu']   # 走显卡；SwiftShader 软件模拟慢二三十倍
CPU_ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']

errors, n_hard = [], 0
with sync_playwright() as pw:
    try: b = pw.chromium.launch(channel=None if a.cpu else 'msedge', args=CPU_ARGS if a.cpu else GPU_ARGS)
    except Exception: b = pw.chromium.launch(args=CPU_ARGS if a.cpu else GPU_ARGS)   # 没有 Edge 就用 Playwright 自带的 Chromium
    pg = b.new_page(viewport={'width': W, 'height': H})
    # 镜头脚本先于 3D 引擎加载，顶层碰 S3、V3、THREE 就是这个错；报错本身看不出原因
    pg.on('pageerror', lambda e: errors.append(str(e) + ('（镜头脚本的顶层不能用 S3、V3、THREE：它们后加载，放进 三维: 函数里，或者写成纯对象）' if re.search(r'\b(S3|V3|THREE) is not defined', str(e)) else '')))
    pg.on('console', lambda m: m.type == 'error' and 'Failed to load resource' not in m.text and errors.append(m.text))
    pg.on('response', lambda r: r.status >= 400 and not r.url.endswith('/favicon.ico') and errors.append(f'缺文件（{r.status}）：{unquote(r.url)}'))
    pg.goto(PAGE)
    gpu = pg.evaluate("(() => { const g = document.createElement('canvas').getContext('webgl2'); if (!g) return '拿不到 WebGL2'; const e = g.getExtension('WEBGL_debug_renderer_info'); return e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : g.getParameter(g.RENDERER); })()")
    if not a.cpu and any(k in gpu.lower() for k in ('swiftshader', 'basic render', 'llvmpipe')): print(f'注意：没拿到显卡，在用软件模拟（{gpu}），会慢二三十倍', flush=True)
    print(f'{W}×{H}（{LAYOUT["画幅"]}屏）  显卡：{gpu}', flush=True)
    ok = pg.evaluate('window.__ready')
    if ok is not True: sys.exit(f'页面没准备好：{ok}' + ''.join('\n  ' + e for e in errors))   # 带上控制台的报错（3D 布景出错时有堆栈）
    if errors: sys.exit('页面报错，拒绝渲染：\n' + '\n'.join(errors))
    ver = json.dumps(a.version)
    if a.cells:
        n = pg.evaluate('COLORSCRIPT_CELLS.length')
        if not n: sys.exit('没有色彩剧本的格子：代码/色彩剧本.js 里用 COLORSCRIPT([...]) 登记')
        out = Path(a.cells); out.mkdir(parents=True, exist_ok=True)
        for old in out.glob('*.png'): old.unlink()
        cells = []
        for i in range(n):
            cells.append(pg.evaluate(f'drawCell(__c, {i})'))
            png = pg.evaluate("document.getElementById('c').toDataURL('image/png').split(',')[1]")
            (out / f'{i + 1:02d}.png').write_bytes(base64.b64decode(png))
        (out / '格子.json').write_text(json.dumps({'格子': cells, '颜色含义': pg.evaluate('window.MEANING || {}')}, ensure_ascii=False, indent=1), encoding='utf-8')
        print(f'{n} 格 → {out}')
    elif a.stills:
        out = Path(a.out) if a.out else film / '草稿' / '静帧'; out.mkdir(parents=True, exist_ok=True)
        for item in a.stills.split(','):
            sid, _, lt = item.partition('@'); lt = float(lt or 0)
            used = pg.evaluate(f'drawShot(__c, {json.dumps(sid)}, {lt}, {ver})')
            png = pg.evaluate("document.getElementById('c').toDataURL('image/png').split(',')[1]")
            f = out / f'{sid}@{lt:g}.png'; f.write_bytes(base64.b64decode(png))
            print(f'{f}（{used}版）')
    else:
        if tl == '[]': sys.exit('没有 代码/时间轴.json，渲不了视频')
        t1 = a.t1 if a.t1 is not None else max(s['to'] for s in json.loads(tl))
        for q, p in zip(subs, pg.evaluate('SUBS.map(s => SUBPLAN(s))')): q['进'] = p['进']   # 每条字幕出场要多久（处理不同不一样），读字下限要算进去
        hard, warn = 检查.static_checks([q for q in subs if q['to'] > a.t0 and q['from'] < t1])
        length, raw = max(s['to'] for s in json.loads(tl)), pg.evaluate('__SFX()')
        wav, fm, h0, w0 = 配乐.build(film, length, 音效.hits(raw))
        hard += h0; warn += w0 + 配乐.checks(film, fm, json.loads(tl)) + 检查.rhythm(json.loads(tl))
        warn += [f'镜头 {i} 字幕写了"自动"却没报 regions：平涂的、和背景一样亮的主体引擎认不出，字会压到主体上' for i in
                 pg.evaluate("Object.entries(SHOTS).filter(([i, v]) => (v.字幕 === '自动' || (v.字幕 && v.字幕.自动)) && !v.regions && TIMELINE.some(s => s.id === i)).map(([i]) => i)")]
        mixed, h1, w1 = 音效.build(film, json.loads(tl), raw, length, wav, fm)
        hard += h1; warn += w1
        audio = str(mixed or wav)
        if a.audio:   # 换成别的音频：同样统一到 -14 LUFS、峰值 -1 dBTP
            audio = film / '草稿' / '换的声音.wav'
            h4, w4 = 配乐.normalize(['-i', str(Path(a.audio).resolve())], audio)
            hard += h4; warn += w4; audio = str(audio)
        hard += 检查.random_calls(scripts, SKILL / '引擎')
        fc = 检查.FrameChecks()   # 每秒几张按镜头变（几种画风、分镜版），逐帧从页面取
        if a.video:
            out = Path(a.video); out.parent.mkdir(parents=True, exist_ok=True)
            tmp = out.with_suffix('.noaudio.mp4')
            enc = ['-vf', 'scale=out_color_matrix=bt709:out_range=tv,setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv', '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p',   # setparams：新版 ffmpeg 会悄悄忽略 -color_primaries、-color_trc，色彩标记只能在滤镜链里标
                   '-movflags', '+faststart',
                   '-maxrate', f'{MAXRATE}M', '-bufsize', f'{MAXRATE}M']   # bufsize = maxrate，平均码率才压得住；按 BT.709 转换并标上，手机才不会把颜色解偏
            ff = subprocess.Popen(['ffmpeg', '-y', '-v', 'error', '-f', 'image2pipe', '-framerate', str(FPS), '-c:v', 'mjpeg', '-i', '-'] + enc + [str(tmp)],
                                  stdin=subprocess.PIPE)
        n0, n1, st = round(a.t0 * FPS), round(t1 * FPS), time.time()
        img, last = json.dumps(bool(a.video)), None
        for i in range(n0, n1):
            r = pg.evaluate(f"__frame({i / FPS}, {ver}, {img}, {json.dumps(i % 15 == 0)})")   # 分镜版同一顿的帧返回 None，复用上一帧
            if r is None and last is None: r = pg.evaluate(f"(window.__lastKey = null, __frame({i / FPS}, {ver}, {img}, false))")
            if r is not None: last = dict(r, img=base64.b64decode(r['img']) if r['img'] else None)
            fc.add(i, last['id'], last['texts'], last['cam'])
            fc.picture(i, last['id'], last, r is not None and r['fresh'])
            if a.video: ff.stdin.write(last['img'])
            if (i - n0) % 150 == 0: print(f'{i}/{n1}  {time.time() - st:.0f}s', flush=True)
        # 同一帧画两次一样不一样：每个镜头中间取一帧，先画上一个镜头打乱状态再画回来
        shots = [s for s in json.loads(tl) if s['to'] > a.t0 and s['from'] < t1]
        for j, s in enumerate(shots):
            mid = round((max(s['from'], a.t0) + min(s['to'], t1)) / 2 * FPS) / FPS
            other = shots[j - 1]['from'] if j else (shots[1]['from'] if len(shots) > 1 else s['from'])
            fc.same(s['id'], mid, pg.evaluate(f'__same({mid}, {other}, {ver})'))
        if a.video:
            ff.stdin.close(); ff.wait()
            subprocess.run(['ffmpeg', '-y', '-v', 'error', '-i', str(tmp), '-ss', str(a.t0), '-t', str(t1 - a.t0), '-i', audio,
                            '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '256k', '-ar', '48000', '-ac', '2', '-movflags', '+faststart', '-shortest', str(out)], check=True)   # 合声音这一步也要带 faststart，不然索引又回到文件末尾
            tmp.unlink()
            print('完成 →', out)
            h3, w3 = 终检.run(out, LAYOUT)
            hard += h3; warn += w3
        h2, w2 = fc.result(n1 - 1 if t1 < max(s['to'] for s in json.loads(tl)) - 1e-6 else None)
        n_hard = 检查.report(film, hard + h2, warn + w2, sub_notes)
    new = pg.evaluate('window.__FREEZE_NEW || {}')   # 这次第一次算出来的冻结布局，存下来以后只读
    for k, v in new.items():
        d = film / '代码' / '冻结'; d.mkdir(parents=True, exist_ok=True); (d / f'{k}.json').write_text(json.dumps(v, ensure_ascii=False), encoding='utf-8'); print(f'冻结布局 → {d / k}.json')
    b.close()
srv.shutdown()
if errors: sys.exit('页面报错：\n' + '\n'.join(errors))
if (a.video or a.check) and n_hard: sys.exit(1)
