"""人形模板（出自《傲慢》的兜帽人）：在 Blender 里用脚本建一个兜帽人，带真开口的兜帽、披肩、可选的金冠，衣褶阴影用 Cycles 烘进顶点色，导出 OBJ。
这是模板，不是画风：复制到 片子/<片名>/画风/<画风名>/模型/ 里改（规矩 8），身形、褶、帽口的数都在下面，按这条片的主体改。
运行（说明见 说明.md）：blender -b -P 人形.py -- <输出.obj>
物体名字 three.js 那边按它认：Robe 袍身、Cape 披肩、Hood 兜帽（帽口内壁是 CowlInner 材质）、Crown 金冠
Blender 里 Z 朝上、-Y 是正面；导出时转成 Y 朝上、+Z 正面。整个人高 1.0（three.js 里按画风缩放）
"""
import bpy, bmesh, math, sys
from mathutils import Vector

out = sys.argv[sys.argv.index('--') + 1]
bpy.ops.wm.read_factory_settings(use_empty=True)
TAU = math.tau

def link(name, bm):
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new(name, me); bpy.context.collection.objects.link(ob)
    for p in me.polygons: p.use_smooth = True
    return ob

def mods(ob, solid=0.0, sub=2):
    if solid: m = ob.modifiers.new('solid', 'SOLIDIFY'); m.thickness = solid; m.offset = -1
    m = ob.modifiers.new('sub', 'SUBSURF'); m.levels = m.render_levels = sub

def lathe(name, prof, segs, fold=lambda a, z: 0.0):
    """prof：(半径, 高度) 从下往上；fold(角度, 高度) 返回半径的增量，用来做褶"""
    bm = bmesh.new(); rings = []
    for r, z in prof:
        rings.append([bm.verts.new(((r + fold(a, z)) * math.sin(a), -(r + fold(a, z)) * math.cos(a), z))
                      for a in (TAU * i / segs for i in range(segs))])
    for lo, hi in zip(rings, rings[1:]):
        for i in range(segs): bm.faces.new((lo[i], lo[(i + 1) % segs], hi[(i + 1) % segs], hi[i]))
    return link(name, bm)

# 褶：几组不同频率的正弦叠起来，越往下摆越深；正面（a 接近 0）褶浅一点，像衣襟
def robe_fold(a, z):
    u = max(0.0, 1 - z / 0.7) ** 2
    f = math.sin(a * 9) * .5 + math.sin(a * 14 + 1.3) * .3 + math.sin(a * 5 + .4) * .2
    return f * .03 * u * (1 - .45 * max(0.0, math.cos(a)))

robe = lathe('Robe', [(.30, 0), (.296, .012), (.285, .04), (.255, .2), (.228, .42), (.212, .58), (.205, .66), (.17, .74), (.12, .8), (.085, .82)], 96, robe_fold)
mods(robe, solid=.008)

# 披肩：从胸口斜着往上收到脖子，贴着身子，不平伸；下摆一圈波浪
cape = lathe('Cape', [(.222, .585), (.219, .6), (.212, .64), (.198, .69), (.178, .74), (.16, .78), (.15, .80)], 96,   # 领口压到 .80，不挡帽口
             lambda a, z: (math.sin(a * 11) * .5 + math.sin(a * 6 + .7) * .5) * .012 * max(0.0, 1 - (z - .585) / .26))
for v in cape.data.vertices:   # 下摆高低起伏
    if v.co.z < .62: a = math.atan2(v.co.x, -v.co.y); v.co.z += .012 * math.sin(a * 7 + .5)
mods(cape, solid=.01)

# 兜帽：球面变形——前面往前探、帽檐压低，后面拖出一个软尖；前面挖掉一块椭圆，就是帽口
bm = bmesh.new(); bmesh.ops.create_uvsphere(bm, u_segments=96, v_segments=64, radius=.15)
for v in bm.verts:
    x, y, z = v.co
    fwd = max(0.0, -y / .15); bk = max(0.0, y / .15)
    v.co = Vector((x * (1 - .1 * fwd - .3 * bk ** 2), y * 1.1 - fwd * .03 + bk ** 3 * .1, z * 1.12 - fwd ** 2 * .02 + bk ** 3 * .045))
    v.co.z += .875
