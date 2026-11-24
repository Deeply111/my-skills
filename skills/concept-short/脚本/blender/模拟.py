"""把 Blender 里的刚体、布料模拟烘焙成 three.js 能按 t 回放的数据（S3.回放，引擎/3d.js）。
  blender -b 场景.blend -P 模拟.py -- <输出.json> [起帧 止帧]
  或者在片子自己的建场景脚本最后：import 模拟; 模拟.烘焙(输出, 起, 止)（先把 脚本/blender 加进 sys.path）
场景里带刚体（物理属性里的 Rigid Body）的物体按每帧的位置和旋转记下来，带布料或软体修改器的物体按每帧的顶点记下来（写进同名的 .bin）；
其余物体不导出。帧率按场景的（默认改成 30），S3.回放 在两帧之间插值，所以 t 不用对齐帧。
坐标换成 three.js 的：Y 朝上、+Z 朝前（Blender 的 (x, y, z) → (x, z, -y)），单位不变。
做法：从起帧一帧帧往后算（frame_set），不靠缓存；同一个场景每次烘出来一样。
"""
import bpy, json, struct, sys
from pathlib import Path


def _p(v): return [round(v[0], 6), round(v[2], 6), round(-v[1], 6)]
def _q(q): return [round(q.x, 7), round(q.z, 7), round(-q.y, 7), round(q.w, 7)]   # three 的四元数是 x y z w


def _rigid_geo(ob, dg):
    """物体自己坐标里的网格，按三角形的角展开（每个角自己的法线和 uv，棱角分明的东西也对）"""
    me = ob.evaluated_get(dg).to_mesh(); me.calc_loop_triangles()
    uv = me.uv_layers.active.data if me.uv_layers.active else None; P, N, T = [], [], []
    for tri in me.loop_triangles:
        for li in tri.loops:
            P += _p(me.vertices[me.loops[li].vertex_index].co); N += _p(me.corner_normals[li].vector)
            if uv: T += [round(uv[li].uv[0], 6), round(uv[li].uv[1], 6)]
    ob.evaluated_get(dg).to_mesh_clear(); return P, N, T


def _cloth_topo(ob, dg):
    """布料：同一个顶点 + 同一个 uv 合成一个点，三角形用索引；每帧只换点的位置"""
    me = ob.evaluated_get(dg).to_mesh(); me.calc_loop_triangles()
    uv = me.uv_layers.active.data if me.uv_layers.active else None; key, src, T, I = {}, [], [], []
    for tri in me.loop_triangles:
        for li in tri.loops:
            vi = me.loops[li].vertex_index; u = (round(uv[li].uv[0], 5), round(uv[li].uv[1], 5)) if uv else (0, 0)
            k = (vi, u)
            if k not in key: key[k] = len(src); src.append(vi); T += list(u)
            I.append(key[k])
    ob.evaluated_get(dg).to_mesh_clear(); return src, (T if uv else None), I


def 烘焙(输出, 起=None, 止=None):
    sc = bpy.context.scene; 起 = sc.frame_start if 起 is None else 起; 止 = sc.frame_end if 止 is None else 止
    if sc.render.fps != 30 or sc.render.fps_base != 1: sc.render.fps, sc.render.fps_base = 30, 1
    if sc.rigidbody_world: sc.rigidbody_world.point_cache.frame_start, sc.rigidbody_world.point_cache.frame_end = 起, 止
    rigid = [o for o in sc.objects if o.type == 'MESH' and o.rigid_body]
    cloth = [o for o in sc.objects if o.type == 'MESH' and any(m.type in ('CLOTH', 'SOFT_BODY') for m in o.modifiers)]
    for o in cloth:
        for m in o.modifiers:
            if m.type in ('CLOTH', 'SOFT_BODY'): m.point_cache.frame_start, m.point_cache.frame_end = 起, 止
    if not rigid and not cloth: sys.exit('场景里没有刚体，也没有带布料或软体修改器的物体')
    sc.frame_set(起); dg = bpy.context.evaluated_depsgraph_get(); objs = []
    for o in rigid:
        P, N, T = _rigid_geo(o, dg); s = o.matrix_world.decompose()[2]
        objs.append({'名': o.name, '类': '刚体', '顶点': P, '法线': N, 'uv': T or None, '缩放': [round(s[0], 6), round(s[2], 6), round(s[1], 6)], '轨': []})
    topo = {}
    for o in cloth: src, T, I = _cloth_topo(o, dg); topo[o.name] = src; objs.append({'名': o.name, '类': '布料', '顶点': None, 'uv': T, '索引': I, '帧': []})
    for f in range(起, 止 + 1):
        sc.frame_set(f); dg = bpy.context.evaluated_depsgraph_get()
        for d in objs:
            o = sc.objects[d['名']]
            if d['类'] == '刚体': loc, rot, _ = o.matrix_world.decompose(); d['轨'] += _p(loc) + _q(rot)
            else:
                ev = o.evaluated_get(dg); me = ev.to_mesh(); mw = ev.matrix_world
                d['帧'].append([c for vi in topo[d['名']] for c in _p(mw @ me.vertices[vi].co)]); ev.to_mesh_clear()
        if (f - 起) % 30 == 0: print(f'  第 {f} 帧')
    out = Path(输出); out.parent.mkdir(parents=True, exist_ok=True); 帧数 = 止 - 起 + 1
    if cloth:
        off = 0
        with open(out.with_suffix('.bin'), 'wb') as fh:
            for d in objs:
                if d['类'] != '布料': continue
                d['偏移'] = off; d['顶点'] = d['帧'][0]
                for fr in d.pop('帧'): fh.write(struct.pack(f'<{len(fr)}f', *fr)); off += len(fr)
    out.write_text(json.dumps({'fps': 30, '帧数': 帧数, '物体': objs}, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    print(f'{out}：{len(rigid)} 个刚体、{len(cloth)} 块布料，{帧数} 帧（{(帧数 - 1) / 30:.2f} 秒）')


if __name__ == '__main__' and '--' in sys.argv:
    a = sys.argv[sys.argv.index('--') + 1:]
    烘焙(a[0], *(int(x) for x in a[1:3]))
