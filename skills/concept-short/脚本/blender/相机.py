"""在 Blender 里打相机关键帧，导出 .glb 给 three.js 播（S3.相机动画 / S3.播相机）。
运行：blender -b -P 相机.py -- <关键帧.json> <输出.glb>
关键帧.json（坐标用 three.js 的：Y 朝上，+Z 朝镜头外；时间是镜头内的秒）：
  { "关键帧": [ { "t": 0, "位置": [-.3, .8, 3.4], "看向": [.05, .42, 0], "视角": 36 },
                { "t": 5.1, "位置": [-.9, 3.1, 9.4], "看向": [.25, 1.55, 0], "视角": 36, "插值": "BEZIER" } ],
    "曲线": "AUTO_CLAMPED" }
  插值：BEZIER（默认，起步加速、到位刹车，像摇臂和推轨）、LINEAR（匀速）、CONSTANT（跳切）；曲线是贝塞尔手柄的类型：AUTO_CLAMPED（不冲过头，默认）、AUTO、VECTOR。
  想再精调：打开 Blender 的曲线编辑器手动拖手柄，存成 .blend，再用这个脚本的导出那一段导出（或在界面里 文件 → 导出 → glTF）。
为什么用 Blender 打相机：曲线编辑器是业内调运镜手感的标准做法；三层相机支架、推轨、摇臂这些运镜都能在里面做，导出的路径 three.js 按时间直接播，跳到任意一秒都一样。
"""
import bpy, json, math, sys
from mathutils import Vector

a = sys.argv[sys.argv.index('--') + 1:]
cfg = json.load(open(a[0], encoding='utf-8')); out = a[1]
for o in list(bpy.data.objects): bpy.data.objects.remove(o)   # 不用 read_factory_settings：重置后 glTF 导出插件会加载不全（ImportError）
sc = bpy.context.scene; FPS = 30; sc.render.fps = FPS; sc.render.resolution_x, sc.render.resolution_y = cfg.get('画幅', [1920, 1080])
b = lambda p: Vector((p[0], -p[2], p[1]))   # three.js（Y 朝上）→ Blender（Z 朝上）

cam = bpy.data.objects.new('相机', bpy.data.cameras.new('相机')); sc.collection.objects.link(cam); sc.camera = cam
cam.data.sensor_fit = 'VERTICAL'; cam.rotation_mode = 'QUATERNION'
keys = cfg['关键帧']
for k in keys:
    f = k['t'] * FPS; sc.frame_set(int(round(f)))
    pos, look = b(k['位置']), b(k['看向'])
    cam.location = pos; cam.rotation_quaternion = (look - pos).to_track_quat('-Z', 'Y')
    cam.data.angle = math.radians(k.get('视角', 34))   # sensor_fit 竖直：这就是竖直视角，和 three.js 的 fov 一致
    cam.keyframe_insert('location', frame=f); cam.keyframe_insert('rotation_quaternion', frame=f); cam.data.keyframe_insert('lens', frame=f)
for owner in (cam, cam.data):
    for fc in owner.animation_data.action.fcurves:
        for i, kp in enumerate(fc.keyframe_points):
            kp.interpolation = keys[min(i, len(keys) - 1)].get('插值', 'BEZIER')
            kp.handle_left_type = kp.handle_right_type = cfg.get('曲线', 'AUTO_CLAMPED')
        fc.update()
sc.frame_start, sc.frame_end = 0, int(math.ceil(keys[-1]['t'] * FPS))
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_cameras=True, export_animations=True, export_yup=True,
                          export_frame_range=True, export_force_sampling=True, export_lights=False)
print('ok', out, len(keys), '个关键帧')
