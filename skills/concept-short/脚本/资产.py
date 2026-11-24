# 3D 资产（全是 CC0：可商用、不用署名）：Poly Haven 的环境贴图、材质、模型，ambientCG 的材质
#   uv run --no-project --python 3.12 python -I -X utf8 脚本/资产.py 环境 studio_small_08            → 素材/环境/studio_small_08.hdr
#   uv run ... 脚本/资产.py 材质 wood_table_001 [--名 木桌]                                          → 素材/材质/木桌_diff.jpg、_nor_gl.jpg、_rough.jpg（Poly Haven）
#   uv run ... 脚本/资产.py 材质 ambientcg:Paper001 [--名 纸]                                        → 同上（ambientCG）
#   uv run ... 脚本/资产.py 模型 ceramic_vase_01 [--到 片子/<片名>/素材/模型]                         → <到>/ceramic_vase_01/ceramic_vase_01.gltf + 贴图（Poly Haven）
# 默认 1k（够 1080p 里一个道具用）；--分辨率 2k 给占半个画面以上的地面和墙。每次下载记进 素材/来源.txt。
# 布景里：await S3.材质('木桌', …)、await S3.HDRI('studio_small_08')、await S3.gltf(地址)（参考/3D.md）
import argparse, io, json, sys, urllib.request, zipfile
from datetime import date
from pathlib import Path

SKILL = Path(__file__).resolve().parent.parent
UA = {'User-Agent': 'skill-v4-assets/1.0'}

def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120) as r: return r.read()

def save(p, data):
    p.parent.mkdir(parents=True, exist_ok=True); p.write_bytes(data); print(f'  {p.relative_to(SKILL) if SKILL in p.parents else p}  {len(data) // 1024} KB')

def note(line):
    f = SKILL / '素材' / '来源.txt'; old = f.read_text(encoding='utf-8') if f.exists() else ''
    if line not in old: f.write_text(old + line + '\n', encoding='utf-8')

def ph_files(id_):
    try: return json.loads(get(f'https://api.polyhaven.com/files/{id_}'))
    except Exception as e: sys.exit(f'Poly Haven 上找不到 {id_}：{e}\nfix: 在 polyhaven.com 上找到资产，用网址最后一段当名字')

def 环境(id_, res):
    f = ph_files(id_); u = f['hdri'][res]['hdr']['url']
    save(SKILL / '素材' / '环境' / f'{id_}.hdr', get(u)); note(f'环境 {id_}（Poly Haven CC0，{res}）https://polyhaven.com/a/{id_}  {date.today()}')

# 三张图：颜色、法线（OpenGL 朝向）、粗糙度；有金属度的也存
def 材质(src, name, res):
    out = SKILL / '素材' / '材质'
    if src.startswith('ambientcg:'):
        aid = src.split(':', 1)[1]; z = zipfile.ZipFile(io.BytesIO(get(f'https://ambientcg.com/get?file={aid}_{res.upper()}-JPG.zip')))
        for suf, key in (('diff', 'Color'), ('nor_gl', 'NormalGL'), ('rough', 'Roughness'), ('metal', 'Metalness')):
            hit = [n for n in z.namelist() if n.endswith(f'_{key}.jpg')]
            if hit: save(out / f'{name}_{suf}.jpg', z.read(hit[0]))
            elif suf != 'metal': sys.exit(f'{aid} 的压缩包里没有 {key}')
        note(f'材质 {name} ← ambientCG {aid}（CC0，{res}）https://ambientcg.com/view?id={aid}  {date.today()}')
    else:
        f = ph_files(src)
        for suf, keys in (('diff', ['Diffuse', 'diff', 'col_1', 'Color']), ('nor_gl', ['nor_gl']), ('rough', ['Rough', 'rough']), ('metal', ['Metal', 'metal'])):
            k = next((k for k in keys if k in f), None)
            if not k:
                if suf == 'metal': continue
                sys.exit(f'{src} 没有 {suf} 贴图（有：{"、".join(f)}）')
            save(out / f'{name}_{suf}.jpg', get(f[k][res]['jpg']['url']))
        note(f'材质 {name} ← Poly Haven {src}（CC0，{res}）https://polyhaven.com/a/{src}  {date.today()}')

def 模型(id_, res, to):
    f = ph_files(id_); g = f['gltf'][res]['gltf']; d = Path(to) / id_
    save(d / f'{id_}.gltf', get(g['url']))
    for rel, inc in g.get('include', {}).items(): save(d / rel, get(inc['url']))
    note(f'模型 {id_}（Poly Haven CC0，{res}）https://polyhaven.com/a/{id_}  {date.today()}')

ap = argparse.ArgumentParser(); ap.add_argument('类', choices=['环境', '材质', '模型']); ap.add_argument('id')
ap.add_argument('--名'); ap.add_argument('--分辨率', default='1k'); ap.add_argument('--到', default=str(SKILL / '素材' / '模型'))
a = ap.parse_args()
if a.类 == '环境': 环境(a.id, a.分辨率)
elif a.类 == '材质': 材质(a.id, a.名 or a.id.split(':')[-1], a.分辨率)
else: 模型(a.id, a.分辨率, a.到)
