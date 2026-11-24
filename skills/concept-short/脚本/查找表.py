"""生成成片质感用的查找表（.cube，33³），存进 素材/查找表/（运行：uv run --no-project --python 3.12 --with numpy python 查找表.py）。
每张表都是这里的公式算出来的，不是别人的表，没有授权问题。QUALITY({ 查找表: '暖胶片', 查找表强度: .7 }) 用（引擎/finish.js）。
  暖胶片  洗印片的感觉：柔和的 S 形反差，暗部偏青、亮部偏暖，绿往黄靠，整体略降饱和
  冷胶片  暗部偏蓝、亮部中性略冷，饱和低一点，反差同上
  褪色    黑抬起来、白压下去，饱和低，略暖：旧照片、回忆
  银盐    留银（漂白跳过）：去掉一半颜色、反差加大，硬、冷、沉重
  中性    什么都不做（对照用）
加一种：在 LOOKS 里写一个函数，输入输出都是 0–1 的显示值（sRGB）数组。
"""
import sys
from pathlib import Path
import numpy as np

OUT = Path(__file__).resolve().parent.parent / '素材' / '查找表'
N = 33
LUMA = np.array([.2126, .7152, .0722])


def luma(c): return (c * LUMA).sum(-1, keepdims=True)
def sat(c, k): y = luma(c); return y + (c - y) * k
def s_curve(x, k=1.0, pivot=.42):   # 以 pivot 为中心的柔和 S 形，k 越大反差越大；两端不硬切
    a = np.clip(x, 0, 1); lo = pivot * (a / pivot) ** (1 + .35 * k); hi = 1 - (1 - pivot) * ((1 - a) / (1 - pivot)) ** (1 + .35 * k)
    return np.where(a < pivot, lo, hi)
def tint(c, shadow, high, k=1.0):    # 暗部、亮部各推一个色（加法，量很小）
    y = luma(c); w = np.clip((y - .15) / .55, 0, 1); w = w * w * (3 - 2 * w)
    return c + k * ((1 - w) * np.array(shadow) * (1 - y) + w * np.array(high) * y)


def 暖胶片(c):
    c = s_curve(c, .8); c = tint(c, [-.02, .01, .025], [.035, .012, -.03])
    g = c[..., 1:2] - np.maximum(c[..., 0:1], c[..., 2:3]); c = c + np.clip(g, 0, 1) * np.array([.25, -.05, -.1])   # 偏绿的往黄靠
    return sat(c, .9)
def 冷胶片(c): return sat(tint(s_curve(c, .7), [-.01, .0, .035], [-.01, .004, .012]), .86)
def 褪色(c): c = .06 + s_curve(c, .25) * .88; return sat(tint(c, [.01, .005, -.005], [.02, .01, -.01]), .72)
def 银盐(c): y = luma(c); c = c * .5 + y * .5; return np.clip(s_curve(c, 1.6) * np.array([.98, 1.0, 1.02]), 0, 1)
def 中性(c): return c
LOOKS = {'暖胶片': 暖胶片, '冷胶片': 冷胶片, '褪色': 褪色, '银盐': 银盐, '中性': 中性}

OUT.mkdir(parents=True, exist_ok=True)
g = np.linspace(0, 1, N); b, gg, r = np.meshgrid(g, g, g, indexing='ij')   # .cube 的顺序：R 变化最快，再 G，再 B
grid = np.stack([r, gg, b], -1).reshape(-1, 3)
for name, f in LOOKS.items():
    o = np.clip(f(grid.copy()), 0, 1)
    with open(OUT / f'{name}.cube', 'w', encoding='utf-8', newline='\n') as fh:
        fh.write(f'TITLE "{name}"\n# skill-v4 脚本/查找表.py 生成\nLUT_3D_SIZE {N}\nDOMAIN_MIN 0 0 0\nDOMAIN_MAX 1 1 1\n')
        fh.writelines(f'{x:.6f} {y:.6f} {z:.6f}\n' for x, y, z in o)
    mid = f(np.array([[.5, .5, .5], [.1, .1, .1], [.9, .9, .9]]))
    print(f'{name}: 灰 .1/.5/.9 → {np.round(mid, 3).tolist()}')
(OUT / '来源.txt').write_text('这里的 .cube 都是 脚本/查找表.py 用公式算出来的，skill 自己的，没有外来授权。\n', encoding='utf-8')
