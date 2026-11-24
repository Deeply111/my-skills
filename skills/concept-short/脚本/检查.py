"""渲染时的检查：字幕和画里的字（读字时间、断行、安全区、对比度），摄像机露边，镜头长短，代码动画常见的毛病。
检查是手段：只留观众看得出来、会影响"轻松看、爱看"的毛病，量不出好看不好看。
还负责从画面卡排出字幕。render.py 调用，不单独运行；结论写进 <片子>/草稿/检查.txt。

字幕的字取画面卡标题行（"### <编号>　<字幕>　强度 …"），/ 处断行，【词】是强调；写"（无字幕）"或留空的卡不出字幕。
种类看卡里"字幕处理："那一行：关键字代替 → 不出字幕；心里话；引文；问句、结论、落点 → 问句；都没有 → 普通。
时间看 代码/时间轴.json：字幕从标了这张卡的第一个镜头开始，到最后一个镜头结束。
"""
import json, re, struct, unicodedata
from pathlib import Path

FPS = 30
import 画幅
LAYOUT = 画幅.LAYOUTS['横']; W, H = LAYOUT['W'], LAYOUT['H']
def set_layout(L):   # render.py 读到片子的画幅后调一次：安全区、尺寸都跟着换
    global LAYOUT, W, H
    LAYOUT, W, H = L, L['W'], L['H']
IN, OUT = 0.3, 0.2             # 字幕出场、退场（和 引擎/subs.js 一致）
MAXLINE, MOVE, CONTRAST = 16, 6, 4.5
TREATS = ('意群', '逐字', '重读', '揭示', '浮现')   # 字幕处理的名字（引擎/subs.js 的 TREAT）；卡里"字幕处理："写了哪个就用哪个，都没有就是普通
POP, CALM, FROZEN, FLICK = 6, .3, 1.0, .002   # 局部一帧变化 6 以上、前后不到 0.3 算凭空出现；最后 1 秒冻住；闪烁像素 0.2%
RANDOM = re.compile(r'Math\.random|Date\.now|performance\.now|new Date\(')
MARK = re.compile(r'【([^】|]*)(?:\|[^】]*)?】')
LINE_END = re.compile(r'[。，、；：,.;:]$')   # 行尾不留的标点；问号、叹号带语气，……、—— 是停顿，都留


def font_chars(path):
    """读字体的字符表（cmap 的 format 4 和 12），不额外装库。读不了返回 None"""
    d = Path(path).read_bytes()
    if d[:4] not in (b'\0\1\0\0', b'OTTO', b'true'): return None
    tab = next((struct.unpack('>II', d[12 + i * 16 + 8:12 + i * 16 + 16])[0] for i in range(struct.unpack('>H', d[4:6])[0]) if d[12 + i * 16:12 + i * 16 + 4] == b'cmap'), None)
    if tab is None: return None
    chars = set()
    for i in range(struct.unpack('>H', d[tab + 2:tab + 4])[0]):
        o = tab + struct.unpack('>I', d[tab + 8 + i * 8:tab + 12 + i * 8])[0]; fmt = struct.unpack('>H', d[o:o + 2])[0]
        if fmt == 12:
            for g in range(struct.unpack('>I', d[o + 12:o + 16])[0]):
                a, b, _ = struct.unpack('>III', d[o + 16 + g * 12:o + 28 + g * 12]); chars.update(range(a, b + 1))
        elif fmt == 4:
            n = struct.unpack('>H', d[o + 6:o + 8])[0] // 2; u = lambda p, k: struct.unpack('>H', d[p + k * 2:p + k * 2 + 2])[0]
            end, start, delta, rng = o + 14, o + 16 + n * 2, o + 16 + n * 4, o + 16 + n * 6
            for k in range(n):
                for c in range(u(start, k), u(end, k) + 1):
                    if c == 0xFFFF: continue
                    if u(rng, k) == 0: g = (c + u(delta, k)) & 0xFFFF
                    else:
                        g = u(rng + k * 2 + u(rng, k) + (c - u(start, k)) * 2, 0)
                        if g: g = (g + u(delta, k)) & 0xFFFF
                    if g: chars.add(c)
    return chars


