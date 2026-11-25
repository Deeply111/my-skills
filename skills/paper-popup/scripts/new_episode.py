# -*- coding: utf-8 -*-
"""新建一期纸面立体书：拷模板、截口播、出人声和配乐，填好片长。

  python new_episode.py --out <本期目录> --video <口播.mp4> [--from 0] [--to 13] [--hold 0.4]
                        [--music <配乐>] [--music-from 秒] [--title 本期标题] [--channel 苏格拉丁]

产物（<本期目录> 里）：
  index.html            模板（片长、标题已填好）
  action-table.md       逐句动作表（空表，先填它）
  assets/talk.mp4       口播画面（无声，结尾定格 --hold 秒，给照片/贴纸用）
  assets/voice.wav      口播人声（48 kHz，结尾补静音到片长）
  assets/music.wav      配乐：默认「若如初见」（DEFAULT_MUSIC），用户指定了就用 --music。
                        从曲子的 --music-from 秒开始（默认 = --from，同一条口播分几段做时音乐前后接得上），
                        不够长就循环；开头淡入（接续段只做极短淡入防爆音），结尾淡出。--music none = 不要配乐
  lib/ fonts/ assets/sfx/ hyperframes.json package.json meta.json
下一步：python make_caps.py --video <口播.mp4> --script <逐字稿.txt> --from .. --to .. --out <本期目录>/data/caps.js
"""
import argparse, json, os, shutil, subprocess, sys

sys.stdout.reconfigure(encoding="utf-8")
HERE = os.path.dirname(os.path.abspath(__file__))
SKILL = os.path.dirname(HERE)
TEMPLATE = os.path.join(SKILL, "template")
DEFAULT_MUSIC = r"E:\若如初见 (纯享版) - 秋成.mp3"   # 默认配乐；用户另外指定就用 --music

a = argparse.ArgumentParser()
a.add_argument("--out", required=True)
a.add_argument("--video", required=True)
a.add_argument("--from", dest="t0", type=float, default=0.0)
a.add_argument("--to", dest="t1", type=float, default=None)
a.add_argument("--hold", type=float, default=0.4, help="结尾定格秒数")
a.add_argument("--music", default=DEFAULT_MUSIC)
a.add_argument("--music-from", dest="m0", type=float, default=None, help="从曲子第几秒开始，默认 = --from")
a.add_argument("--title", default="新一期")
a.add_argument("--channel", default="苏格拉丁")
o = a.parse_args()


def ff(*args):
    subprocess.run(["ffmpeg", "-v", "error", "-y", *args], check=True)


if o.t1 is None:
    o.t1 = float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", o.video]))
cut = round(o.t1 - o.t0, 3)
dur = round(cut + o.hold, 3)
out = os.path.abspath(o.out)
if os.path.exists(os.path.join(out, "index.html")):
    sys.exit(f"{out} 里已经有 index.html，不覆盖。换个目录或先挪走。")
shutil.copytree(TEMPLATE, out, dirs_exist_ok=True)
os.makedirs(os.path.join(out, "data"), exist_ok=True)

ff("-ss", str(o.t0), "-t", str(cut), "-i", o.video, "-vf", f"tpad=stop_mode=clone:stop_duration={o.hold}",
   "-an", "-c:v", "libx264", "-crf", "16", "-pix_fmt", "yuv420p", os.path.join(out, "assets", "talk.mp4"))
ff("-ss", str(o.t0), "-t", str(cut), "-i", o.video, "-vn", "-af",
   f"afade=t=out:st={max(0, cut - 0.15)}:d=0.15,apad=whole_dur={dur}", "-ar", "48000", os.path.join(out, "assets", "voice.wav"))
music = os.path.join(out, "assets", "music.wav")
if o.music and o.music.lower() != "none":
    if not os.path.exists(o.music):
        sys.exit(f"找不到配乐：{o.music}。用 --music 指定一首，或 --music none 不要配乐。")
    m0 = o.t0 if o.m0 is None else o.m0
    fin = 0.6 if m0 == 0 else 0.05
    # one fixed gain from the whole song's loudness (to -20 LUFS), so every segment of the same song sits at the same level
    r = subprocess.run(["ffmpeg", "-i", o.music, "-af", "ebur128", "-f", "null", "-"], capture_output=True, text=True, encoding="utf-8", errors="replace").stderr
    lufs = float([l for l in r.splitlines() if l.strip().startswith("I:")][-1].split()[1])
    gain = round(-20 - lufs, 2)
    ff("-stream_loop", "-1", "-ss", str(m0), "-i", o.music, "-t", str(dur), "-af",
       f"volume={gain}dB,afade=t=in:d={fin},afade=t=out:st={max(0, dur - 0.8)}:d=0.8", "-ar", "48000", "-ac", "2", music)
    print(f"配乐：{os.path.basename(o.music)}，从 {m0:g} 秒开始，整首 {lufs:g} LUFS → 增益 {gain:+g} dB")
else:
    ff("-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-t", str(dur), music)

src = open(os.path.join(out, "index.html"), encoding="utf-8").read()
for k, v in {"__DURATION__": str(dur), "__TITLE__": o.title, "__SOURCE__": os.path.basename(o.video),
             "__FROM__": f"{o.t0:g}", "__TO__": f"{o.t1:g}", "__CHANNEL__": o.channel}.items():
    src = src.replace(k, v)
open(os.path.join(out, "index.html"), "w", encoding="utf-8").write(src)
shutil.copy(os.path.join(SKILL, "references", "action-table-blank.md"), os.path.join(out, "action-table.md"))
slug = os.path.basename(out.rstrip("\\/")) or "episode"
json.dump({"id": slug, "name": o.title}, open(os.path.join(out, "meta.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
json.dump({"name": "paper-popup-episode", "private": True, "type": "module",
           "scripts": {"check": "npx --yes hyperframes@0.9.6 check",
                       "render": "npx --yes hyperframes@0.9.6 render --fps 30"}},
          open(os.path.join(out, "package.json"), "w", encoding="utf-8"), indent=1)
print(f"已建好：{out}\n片长 {dur} 秒（口播 {cut} 秒 + 定格 {o.hold} 秒）")
print("下一步：make_caps.py 出字幕 → 填 action-table.md → 写 index.html 的场景")
