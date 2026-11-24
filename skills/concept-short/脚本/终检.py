"""成片终检：读最终的 mp4，查文件本身（运行：uv run --no-project --python 3.12 --with-requirements ../requirements.lock python 终检.py <成片.mp4> [--对比 <上一版.mp4>]）。
render.py 出视频时自动跑，结论接进 <片子>/草稿/检查.txt；单独跑时只打印。

查这几样，都是硬伤（规格这一组其实是在测渲染脚本本身，改了 render.py 才可能出错）：
  规格：横屏 1920×1080 或竖屏 1080×1920（render.py 调用时还要和片子.json 的画幅一致）、恒定 30 帧、H.264、yuv420p、BT.709 标记、AAC 48k 立体声、视频码率不超过 12M、能边下边播（moov 在前）
  编码后的峰值：AAC 编码会把峰值抬高一点，解出来量真峰值，不超过 -1 dBTP
  光敏闪烁：按 WCAG 2.x 和 ITU-R BT.1702 的定义（凭记忆实现）——
    一次明暗变化 = 相对亮度变了 10% 以上，且较暗的那一端低于 0.8；画面四分之一以上的面积同向变化才算一次全屏变化；
    两次方向相反的变化是一次闪；任意一秒内超过三次闪（7 次变化以上）不合格。红闪：饱和红（R 占 80% 以上）的 (R−G−B)×320 变了 20 以上，同样计数。
"""
import json, struct, subprocess, sys
from pathlib import Path
import numpy as np

import 画幅
FPS, MAXRATE, TP = 30, 12, -1.0
SMALL = 20   # 光敏按缩小到 1/20 的画面算（竖屏 54×96、横屏 96×54），看的是大面积变化
# 一致性检查（--对比）：逐帧 PSNR，低于这个就列出来。换机器、换显卡、改了引擎以后，确认画面没走样（不是和参考片对标）
PSNR_MIN = 33


def probe(mp4):
    r = subprocess.run(['ffprobe', '-v', 'error', '-show_streams', '-show_format', '-of', 'json', str(mp4)], capture_output=True, text=True, encoding='utf-8')
    return json.loads(r.stdout)


def moov_first(mp4):
    """边下边播：moov（索引）要在 mdat（数据）前面"""
    with open(mp4, 'rb') as f:
        while True:
            h = f.read(8)
            if len(h) < 8: return False
            size, kind = struct.unpack('>I4s', h)
            if kind == b'moov': return True
            if kind == b'mdat': return False
            if size == 1: size = struct.unpack('>Q', f.read(8))[0]; f.seek(size - 16, 1)
            elif size == 0: return False
            else: f.seek(size - 8, 1)


def spec(info, mp4, layout=None):
    hard = []
    v = next((s for s in info['streams'] if s['codec_type'] == 'video'), None)
    au = next((s for s in info['streams'] if s['codec_type'] == 'audio'), None)
    if not v: return ['成片没有画面']
    L = layout or 画幅.of_size(v.get('width'), v.get('height'))
    if not L: return [f'成片规格：尺寸 {v.get("width")}×{v.get("height")}，应为横屏 1920×1080 或竖屏 1080×1920']
    want = {'宽': (v.get('width'), L['W']), '高': (v.get('height'), L['H']), '编码': (v.get('codec_name'), 'h264'), '像素格式': (v.get('pix_fmt'), 'yuv420p'),
            '帧率': (v.get('r_frame_rate'), f'{FPS}/1'), '平均帧率': (v.get('avg_frame_rate'), f'{FPS}/1'),
            '色彩矩阵': (v.get('color_space'), 'bt709'), '原色': (v.get('color_primaries'), 'bt709'), '传递曲线': (v.get('color_transfer'), 'bt709')}
    for k, (got, ok) in want.items():
        if got != ok: hard.append(f'成片规格：{k}是 {got}，应为 {ok}')
    rate = int(v.get('bit_rate') or 0) / 1e6
    if rate > MAXRATE: hard.append(f'成片规格：视频码率 {rate:.1f}M，超过 {MAXRATE}M')
    if not au: hard.append('成片没有声音')
    else:
        for k, got, ok in (('音频编码', au.get('codec_name'), 'aac'), ('采样率', au.get('sample_rate'), '48000'), ('声道', au.get('channels'), 2)):
            if got != ok: hard.append(f'成片规格：{k}是 {got}，应为 {ok}')
    if not moov_first(mp4): hard.append('成片不能边下边播：索引在文件末尾（编码时加 -movflags +faststart）')
    return hard


