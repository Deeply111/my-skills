# 把 Mixamo 的 FBX（Without Skin）转成每帧骨骼数据，坐标换成 three.js 的（y 朝上，角色面朝 +z）。不用手跑，由 脚本/动作库.py 入库 调用。
# blender -b -P 取动作.py -- 输入.fbx 输出.json
import bpy, sys, json
from mathutils import Matrix
a = sys.argv[sys.argv.index('--') + 1:]; src, out = a[0], a[1]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=src, automatic_bone_orientation=False)
rig = next(o for o in bpy.context.scene.objects if o.type == 'ARMATURE')
act = rig.animation_data.action; f0, f1 = map(int, act.frame_range)
C = Matrix(((1, 0, 0, 0), (0, 0, 1, 0), (0, -1, 0, 0), (0, 0, 0, 1)))   # Blender（z 上、面朝 -y）→ three（y 上、面朝 +z）
名 = {b.name: b.name.split(':')[-1] for b in rig.pose.bones}
def 取(M):
    m = C @ M; p = m.to_translation(); q = m.to_quaternion()
    return [round(p.x, 5), round(p.y, 5), round(p.z, 5), round(q.x, 6), round(q.y, 6), round(q.z, 6), round(q.w, 6)]
rest = {名[b.name]: 取(rig.matrix_world @ b.bone.matrix_local) for b in rig.pose.bones}
帧 = []
for f in range(f0, f1 + 1):
    bpy.context.scene.frame_set(f); bpy.context.view_layer.update()
    帧.append({名[b.name]: 取(rig.matrix_world @ b.matrix) for b in rig.pose.bones})
json.dump({'fps': bpy.context.scene.render.fps, '帧数': len(帧), 'rest': rest, '帧': 帧}, open(out, 'w', encoding='utf8'), separators=(',', ':'))
print('完成', out, len(帧), '帧', len(rest), '骨')