hood = link('Hood', bm)
# 帽口：用一个光滑的椭球从正面压进去（布尔差集），压出一个往里凹的深帽腔，边缘是光滑的。
# 椭球偏低、偏窄，上面留出帽檐；腔壁用单独的材质 CowlInner，three.js 里配成深色
def mat(name): m = bpy.data.materials.new(name); return m
hood.data.materials.append(mat('Cloth'))
bm = bmesh.new(); bmesh.ops.create_uvsphere(bm, u_segments=64, v_segments=40, radius=1)
# 拱形帽口：上窄下宽（越往上 x 收得越多），上半截往里退，帽檐就从上面压出来
for v in bm.verts:
    x, y, z = v.co; up = max(0.0, z)
    v.co = Vector((x * .066 * (1 - .35 * up), y * .14 - .175 + up * .035, z * .088 + .852))
cutter = link('Cutter', bm); cutter.data.materials.append(mat('CowlInner'))
b = hood.modifiers.new('cowl', 'BOOLEAN'); b.operation = 'DIFFERENCE'; b.object = cutter; b.solver = 'EXACT'; b.material_mode = 'TRANSFER'
m = hood.modifiers.new('sub', 'SUBSURF'); m.levels = m.render_levels = 1
cutter.hide_set(True); cutter.hide_render = True

# 金冠：一圈细带，正面立五个小尖，戴在帽檐上方，略往后仰
bm = bmesh.new(); segs = 64; R, h = .118, .018
lo = [bm.verts.new((R * math.sin(TAU * i / segs), -R * math.cos(TAU * i / segs), 0)) for i in range(segs)]
hi = []
for i in range(segs):
    a = TAU * i / segs; d = min(abs((a + math.pi) % TAU - math.pi - k * .32) for k in (-2, -1, 0, 1, 2))   # 离五个尖的角距离
    spike = .03 * max(0.0, 1 - d / .09) if abs((a + math.pi) % TAU - math.pi) < .8 else 0
    hi.append(bm.verts.new((R * math.sin(a), -R * math.cos(a), h + spike)))
for i in range(segs): bm.faces.new((lo[i], lo[(i + 1) % segs], hi[(i + 1) % segs], hi[i]))
crown = link('Crown', bm); mods(crown, solid=.006, sub=1)
crown.location = (0, .012, .985); crown.rotation_euler = (math.radians(-12), 0, 0)

# 用内置的 OBJ 导出（C++ 实现，不依赖 glTF 插件）：应用修改器，Y 朝上、-Z 朝前转换，每个物体一组
# 先把兜帽的布尔和细分算成实体网格，再删掉切割体（布尔修改器引用着它，顺序反了兜帽就没开口）
dg = bpy.context.evaluated_depsgraph_get()
baked = bpy.data.meshes.new_from_object(hood.evaluated_get(dg)); hood.modifiers.clear(); hood.data = baked
for p in baked.polygons: p.use_smooth = True
bpy.data.objects.remove(cutter)

# 环境光遮蔽烘进顶点色：褶的凹处、披肩底下、帽腔里自然变暗，three.js 那边乘上去，不用实时算
# 先把所有修改器算成实体网格（烘焙按顶点走，细分后的顶点才够密），再用 Cycles 逐个物体烘
sc = bpy.context.scene; sc.render.engine = 'CYCLES'; sc.cycles.samples = 96; sc.cycles.device = 'CPU'
bpy.ops.mesh.primitive_plane_add(size=6)   # 地面：袍子下摆贴地那一圈也要变暗
floor = bpy.context.object
for ob in [o for o in bpy.data.objects if o.type == 'MESH' and o is not floor]:
    dg = bpy.context.evaluated_depsgraph_get(); me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    ob.modifiers.clear(); ob.data = me
    for p in me.polygons: p.use_smooth = True
    if not me.materials: me.materials.append(mat(ob.name + 'Mat'))
    for m in me.materials: m.use_nodes = True
    me.color_attributes.new('AO', 'FLOAT_COLOR', 'POINT'); me.color_attributes.active_color = me.color_attributes['AO']
for ob in [o for o in bpy.data.objects if o.type == 'MESH' and o is not floor]:
    bpy.ops.object.select_all(action='DESELECT'); ob.select_set(True); bpy.context.view_layer.objects.active = ob
    bpy.ops.object.bake(type='AO', target='VERTEX_COLORS'); print('baked', ob.name, len(ob.data.vertices))
bpy.data.objects.remove(floor)
bpy.ops.wm.obj_export(filepath=out, apply_modifiers=True, export_materials=True, forward_axis='NEGATIVE_Z', up_axis='Y',
                      export_selected_objects=False, export_normals=True, export_uv=False, export_object_groups=False, export_colors=True)
print('ok', out)
