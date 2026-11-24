"""这个 skill 自己加的音效配方（procedural-sfx 的写法，mix.py --recipes 读它）。主要是每场的环境底。
环境底由 脚本/音效.py 按画面卡每场的"环境："铺在这一场底下，d = 这一场的长度；首尾各淡 0.8 秒，换场不硬断。
新配方都没经人耳调过（status 'new'），交片时会出现在试听表里；用户听过点头了，在函数后面写 xxx.status = 'tuned'。
"""
import os, sys
sys.path.insert(0, os.environ.get('SFX_SCRIPTS', os.path.join(os.path.expanduser('~'), '.claude', 'skills', 'procedural-sfx', 'scripts')))
from sfxkit import *


def _edges(x, d, fade=.8):
    tt = t_(d); return x * np.minimum(1, np.minimum(tt / fade, (d - tt) / fade).clip(0))


def 风(v=1.0, d=8.0, 强=.5):
    """野外的风：带通的噪声，慢慢一阵强一阵弱；强 0–1 越大越呼啸（高频多一些）。"""
    tt = t_(d)
    gust = .55 + .45 * np.sin(2 * np.pi * .11 * tt + 1.3) * np.sin(2 * np.pi * .047 * tt + .4)
    body = bp(noise(d), 180, 900 + 1400 * 强) * gust
    whistle = bp(noise(d), 1500, 3200) * np.clip(gust - .6, 0, 1) * 强 * 1.5
    return norm(_edges(body + whistle, d)) * v


def 室内(v=1.0, d=8.0):
    """安静房间的底噪：很低的低频嗡声加一点空气声，几乎听不出来，但没有它就像真空。"""
    tt = t_(d)
    hum = lp(brown(d), 120) + .15 * np.sin(2 * np.pi * 50 * tt)
    air = lp(hp(noise(d), 400), 3000) * .25
    return norm(_edges(hum + air, d)) * v


def 夜(v=1.0, d=8.0):
    """夜里的户外：低低的风底，加上稀疏的远处虫鸣。"""
    tt = t_(d)
    base = bp(noise(d), 150, 600) * (.7 + .3 * np.sin(2 * np.pi * .07 * tt))
    chirp = np.sin(2 * np.pi * 4200 * tt) * (np.sin(2 * np.pi * 28 * tt) > .6) * (np.sin(2 * np.pi * .31 * tt) > .3) * .12
    return norm(_edges(base + chirp, d)) * v


def 水(v=1.0, d=8.0):
    """流水、远处的河：低通的噪声加细碎的高频水花。"""
    flow = lp(noise(d), 700) * .8 + bp(noise(d), 2000, 6000) * (rand(n_(d)) > .7) * .2
    return norm(_edges(flow, d)) * v
