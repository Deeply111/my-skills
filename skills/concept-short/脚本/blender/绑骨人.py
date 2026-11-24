# 绑骨人物模板：一个没穿衣服的人偶，骨架和骨名已经和引擎 S3.人物 对好。复制到片子的 画风/<名>/模型/，把「身体」一段改成这条片的造型。
# blender -b -P 绑骨人.py -- <输出.glb>
# 约定：身高约 1，脚在 y=0，面朝 +z，角色的左边是 +x（three.js 坐标）；静止姿势手臂自然下垂。骨名不要改，S3.人物 和动作捕捉都靠它。
# 权重按身体部位直接算，不靠自动权重：同样的输入永远得到同样的结果。给长外套、围巾这类东西加骨头：加进 BONES，mesh 的权重函数指向它，动法写在 S3.人物 的 附件 里（参考/3D.md）。
import bpy, bmesh, math, sys
from mathutils import Vector

out = sys.argv[sys.argv.index('--') + 1]
bpy.ops.wm.read_factory_settings(use_empty=True)

def B(p): return (p[0], -p[2], p[1])          # three.js 坐标 → Blender 坐标
def ss(a, b, x):
    k = max(0.0, min(1.0, (x - a) / (b - a))) if a != b else float(x >= a)
    return k * k * (3 - 2 * k)
def cr(a, b, c, d, t): return .5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (3 * b - a - 3 * c + d) * t * t * t)
def dense(rows, k=4):
    r = []
    for i in range(len(rows) - 1):
        a, b, c, d = rows[max(i - 1, 0)], rows[i], rows[i + 1], rows[min(i + 2, len(rows) - 1)]
        for j in range(k): r.append([cr(a[n], b[n], c[n], d[n], j / k) for n in range(len(b))])
    r.append(list(rows[-1])); return r

# ---------- 材质 ----------
MATS = {}
def mat(name, col, rough=.85, metal=0):
    m = bpy.data.materials.new(name); m.use_nodes = True; n = m.node_tree.nodes['Principled BSDF']
    n.inputs['Base Color'].default_value = (*[((c / 255) / 12.92 if c / 255 <= .04045 else ((c / 255 + .055) / 1.055) ** 2.4) for c in col], 1)
    n.inputs['Roughness'].default_value = rough; n.inputs['Metallic'].default_value = metal; MATS[name] = m; return m
mat('肤', (196, 165, 132), .7); mat('衣', (120, 124, 130)); mat('裤', (70, 74, 82)); mat('鞋', (40, 36, 34), .8)

# ---------- 几何 ----------
PARTS = []
def build(name, verts, faces, m, fn):
    me = bpy.data.meshes.new(name); me.from_pydata([B(v) for v in verts], [], faces); me.update()
    bm = bmesh.new(); bm.from_mesh(me); bmesh.ops.recalc_face_normals(bm, faces=bm.faces); bm.to_mesh(me); bm.free()
    for p in me.polygons: p.use_smooth = True
    me.materials.append(MATS[m]); o = bpy.data.objects.new(name, me); bpy.context.collection.objects.link(o); PARTS.append((o, verts, fn)); return o
def grid(rows, closed=True, cap0=False, cap1=False):
    n, verts, faces = len(rows[0]), [p for r in rows for p in r], []
    for i in range(len(rows) - 1):
        for j in range(n if closed else n - 1):
            a, b = i * n + j, i * n + (j + 1) % n; faces.append((a, b, b + n, a + n))
    if cap0: verts.append(tuple(sum(p[k] for p in rows[0]) / n for k in range(3))); c = len(verts) - 1; faces += [(j, (j + 1) % n, c) for j in range(n)]
    if cap1: verts.append(tuple(sum(p[k] for p in rows[-1]) / n for k in range(3))); c = len(verts) - 1; o = (len(rows) - 1) * n; faces += [(o + j, o + (j + 1) % n, c) for j in range(n)]
    return verts, faces
def loft(name, rows, m, fn, seg=40, cap0=True, cap1=True):
    """rows：[y, cx, cz, rx, rz] 水平的椭圆，从上到下"""
    d = dense(rows); rr = [[(c[1] + c[3] * math.sin(2 * math.pi * j / seg), c[0], c[2] + c[4] * math.cos(2 * math.pi * j / seg)) for j in range(seg)] for c in d]
    return build(name, *grid(rr, True, cap0, cap1), m, fn)
def ell(name, c, r, m, fn, seg=24, rings=16):
    rows = [[(c[0] + r[0] * math.sin(math.pi * i / rings) * math.sin(2 * math.pi * j / seg), c[1] + r[1] * math.cos(math.pi * i / rings), c[2] + r[2] * math.sin(math.pi * i / rings) * math.cos(2 * math.pi * j / seg)) for j in range(seg)] for i in range(rings + 1)]
    return build(name, *grid(rows), m, fn)
def tube(name, pts, m, fn, seg=20, cap=True):
    """pts：[x, y, z, 半径] 沿线走"""
    d = dense(pts, 6); P = [Vector(p[:3]) for p in d]; rows = []; side = Vector((1, 0, 0))
    for i, p in enumerate(P):
        t = (P[min(i + 1, len(P) - 1)] - P[max(i - 1, 0)]).normalized(); u = (side - t * side.dot(t)).normalized(); side = u; v = t.cross(u)
        rows.append([tuple(p + (u * math.cos(2 * math.pi * j / seg) + v * math.sin(2 * math.pi * j / seg)) * d[i][3]) for j in range(seg)])
    return build(name, *grid(rows, True, cap, cap), m, fn)