def peak(mp4):
    err = subprocess.run(['ffmpeg', '-hide_banner', '-nostats', '-i', str(mp4), '-vn', '-af', 'ebur128=peak=true', '-f', 'null', '-'],
                         capture_output=True, text=True, encoding='utf-8', errors='replace').stderr
    tail = err[err.rfind('Summary:'):]
    i = tail.find('Peak:')
    if i < 0: return []
    tp = float(tail[i + 5:].split()[0])
    return [f'编码后声音峰值 {tp:.1f} dBTP，超过 {TP}（AAC 编码抬高了峰值：响度统一时峰值再留低一点）'] if tp > TP + .05 else []


def frames(mp4):
    v = next(s for s in probe(mp4)['streams'] if s['codec_type'] == 'video'); SW, SH = v['width'] // SMALL, v['height'] // SMALL
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', str(mp4), '-vf', f'scale={SW}:{SH}:flags=area', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.uint8).reshape(-1, SH, SW, 3).astype(np.float32) / 255


def transitions(vals, step, darker):
    """逐像素数明暗变化，返回每帧 (+1 / -1 / 0)：四分之一以上的面积同向变化才算一次"""
    ref, way, out = vals[0].copy(), np.zeros(vals[0].shape, np.int8), []
    for x in vals[1:]:
        up = (x - ref >= step) & (np.minimum(x, ref) < darker)
        dn = (ref - x >= step) & (np.minimum(x, ref) < darker)
        ev = up | dn
        way[up], way[dn] = 1, -1
        ref = np.where(ev, x, np.where((way == 1) & (x > ref) | (way == -1) & (x < ref), x, ref))   # 跟着往同一方向走的极值
        out.append(1 if up.mean() >= .25 else -1 if dn.mean() >= .25 else 0)
    return out


def flashes(mp4):
    f = frames(mp4)
    lin = np.where(f <= .04045, f / 12.92, ((f + .055) / 1.055) ** 2.4)
    L = .2126 * lin[..., 0] + .7152 * lin[..., 1] + .0722 * lin[..., 2]
    red = np.where(lin[..., 0] / (lin.sum(-1) + 1e-6) >= .8, np.maximum(0, lin[..., 0] - lin[..., 1] - lin[..., 2]) * 320, 0)
    hard = []
    for name, ev in (('明暗', transitions(L, .1, .8)), ('红色', transitions(red, 20, 1e9))):
        idx = [i + 1 for i, e in enumerate(ev) if e]
        for j in range(len(idx)):
            n = sum(1 for k in idx[j:] if k - idx[j] < FPS)
            if n >= 7:
                hard.append(f'光敏闪烁：{idx[j] / FPS:.1f}s 起一秒内大面积{name}变化 {n} 次（超过三次闪），可能诱发癫痫，必须改慢或缩小面积'); break
    return hard


def run(mp4, layout=None):
    """返回 (硬伤, 提醒)。layout：片子的画幅（脚本/画幅.py），给了就要求尺寸一致"""
    mp4 = Path(mp4)
    if not mp4.exists(): return [f'找不到成片：{mp4}'], []
    return spec(probe(mp4), mp4, layout) + peak(mp4) + flashes(mp4), []


def compare(mp4, ref):
    """和上一版逐帧比 PSNR，返回低于 PSNR_MIN 的帧段 [(起秒, 止秒, 最低 dB)]"""
    log = subprocess.run(['ffmpeg', '-hide_banner', '-i', str(mp4), '-i', str(ref), '-lavfi', '[0:v][1:v]psnr=stats_file=-', '-f', 'null', '-'],
                         capture_output=True, text=True, encoding='utf-8', errors='replace').stdout
    vals = [(int(l.split('n:')[1].split()[0]), float(l.split('psnr_avg:')[1].split()[0].replace('inf', '99'))) for l in log.splitlines() if 'psnr_avg:' in l]
    bad = []   # 连续低于门槛的帧并成一段 [起帧, 止帧, 最低]
    for n, v in vals:
        if v >= PSNR_MIN: continue
        if bad and n == bad[-1][1] + 1: bad[-1][1], bad[-1][2] = n, min(bad[-1][2], v)
        else: bad.append([n, n, v])
    return [((a - 1) / FPS, b / FPS, m) for a, b, m in bad], (min(v for _, v in vals) if vals else None), len(vals)


if __name__ == '__main__':
    for _s in (sys.stdout, sys.stderr):
        try: _s.reconfigure(encoding='utf-8', errors='replace')
        except AttributeError: pass
    if '--对比' in sys.argv:
        segs, lo, n = compare(sys.argv[1], sys.argv[sys.argv.index('--对比') + 1])
        print(f'一致性：{n} 帧，最低 {lo:.1f} dB；低于 {PSNR_MIN} dB 的 {len(segs)} 段')
        for a, b, m in segs: print(f'  - {a:.2f}–{b:.2f} 秒，最低 {m:.1f} dB')
        sys.exit(1 if segs else 0)
    h, _ = run(sys.argv[1])
    print(f'终检：硬伤 {len(h)}')
    for x in h: print('  - ' + x)
    sys.exit(1 if h else 0)
