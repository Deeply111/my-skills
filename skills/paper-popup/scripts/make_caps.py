# -*- coding: utf-8 -*-
"""口播 → data/caps.js（逐字时间的字幕，场景和字幕都按它对时）。

  python make_caps.py --video <口播.mp4> --script <逐字稿.txt> --out <本期>/data/caps.js
                      [--from 0] [--to 13] [--model medium]

逐字稿：一行一条字幕，写他实际说的话（数字照屏幕上要显示的写）。字幕文字用稿子的写法，时间来自识别。
做法：faster-whisper 逐词识别（有 NVIDIA 显卡走 CUDA，否则 CPU）→ 繁转简 → 和稿子逐字对齐（difflib）
     → 没对上的字在前后对上的字之间插值。对上的比例低于八成会提示：那是稿子和他说的不一样，先改稿子。
时间从 --from 起算（和 new_episode.py 截出来的片段同一个钟）。
输出：window.CAPS = [{id:"c01", t0, t1, u:[[字(带后面的标点), 开口时刻], ...]}, ...]
"""
import argparse, difflib, json, os, re, subprocess, sys

sys.stdout.reconfigure(encoding="utf-8")
a = argparse.ArgumentParser()
a.add_argument("--video", required=True)
a.add_argument("--script", required=True)
a.add_argument("--out", required=True)
a.add_argument("--from", dest="t0", type=float, default=0.0)
a.add_argument("--to", dest="t1", type=float, default=None)
a.add_argument("--model", default="medium")
o = a.parse_args()

PUN = set("，。？！：；、,.?!:;…—“”\"'（）() ")
lines = [l.strip() for l in open(o.script, encoding="utf-8") if l.strip()]
if not lines:
    sys.exit("逐字稿是空的")

cmd = ["ffmpeg", "-v", "error", "-ss", str(o.t0)] + (["-t", str(o.t1 - o.t0)] if o.t1 else []) + ["-i", o.video, "-ac", "1", "-ar", "16000", "-f", "f32le", "-"]
pcm = subprocess.run(cmd, capture_output=True, check=True).stdout
import numpy as np
from faster_whisper import WhisperModel

audio = np.frombuffer(pcm, np.float32)
model = None
if os.environ.get("WHISPER_DEVICE", "").lower() != "cpu":
    try:
        model = WhisperModel(o.model, device="cuda", compute_type="float16")
        list(model.transcribe(audio[:16000], language="zh")[0])   # cuBLAS/cuDNN missing only shows up here
    except Exception as e:
        print("显卡不可用，改用 CPU：", str(e)[:120]); model = None
if model is None:
    model = WhisperModel(o.model, device="cpu", compute_type="int8")
segs, _ = model.transcribe(audio, language="zh", word_timestamps=True, beam_size=8, condition_on_previous_text=False, initial_prompt="以下是普通话的句子。")
try:
    from opencc import OpenCC
    t2s = OpenCC("t2s").convert
except Exception:
    t2s = lambda s: s

hc = []   # (char, start, end) from recognition
heard = []
for s in segs:
    heard.append(t2s(s.text.strip()))
    for w in s.words:
        cs = [c for c in t2s(w.word.strip()) if c not in PUN]
        if not cs:
            continue
        d = (w.end - w.start) / len(cs)
        hc += [(c, w.start + i * d, w.start + (i + 1) * d) for i, c in enumerate(cs)]
print("识别出来的：\n  " + "\n  ".join(heard))

mine = [(li, c) for li, l in enumerate(lines) for c in l if c not in PUN]
T = [None] * len(mine); E = [None] * len(mine); hit = 0
for b in difflib.SequenceMatcher(None, [m[1] for m in mine], [h[0] for h in hc], autojunk=False).get_matching_blocks():
    for k in range(b.size):
        T[b.a + k], E[b.a + k] = hc[b.b + k][1], hc[b.b + k][2]; hit += 1
idx = [i for i, t in enumerate(T) if t is not None]
if not idx:
    sys.exit("一个字都没对上：逐字稿是不是这段口播的？")
for i in range(len(T)):
    if T[i] is not None:
        continue
    lo = max([j for j in idx if j < i], default=None); hi = min([j for j in idx if j > i], default=None)
    if lo is None: T[i] = max(0, T[hi] - (hi - i) * 0.2)
    elif hi is None: T[i] = E[lo] + (i - lo - 1) * 0.2
    else: T[i] = E[lo] + (T[hi] - E[lo]) * (i - lo) / (hi - lo)
    E[i] = T[i] + 0.18
rate = hit / len(mine)
print(f"对上 {hit}/{len(mine)} 个字（{rate:.0%}）")
if rate < 0.8:
    print("！对上的不到八成：逐字稿和他说的差得多，时刻会不准。对照上面的识别结果改稿子。")

caps, k = [], 0
for li, l in enumerate(lines):
    u = []
    for c in l:
        if c in PUN:
            if u: u[-1][0] += c
            continue
        u.append([c, round(T[k], 3)]); k += 1
    ks = [i for i, m in enumerate(mine) if m[0] == li]
    caps.append({"id": f"c{li + 1:02d}", "t0": round(T[ks[0]], 3), "t1": round(E[ks[-1]], 3), "u": u})
for x, y in zip(caps, caps[1:]):
    x["t1"] = min(x["t1"], y["t0"])
os.makedirs(os.path.dirname(os.path.abspath(o.out)), exist_ok=True)
open(o.out, "w", encoding="utf-8").write("window.CAPS = " + json.dumps(caps, ensure_ascii=False) + ";\n")
for c in caps:
    print(f"{c['id']} {c['t0']:6.2f}–{c['t1']:6.2f}  {''.join(x[0] for x in c['u'])}")
print("→", os.path.abspath(o.out))