# ---------- 权重 ----------
def blend(table, v):
    """table：[(位置, 骨)]，按 v 在相邻两根之间平滑过渡"""
    if v <= table[0][0]: return {table[0][1]: 1}
    for (a, ba), (b, bb) in zip(table, table[1:]):
        if v <= b: k = ss(a, b, v); return {ba: 1 - k, bb: k}
    return {table[-1][1]: 1}
w_trunk = lambda p: blend([(.50, 'pelvis'), (.58, 'spine1'), (.67, 'spine2')], p[1])
def w_arm(n):
    def fn(p):
        w = blend([(.47, f'fore_{n}'), (.57, f'upper_{n}')], p[1]); k = ss(.63, .69, p[1])     # 肩头渐渐归到胸，抬手时不撕开
        if k > 0: w = {b: v * (1 - k) for b, v in w.items()}; w['spine2'] = w.get('spine2', 0) + k
        return w
    return fn
w_hand = lambda n: (lambda p: {f'hand_{n}': 1})
w_leg = lambda n: (lambda p: blend([(.22, f'shin_{n}'), (.29, f'thigh_{n}')], p[1]))
w_foot = lambda n: (lambda p: {f'foot_{n}': 1})
w_head = lambda p: {'head': 1}
w_neck = lambda p: blend([(.76, 'neck'), (.82, 'head')], p[1])

# ---------- 身体：每条片从这里改造型（不画写实的脸，SKILL.md 规矩） ----------
ell('头', (0, .872, .006), (.09, .105, .097), '肤', w_head, 40, 28)
tube('颈', [(0, .73, 0, .036), (0, .78, .002, .034), (0, .83, .004, .036)], '肤', w_neck)
loft('躯干', [[.745, 0, .004, .05, .05], [.725, 0, .003, .105, .07], [.695, 0, .002, .132, .085], [.62, 0, .004, .122, .092], [.52, 0, .006, .112, .092], [.44, 0, .006, .118, .094]], '衣', w_trunk, 48)
for s, n in ((1, 'L'), (-1, 'R')):
    tube('袖' + n, [(s * .108, .694, 0, .026), (s * .128, .678, 0, .043), (s * .15, .61, 0, .046), (s * .165, .52, .002, .043), (s * .173, .43, .006, .04), (s * .177, .345, .01, .04)], '衣', w_arm(n), 22)
    ell('手' + n, (s * .178, .305, .012), (.026, .044, .034), '肤', w_hand(n), 18, 12)
    tube('裤' + n, [(s * .066, .47, 0, .05), (s * .068, .36, .002, .048), (s * .07, .25, .005, .046), (s * .07, .15, 0, .041), (s * .07, .075, 0, .036)], '裤', w_leg(n), 22)
    ell('鞋' + n, (s * .07, .03, .04), (.046, .03, .088), '鞋', w_foot(n), 20, 12)

# ---------- 骨骼：骨名不要改 ----------
BONES = [('pelvis', None, (0, .46, 0), (0, .56, 0)), ('spine1', 'pelvis', (0, .56, 0), (0, .66, 0)), ('spine2', 'spine1', (0, .66, 0), (0, .74, 0)), ('neck', 'spine2', (0, .74, 0), (0, .80, .004)), ('head', 'neck', (0, .80, .004), (0, .97, .006))]
for s, n in ((1, 'L'), (-1, 'R')):
    BONES += [(f'upper_{n}', 'spine2', (s * .136, .712, 0), (s * .165, .52, .002)), (f'fore_{n}', f'upper_{n}', (s * .165, .52, .002), (s * .177, .345, .01)), (f'hand_{n}', f'fore_{n}', (s * .177, .345, .01), (s * .178, .265, .012)),
              (f'thigh_{n}', 'pelvis', (s * .07, .46, 0), (s * .07, .25, .005)), (f'shin_{n}', f'thigh_{n}', (s * .07, .25, .005), (s * .07, .06, 0)), (f'foot_{n}', f'shin_{n}', (s * .07, .06, 0), (s * .07, .015, .10))]
arm = bpy.data.armatures.new('骨'); rig = bpy.data.objects.new('角色', arm); bpy.context.collection.objects.link(rig); bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode='EDIT')
for n, par, h, t in BONES:
    b = arm.edit_bones.new(n); b.head, b.tail = B(h), B(t); b.use_deform = True
    if par: b.parent = arm.edit_bones[par]
bpy.ops.object.mode_set(mode='OBJECT')
names = {b[0] for b in BONES}
for o, verts, fn in PARTS:
    o.parent = rig; o.modifiers.new('骨', 'ARMATURE').object = rig
    groups = {}
    for i, v in enumerate(verts):
        w = fn(v); tot = sum(w.values())
        for b, x in w.items():
            assert b in names, b
            if x <= 0: continue
            if b not in groups: groups[b] = o.vertex_groups.new(name=b)
            groups[b].add([i], x / tot, 'REPLACE')
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', use_selection=True, export_yup=True, export_apply=False, export_skins=True, export_animations=False, export_materials='EXPORT', export_lights=False, export_cameras=False)
print('导出', out, sum(len(p[1]) for p in PARTS), '顶点')
