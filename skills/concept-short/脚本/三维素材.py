"""3D 素材：材质、环境贴图（HDRI）、模型，只从 CC0 的两家拿（运行：uv run --no-project --python 3.12 python 三维素材.py ...）。
  检索：python 三维素材.py 检索 材质 paper wood [--条 12]      Poly Haven + ambientCG，打印 编号、来源、标签
        python 三维素材.py 检索 环境 night indoor              Poly Haven 的 HDRI，按分类（indoor、night、studio、outdoor、low contrast……）
        python 三维素材.py 检索 模型 chair book                 Poly Haven 的模型
  下载：python 三维素材.py 下载 材质 ph:wood_table_001 acg:Paper006 [--到 <目录>]   默认存进 skill 的 素材/材质/，1k jpg：<名>_diff/nor_gl/rough(/ao/metal).jpg
        python 三维素材.py 下载 环境 ph:moonless_golf [--到 <目录>]               默认 素材/环境/<名>.hdr（1k）
        python 三维素材.py 下载 模型 ph:wooden_stool_01 --到 <片子>/画风/<画风>/模型   glTF（1k 贴图），S3.gltf 读
        --尺寸 2k 换分辨率。出处和授权追加进目标目录的 来源.txt；材质下完重写 素材/材质/索引.json（引擎按它知道每种材质有哪几张贴图）。
  索引：python 三维素材.py 索引     手动放了贴图进 素材/材质/ 之后重写索引
两家都是 CC0（公有领域）：可商用、不用署名。下载的是外来文件，只当数据读（贴图、模型），不执行。
"""
import argparse, io, json, sys, urllib.parse, urllib.request, zipfile
from pathlib import Path

for _s in (sys.stdout, sys.stderr):
    try: _s.reconfigure(encoding='utf-8', errors='replace')
    except AttributeError: pass

SKILL = Path(__file__).resolve().parent.parent
UA = {'User-Agent': 'Mozilla/5.0 (skill-v4 3D assets)'}
PH = 'https://api.polyhaven.com'
ACG = 'https://ambientcg.com/api/v2/full_json?'
KIND = {'材质': 'textures', '环境': 'hdris', '模型': 'models'}
DEST = {'材质': SKILL / '素材' / '材质', '环境': SKILL / '素材' / '环境', '模型': SKILL / '素材' / '模型'}
# 贴图的通道 → 我们的文件名后缀（three.js 法线用 OpenGL 方向，nor_gl）
PH_MAP = {'Diffuse': 'diff', 'nor_gl': 'nor_gl', 'Rough': 'rough', 'AO': 'ao', 'Metal': 'metal'}
ACG_MAP = {'Color': 'diff', 'NormalGL': 'nor_gl', 'Roughness': 'rough', 'AmbientOcclusion': 'ao', 'Metalness': 'metal'}


def get(u, raw=False):
    b = urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=120).read()
    return b if raw else json.loads(b)


def 检索(kind, words, n):
    q = [w.lower() for w in words]
    ph = get(f'{PH}/assets?t={KIND[kind]}')
    hits = [(k, v) for k, v in ph.items() if all(any(w in s.lower() for s in [k, v.get('name', '')] + v.get('tags', []) + v.get('categories', [])) for w in q)]
    hits.sort(key=lambda kv: -kv[1].get('download_count', 0))
    for k, v in hits[:n]: print(f'ph:{k:28s} Poly Haven  {"、".join(v.get("categories", [])[:4])} | {" ".join(v.get("tags", [])[:6])}')
    if kind == '材质':
        r = get(ACG + urllib.parse.urlencode({'q': ' '.join(words), 'type': 'Material', 'limit': n, 'sort': 'Popular'}))
        for a in r.get('foundAssets', []): print(f'acg:{a["assetId"]:27s} ambientCG   {" ".join(a.get("tags", [])[:8])}')


def 记来源(d, line):
    with open(d / '来源.txt', 'a', encoding='utf-8') as f: f.write(line + '\n')


