"""把任何模型的环境光遮蔽（凹处变暗）用 Cycles 烘进顶点色，导出带顶点色的 OBJ。three.js 那边 S3.模型 读进来乘上去，不用实时算。
运行：blender -b -P 烘焙.py -- <输入.obj 或 .blend> <输出.obj> [采样数，默认 96]
做法：所有修改器先算成实体网格（烘焙按顶点走，细分后的顶点才够密），加一块临时地面（贴地那一圈也要变暗），逐个物体烘。
这台虚拟机上 EEVEE 跑不了（显卡驱动的存储缓冲上限是 8，EEVEE 要 9–10 个），Cycles 用 CPU 烘没问题。
"""
import bpy, sys
a = sys.argv[sys.argv.index('--') + 1:]
src, out, samples = a[0], a[1], int(a[2]) if len(a) > 2 else 96
if src.endswith('.blend'): bpy.ops.wm.open_mainfile(filepath=src)
else:
    bpy.ops.wm.read_factory_settings(use_empty=True); bpy.ops.wm.obj_import(filepath=src, forward_axis='NEGATIVE_Z', up_axis='Y')
sc = bpy.context.scene; sc.render.engine = 'CYCLES'; sc.cycles.samples = samples; sc.cycles.device = 'CPU'
meshes = [o for o in bpy.data.objects if o.type == 'MESH']
bpy.ops.mesh.primitive_plane_add(size=max(6, max(max(o.dimensions) for o in meshes) * 4)); floor = bpy.context.object
floor.location.z = min(min((o.matrix_world @ v.co).z for v in o.data.vertices) for o in meshes)
for ob in meshes:
    dg = bpy.context.evaluated_depsgraph_get(); me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    ob.modifiers.clear(); ob.data = me
    for p in me.polygons: p.use_smooth = True
    if not me.materials: me.materials.append(bpy.data.materials.new(ob.name + 'Mat'))
    for m in me.materials: m.use_nodes = True
    me.color_attributes.new('AO', 'FLOAT_COLOR', 'POINT'); me.color_attributes.active_color = me.color_attributes['AO']
for ob in meshes:
    bpy.ops.object.select_all(action='DESELECT'); ob.select_set(True); bpy.context.view_layer.objects.active = ob
    bpy.ops.object.bake(type='AO', target='VERTEX_COLORS'); print('烘好', ob.name, len(ob.data.vertices), '个顶点')
bpy.data.objects.remove(floor)
bpy.ops.wm.obj_export(filepath=out, apply_modifiers=True, export_materials=True, forward_axis='NEGATIVE_Z', up_axis='Y',
                      export_selected_objects=False, export_normals=True, export_uv=False, export_object_groups=False, export_colors=True)
print('ok', out)
