"""Master a rendered film's audio for delivery; the picture is copied untouched.

Run: python tools/master.py RENDER.mp4 OUT.mp4
Final stage of the mix in adu-motion-video scripts/pipeline.py (MIT, (c) 2026 阿杜Next):
limiter at 0.92, then loudness normalisation to -15.5 LUFS, true peak -1.2 dBTP, LRA 9.
A second limiter runs after it: on a quietly recorded take, normalising alone pushed peaks past 0 dBFS (EP.02).
"""
import re
import subprocess
import sys

src, out = sys.argv[1:3]
subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", src, "-c:v", "copy",
                "-af", "alimiter=limit=0.92:level=false,loudnorm=I=-15.5:TP=-1.2:LRA=9,aresample=192000,alimiter=limit=0.8:attack=2:release=60:level=false,aresample=48000",
                "-c:a", "aac", "-b:a", "256k", "-movflags", "+faststart", out], check=True)
stats = subprocess.run(["ffmpeg", "-hide_banner", "-i", out, "-vn", "-af", "ebur128=peak=true", "-f", "null", "-"],
                       capture_output=True, text=True, encoding="utf-8", errors="replace").stderr
i = re.findall(r"^\s+I:\s+(-?[\d.]+) LUFS", stats, re.M)[-1]
peak = re.findall(r"^\s+Peak:\s+(-?[\d.]+) dBFS", stats, re.M)[-1]
print(f"{out}: {i} LUFS, true peak {peak} dBFS")