def film_font_notes(film, cards):
    """片内字体（画风/*/字体/）里缺上屏的字：浏览器会悄悄换成系统字体。候选字体没用上也会列出，所以只算说明"""
    need, notes = {ch for c in cards for ch in plain(c['字']) if '\u4e00' <= ch <= '\u9fff'}, []
    for f in sorted(film.glob('画风/*/字体/*')):
        if f.suffix.lower() not in ('.ttf', '.otf'): continue
        chars = font_chars(f)
        if chars is None: notes.append(f'片内字体 {f.name} 读不了，缺字要自己查'); continue
        miss = sorted(ch for ch in need if ord(ch) not in chars)
        if miss: notes.append(f'片内字体 {f.name} 缺「{"".join(miss)}」，用它写这些字会被换成系统字体')
    return notes

def plain(s): return MARK.sub(r'\1', s)
def count(s): return sum(1 for ch in plain(s) if not ch.isspace() and not unicodedata.category(ch).startswith('P'))
def floor(n, tin=IN): return n / 6 + tin + OUT   # 读字下限：出场（普通 0.3 秒，别的处理更长，render.py 从 引擎/subs.js 取）加退场 0.2 秒


def load_subs(film, timeline):
    """返回 (字幕列表, 提醒)"""
    notes, cards = [], []
    f = film / '画面卡.md'
    if not f.exists(): return [], ['没有 画面卡.md，不出字幕']
    cur = None
    for line in f.read_text(encoding='utf-8').splitlines():
        m = re.match(r'###\s*(\S+)[\s　]+(.*?)[\s　]+强度', line)
        if m: cur = {'卡': m.group(1), '字': m.group(2).strip(), '处理': ''}; cards.append(cur); continue
        if re.match(r'###\s*\S', line): notes.append(f'画面卡标题行没写"强度"，这张卡不出字幕：「{line.strip()[:30]}」（格式：### 编号　字幕　强度 3｜难度 ★）')
        if line.startswith('#'): cur = None; continue
        if cur and line.strip().startswith('字幕处理'): cur['处理'] = line
        if cur and re.match(r'\s*关键字[:：]\s*\S', line): cur['世界字'] = True
    if timeline and not any('卡' in s for s in timeline):
        return [], ['时间轴里的镜头都没标"卡"，字幕没排：代码/时间轴.json 每个镜头写上属于哪张画面卡']
    subs = []
    for c in cards:
        if not c['字'] or c['字'] in ('（无字幕）', '—'): continue
        p = c['处理']
        if '关键字代替' in p: continue
        kind = '心里话' if '心里话' in p else '引文' if '引文' in p else '问句' if re.search('问句|结论|落点', p) else '普通'
        shots = [s for s in timeline if str(s.get('卡')) == c['卡']]
        if not shots:
            if timeline: notes.append(f'卡 {c["卡"]} 有字幕，时间轴里没有镜头标这张卡')
            continue
        subs.append({'卡': c['卡'], '行': [l.strip() for l in c['字'].split('/')], '种类': kind, '处理': next((n for n in TREATS if n in p), ''),
                     'from': min(s['from'] for s in shots), 'to': max(s['to'] for s in shots)})
    said = [c for c in cards if c['字'] and c['字'] not in ('（无字幕）', '—')]
    if said and not any('【' in c['字'] for c in said): notes.append('全片没有一个强调词：所有字都一个分量。有要砸下去的词就在画面卡标题行标【】')
    if said and not any('关键字代替' in c['处理'] or c.get('世界字') for c in said): notes.append('全片没有字进入世界：每场想一次，这句的关键词能不能变成这个世界里的东西（参考/字幕.md）')
    return subs, notes + film_font_notes(film, said)