def 索引(d=DEST['材质']):
    idx = {}
    for f in sorted(d.glob('*.jpg')):
        for suf in ('nor_gl', 'diff', 'rough', 'ao', 'metal'):
            if f.stem.endswith('_' + suf): idx.setdefault(f.stem[:-len(suf) - 1], []).append(suf)
    (d / '索引.json').write_text(json.dumps(idx, ensure_ascii=False, indent=0), encoding='utf-8'); print(f'索引：{len(idx)} 种材质')


def 下载(kind, ids, to, size):
    d = Path(to) if to else DEST[kind]; d.mkdir(parents=True, exist_ok=True)
    for full in ids:
        src, _, aid = full.partition(':')
        if src == 'acg':
            if kind != '材质': sys.exit('ambientCG 只用来拿材质')
            z = zipfile.ZipFile(io.BytesIO(get(f'https://ambientcg.com/get?file={aid}_{size.upper()}-JPG.zip', raw=True)))
            got = []
            for nm in z.namelist():
                for k, suf in ACG_MAP.items():
                    if nm.endswith(f'_{k}.jpg'): (d / f'{aid}_{suf}.jpg').write_bytes(z.read(nm)); got.append(suf)
            print(f'{aid}: {"、".join(got)}'); 记来源(d, f'{aid}（ambientCG，https://ambientcg.com/a/{aid}，CC0）：{size} jpg {" ".join(got)}')
        elif src == 'ph':
            f = get(f'{PH}/files/{aid}')
            if kind == '材质':
                got = []
                for k, suf in PH_MAP.items():
                    u = f.get(k, {}).get(size, {}).get('jpg', {}).get('url')
                    if u: (d / f'{aid}_{suf}.jpg').write_bytes(get(u, raw=True)); got.append(suf)
                print(f'{aid}: {"、".join(got)}'); 记来源(d, f'{aid}（Poly Haven，https://polyhaven.com/a/{aid}，CC0）：{size} jpg {" ".join(got)}')
            elif kind == '环境':
                (d / f'{aid}.hdr').write_bytes(get(f['hdri'][size]['hdr']['url'], raw=True))
                print(f'{aid}.hdr'); 记来源(d, f'{aid}（Poly Haven，https://polyhaven.com/a/{aid}，CC0）：{size} hdr')
            else:
                g = f['gltf'][size]['gltf']; md = d / aid; md.mkdir(exist_ok=True)
                (md / f'{aid}.gltf').write_bytes(get(g['url'], raw=True))
                for rel, v in g.get('include', {}).items():
                    p = (md / rel).resolve()
                    if md.resolve() not in p.parents: sys.exit(f'{aid} 的文件路径跑出了目录：{rel}')
                    p.parent.mkdir(parents=True, exist_ok=True); p.write_bytes(get(v['url'], raw=True))
                print(f'{aid}/{aid}.gltf'); 记来源(d, f'{aid}（Poly Haven，https://polyhaven.com/a/{aid}，CC0）：{size} glTF')
        else: sys.exit(f'编号要带来源：ph:<名> 或 acg:<名>，不是 {full}')


ap = argparse.ArgumentParser(); sub = ap.add_subparsers(dest='cmd', required=True)
s1 = sub.add_parser('检索'); s1.add_argument('类', choices=KIND); s1.add_argument('词', nargs='+'); s1.add_argument('--条', type=int, default=12)
sub.add_parser('索引'); s2 = sub.add_parser('下载'); s2.add_argument('类', choices=KIND); s2.add_argument('编号', nargs='+'); s2.add_argument('--到'); s2.add_argument('--尺寸', default='1k')
a = ap.parse_args()
if a.cmd == '检索': 检索(a.类, a.词, a.条)
elif a.cmd == '索引': 索引()
else:
    下载(a.类, a.编号, a.到, a.尺寸)
    if a.类 == '材质' and not a.到: 索引()
