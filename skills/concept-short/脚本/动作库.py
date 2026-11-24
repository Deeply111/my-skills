# 共用动作库：素材/动作/（Mixamo 的 FBX 和转好的骨骼数据）。需要动作先查这里，没有才去 mixamo.com 下，下完入库；片子用哪个复制哪个到 片子/素材/动作/，库以后变了旧片不受影响。
#   python 脚本/动作库.py 列表
#   python 脚本/动作库.py 取 <名> <片子目录>
#   python 脚本/动作库.py 入库 <fbx> <名> --mixamo "Sad Walk" --说明 "Walking Forward In A Sad Disposition" [--注意 "头压得低，抬头 .55"] [--日期 2026-11-05]
import argparse, datetime, json, os, shutil, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
库 = ROOT / '素材' / '动作'
索引 = 库 / '索引.json'
sys.stdout.reconfigure(encoding='utf-8'); sys.stderr.reconfigure(encoding='utf-8')


def 读():
    return json.loads(索引.read_text(encoding='utf8')) if 索引.exists() else {}


def blender():
    if os.environ.get('BLENDER'):
        return os.environ['BLENDER']
    exe = 'blender.exe' if os.name == 'nt' else 'blender'
    cand = sorted((Path.home() / 'blender').glob(f'blender-*/{exe}'))
    if not cand:
        sys.exit('找不到 Blender：装到 ~/blender/，或设环境变量 BLENDER（脚本/blender/说明.md）')
    return str(cand[-1])


def 列表(a):
    for n, v in 读().items():
        print(f"{n}\t{v['时长']} 秒\t{v['mixamo']}：{v['说明']}" + (f"\t注意：{v['注意']}" if v.get('注意') else ''))


def 取(a):
    d = 读()
    if a.名 not in d:
        sys.exit(f'库里没有「{a.名}」，现有：{"、".join(d)}。要新动作：去 mixamo.com 下载再入库（脚本/blender/说明.md）')
    to = Path(a.片子) / '素材' / '动作'
    to.mkdir(parents=True, exist_ok=True)
    shutil.copy2(库 / f'{a.名}.json', to / f'{a.名}.json')
    src, v = to / '来源.md', d[a.名]
    行 = f"| {a.名} | {v['mixamo']} | {v['说明']} | {v['日期']} |\n"
    old = src.read_text(encoding='utf8') if src.exists() else '# 动作来源\nmixamo.com（Adobe），角色 X Bot。\n\n| 动作 | Mixamo 名 | 说明 | 下载日期 |\n|---|---|---|---|\n'
    if 行 not in old:
        src.write_text(old + 行, encoding='utf8')
    print('已复制', to / f'{a.名}.json', '（镜头里 await 人.载动作(名)）' + (f"；注意：{v['注意']}" if v.get('注意') else ''))


def 入库(a):
    库.mkdir(parents=True, exist_ok=True)
    fbx, js = 库 / f'{a.名}.fbx', 库 / f'{a.名}.json'
    if Path(a.fbx).resolve() != fbx.resolve():
        shutil.copy2(a.fbx, fbx)
    r = subprocess.run([blender(), '-b', '-P', str(ROOT / '脚本' / 'blender' / '取动作.py'), '--', str(fbx), str(js)], capture_output=True, text=True, encoding='utf8', errors='replace')
    if r.returncode or not js.exists():
        sys.exit('转换失败：\n' + r.stdout[-1500:] + r.stderr[-800:])
    n = json.loads(js.read_text(encoding='utf8'))['帧数']
    d = 读()
    d[a.名] = {'mixamo': a.mixamo, '说明': a.说明, '日期': a.日期 or datetime.date.today().isoformat(), '帧数': n, '时长': round(n / 30, 2), **({'注意': a.注意} if a.注意 else {})}
    索引.write_text(json.dumps(d, ensure_ascii=False, indent=1), encoding='utf8')
    print('已入库', a.名, n, '帧')


P = argparse.ArgumentParser()
S = P.add_subparsers(dest='cmd', required=True)
S.add_parser('列表').set_defaults(f=列表)
x = S.add_parser('取'); x.add_argument('名'); x.add_argument('片子'); x.set_defaults(f=取)
x = S.add_parser('入库'); x.add_argument('fbx'); x.add_argument('名'); x.add_argument('--mixamo', required=True); x.add_argument('--说明', required=True); x.add_argument('--注意'); x.add_argument('--日期'); x.set_defaults(f=入库)
a = P.parse_args()
a.f(a)