def load_cards(film):
    """镜头标注用：每张卡的"镜头"和"观众明白"两项（取冒号后第一行）"""
    f, out, cur = film / '画面卡.md', {}, None
    for line in (f.read_text(encoding='utf-8').splitlines() if f.exists() else []):
        m = re.match(r'###\s*(\S+)[\s　]', line)
        if m: cur = out.setdefault(m.group(1), {}); continue
        if line.startswith('#'): cur = None; continue
        m = re.match(r'\s*(镜头|观众明白)[:：]\s*(.+)', line)
        if cur is not None and m: cur['明白' if m.group(1) == '观众明白' else '镜头'] = m.group(2).strip()
    return out


def static_checks(subs):
    """不用渲染就能查的：断行、强调、读字时间。返回 (硬伤, 提醒)"""
    hard, warn = [], []
    for s in subs:
        where = f'卡 {s["卡"]}（{s["from"]:.1f}s）'
        body = [l for l in s['行'] if not (s['种类'] == '引文' and l.startswith('——'))]
        if len(body) > 2: hard.append(f'{where} 字幕有 {len(body)} 行，最多两行')
        for l in s['行']:
            if LINE_END.search(plain(l).strip()): hard.append(f'{where} 行尾有标点：「{plain(l)}」，去掉（句中停顿用空格，问号、叹号留着）')
        for l in body:
            if count(l) > MAXLINE: hard.append(f'{where} 一行 {count(l)} 字，超过 {MAXLINE}：「{plain(l)}」，在画面卡里用 / 断开')
            if len(body) > 1 and count(l) <= 2: hard.append(f'{where} 一行只剩「{plain(l)}」，换个地方断行')
        if sum(l.count('【') for l in s['行']) > 1: hard.append(f'{where} 一句强调了不止一处，只留一处')
        n, shown, tin = count(''.join(body)), s['to'] - s['from'], s.get('进', IN)   # 进 = 这条字幕出场要多久，render.py 从页面取（处理不同不一样）
        if shown < floor(n, tin) - 1e-6:
            hard.append(f'{where} 显示 {shown:.2f} 秒，读字下限 {floor(n, tin):.2f} 秒（{n} 字 ÷ 6 + 出场 {tin:.2f} + 退场 {OUT}），差 {floor(n, tin) - shown:.2f} 秒')
    return hard, warn


def rhythm(timeline):
    """镜头长短太平均：六成以上的镜头落在同一个 ±0.5 秒的区间里，看着像节拍器。返回提醒"""
    ds = sorted(round(s['to'] - s['from'], 2) for s in timeline)
    if len(ds) < 6: return []
    best = max(sum(1 for d in ds if c - .5 <= d <= c + .5) for c in ds)
    return [f'镜头长短太平均：{len(ds)} 个镜头里 {best} 个落在同一个 1 秒的区间里，看着像节拍器。按快慢对比拉开（故意整齐的就留着）'] if best >= len(ds) * .6 else []


def random_calls(scripts, engine):
    """镜头、画风、笔刷里用了每次都不一样的数（随机数、当前时间）：同一帧每次画得不一样，画面会自己抖，只重渲几秒也会接不上。返回硬伤"""
    hard = []
    for f in scripts:
        if engine in f.parents and f.parent.name != '笔刷库': continue
        for n, line in enumerate(f.read_text(encoding='utf-8').splitlines(), 1):
            m = RANDOM.search(line.split('//')[0])
            if m: hard.append(f'{f.name} 第 {n} 行用了 {m.group(0)}：每次画得不一样，画面会自己抖。换成 U.rng(种子)，或者按时间算')
    return hard


def in_safe(b):
    """字的外框碰到哪块安全区，没碰到返回 None"""
    x0, y0, x1, y1 = b
    z = LAYOUT['安全']; up, dn, sd, btn = z['上'], z['下'], z['左右'], z['按钮列']
    if y0 < H * up - 1: return f'顶部 {up:.0%}'
    if y1 > H * dn + 1: return f'底部 {1 - dn:.0%}'
    if x0 < W * sd - 1 or x1 > W * (1 - sd) + 1: return f'左右 {sd:.0%}'
    if btn and x1 > W * btn[0] + 1 and y1 > H * btn[1] and y0 < H * btn[2]: return '右侧按钮列'
    return None


class FrameChecks:
    """逐帧收 引擎/subs.js 记下的字（__TEXTS）和 引擎/camera.js 的摄像机记录（__CAMREC），最后出结论"""
    def __init__(self):
        self.hist, self.cur, self.local, self.tails, self.jumps, self.flick = [], None, [], [], [], {}
        self.nan, self.same_bad = {}, {}
        self.safe, self.runs, self.best, self.low, self.move, self.fast, self.prev = {}, {}, {}, {}, {}, {}, {}
        self.edge, self.last = {}, None
        self.still, self.pops, self.bands, self.drift = [0, None, []], [], {}, set()
        self.cover = {}   # 字幕压到镜头 regions 报告的主体

    def add(self, i, shot, texts, cam=None):
        self.camera(i, shot, cam)
        t = i / FPS
        for x in texts:
            k = (x['种类'], x['名'])
            if x['稳']:
                z = in_safe(x['box'])
                if z and k not in self.safe: self.safe[k] = (t, z, x['字'])
                if x['种类'] != '字幕':   # 画里的字、关键字：量连续停稳了多久
                    r = self.runs.get(k)
                    r = r + 1 if r is not None and self.prev.get(k) == i - 1 else 1
                    self.runs[k] = r
                    if r >= self.best.get(k, (0,))[0]: self.best[k] = (r, x['字'], i)
            if x.get('对比') is not None and x['对比'] < CONTRAST and (k not in self.low or x['对比'] < self.low[k][1]): self.low[k] = (t, x['对比'], x['字'])
            if x.get('压主体') and x['稳'] and k not in self.cover: self.cover[k] = (t, x['压主体'], x['字'])
            # 正在读的字同一镜头里每帧移动多少（贴画面的字幕、跟着镜头走的画里的字和关键字）
            cx, cy = (x['box'][0] + x['box'][2]) / 2, (x['box'][1] + x['box'][3]) / 2
            p = self.move.get(k)
            if p and p[0] == i - 1 and p[1] == shot and x['稳'] and p[4]:
                d = ((cx - p[2]) ** 2 + (cy - p[3]) ** 2) ** .5
                if d > MOVE and k not in self.fast: self.fast[k] = (t, d, x['字'])
            self.move[k] = (i, shot, cx, cy, x['稳'])
            self.prev[k] = i

    def camera(self, i, shot, cam):
        t = i / FPS
        self.last = (shot, cam, t)
        if cam and cam['露边'] and shot not in self.edge: self.edge[shot] = (t, cam['露边'])

    def picture(self, i, shot, r, fresh):
        """画面停太久、突然跳动、色带。fresh = 这一帧换了一张画（一顿一顿的画风停住的帧、分镜版复用的帧都不算）"""
        t = i / FPS
        f = r.get('finish')
        if fresh and f:
            if f.get('色带') and shot not in self.bands: self.bands[shot] = (t, f['色带'])
        cam = r.get('cam')
        moving = bool(cam and (cam['速度'] > .05 or abs(cam['放大']) > 1e-5))
        if moving: self.drift.add(shot)
        diff = (r.get('diff') or {}) if fresh else {}
        d = diff.get('全', 0)
        self.code(i, shot, r, fresh, diff, moving)
        run = self.still
        if d < .15 and shot not in self.drift: run[0] += 1; run[1] = run[1] if run[1] is not None else t
        else:
            if run[0] > 2 * FPS: run[2].append((run[1], run[0] / FPS))
            run[0], run[1] = 0, None
        if fresh and r.get('ver') != 'board' and self.last_d is not None and self.last_d[1] == shot and self.last_d[0] < .2 and d > 1.5:
            self.pops.append(t)
        self.last_d = (d, shot) if fresh else self.last_d

    last_d = None

    def code(self, i, shot, r, fresh, diff, moving):
        """代码动画常见的毛病：数值算坏、凭空出现或消失、僵住、切点小跳、细线闪烁"""
        t, first = i / FPS, not self.hist or self.hist[-1][1] != shot
        if r.get('nan') and shot not in self.nan: self.nan[shot] = (t, r['nan'])
        blocks = diff.get('块') or [0] * 48
        if fresh and r.get('ver') != 'board':
            # 切点：前后画面大部分一样，只有一块变了，像同一个东西跳了位置
            if first and self.hist and sum(b <= .5 for b in blocks) >= 48 * .7 and max(blocks) >= POP: self.jumps.append((t, self.hist[-1][1], shot))
        # 只记换了画的帧：一顿一顿的画风停住的那几帧不进来，前后比的就是上一张画和下一张画，不会把"停住"当成"静止"
        if fresh: self.hist.append((i, shot, blocks, moving or r.get('ver') == 'board', first))
        if len(self.hist) > 3: self.hist.pop(0)
        if fresh and len(self.hist) == 3:   # 中间那张画：某一块一下子变了很多，前后两张都几乎不变 → 凭空出现或消失
            a, c, b = self.hist
            same = all(h[1] == c[1] and not h[3] for h in self.hist) and not any(h[4] for h in self.hist[1:])
            if same:
                C = 8 if W > H else 6   # 48 块：竖屏 6 列 8 行，横屏 8 列 6 行（render.py 里 __diff 的分法）
                for j, v in enumerate(c[2]):
                    if v >= POP and a[2][j] <= CALM and b[2][j] <= CALM:
                        self.local.append((c[0] / FPS, c[1], '上中下'[min(2, j // C * 3 // (48 // C))] + '左中右'[j % C * 3 // C])); break
        # 僵住：一个镜头里动过，最后 1 秒以上完全不变
        if first:
            self.end_tail(i)
            self.cur = [shot, None, False]
        if fresh and not first and d_ok(diff): self.cur[1] = t   # 切点那一帧的变化不算动
        if fresh and moving: self.cur[2] = True
        # 细线闪烁：连续半秒（按时间算，一顿一顿的画风也一样）每张画都有来回翻的像素；断了就从下一次重新计时。分镜版不查（粗画，成品会重画）
        if fresh and r.get('ver') != 'board' and diff.get('闪', 0) > FLICK:
            f = self.flick.setdefault(shot, [0, t, False])
            if f[0] == 0: f[1] = t
            f[0] += 1
            if f[0] >= 3 and t - f[1] >= .5 - 1e-6: f[2] = True
        elif fresh and shot in self.flick and not self.flick[shot][2]: self.flick[shot][0] = 0

    def end_tail(self, i, cut=False):
        if self.cur and not cut:
            shot, last, drifted = self.cur
            if last is not None and not drifted and i / FPS - last >= FROZEN: self.tails.append((shot, last, i / FPS - last))

    def same(self, shot, t, frac):
        if frac > .0005: self.same_bad[shot] = (t, frac)

    def result(self, cut=None):
        """cut = 渲染范围没到片尾时最后一帧的序号：截在这里的字不查读字时间"""
        hard, warn = [], []
        for k, (t, z, s) in self.safe.items():
            hard.append(f'{k[0]}「{s[:12]}」{t:.1f}s 进了安全区（{z}）')
        for k, (t, d, s) in self.fast.items():
            (warn if k[0] == '字幕' else hard).append(f'{k[0]}「{s[:12]}」{t:.1f}s 正在读的时候每帧移动 {d:.0f} 像素，超过 {MOVE}，读不了')
        for sh, (t, why) in self.edge.items(): hard.append(f'镜头 {sh} {t:.1f}s 露边：{why}')
        for sh, (t, call) in self.nan.items(): hard.append(f'镜头 {sh} {t:.1f}s 数值算坏了：{call}，这一笔没画出来（查除以零、空数组）')
        for sh, (t, f) in self.same_bad.items(): hard.append(f'镜头 {sh} {t:.1f}s 同一帧画两次不一样（{f:.2%} 的像素）：用了没固定种子的随机数，或者画法依赖上一帧。换成 U.rng(种子)，一切按时间算')
        self.end_tail(self.hist[-1][0] + 1 if self.hist else 0, cut is not None)
        for t, sh, where in self.local[:8]: warn.append(f'镜头 {sh} {t:.1f}s 画面{where}一帧之内变了一块，前后都不动：东西凭空出现或消失，加淡入淡出或者让它动进来')
        for sh, last, n in self.tails: warn.append(f'镜头 {sh} 从 {last:.1f}s 起最后 {n:.1f} 秒画面完全冻住：动作提前做完了。留给读字的，加一点漂或呼吸；不是的，把动作拉长或者把镜头剪短')
        for t, a, b in self.jumps: warn.append(f'镜头 {a} → {b}（{t:.1f}s）切点前后画面几乎一样，只有一块变了：同一个东西可能跳了位置')
        for sh, (n, t, bad) in self.flick.items():
            if bad: warn.append(f'镜头 {sh} {t:.1f}s 起细线或密纹一闪一闪（锯齿、波纹）：线加粗一点、纹理疏一点，或者动慢一点')
        if self.still[0] > 2 * FPS: self.still[2].append((self.still[1], self.still[0] / FPS))
        for t0, s in self.still[2]: warn.append(f'{t0:.1f}s 起画面 {s:.1f} 秒几乎没变化，也没有漂：加一点漂或者小动作，别让画面死掉')
        for t in self.pops[:6]: warn.append(f'{t:.1f}s 画面从静止突然大幅变化：没有缓入，看起来像跳了一下')
        for sh, (t, b) in self.bands.items(): warn.append(f'镜头 {sh} {t:.1f}s 有一段渐变首尾只差 {b["级"]} 个色阶（少于 30 会出色带），抖动又关着')
        for k, (fr, s, end) in self.best.items():
            if end != cut and fr / FPS < count(s) / 6 - 1e-6:
                hard.append(f'{k[0]}「{s[:12]}」停稳 {fr / FPS:.2f} 秒，读完要 {count(s) / 6:.2f} 秒')
        for k, (t, c, s) in self.low.items():
            warn.append(f'{k[0]}「{s[:12]}」{t:.1f}s 对比度 {c:.1f}:1，低于 {CONTRAST}:1')
        for k, (t, names, s) in self.cover.items():
            warn.append(f'{k[0]}「{s[:12]}」{t:.1f}s 压到了画面主体「{"、".join(names)}」（镜头 regions 报的位置，四周留 24 像素）：换个位置，或者镜头里写 字幕: \'自动\' 让引擎躲开')
        return hard, warn


def d_ok(diff): return diff.get('全', 0) > .05   # 这一帧画面在动


def report(film, hard, warn, notes):
    lines = [f'硬伤 {len(hard)} 处'] + [f'  - {h}' for h in hard] + [f'提醒 {len(warn)} 处'] + [f'  - {w}' for w in warn] + [f'说明：{n}' for n in notes]
    out = film / '草稿' / '检查.txt'; out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text('\n'.join(lines) + '\n', encoding='utf-8')
    print(f'检查：硬伤 {len(hard)}，提醒 {len(warn)} → {out}')
    for h in hard[:8]: print('  硬伤：' + h)
    return len(hard)
