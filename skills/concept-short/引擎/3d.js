// 3D 层（v4，出自《傲慢》）：three.js r160。每条片都加载；镜头写了 三维: 才渲 3D，不写不多花时间。中性的工具，不带任何世界。
// 3D 做空间、光、材质、穿过空间的运镜、有体积的比喻；字、比喻线、UI 仍然是 2D，叠在 3D 上（S3.投影 让它们贴着 3D 里的东西走）。分工见 参考/3D.md。
//
// 布景写在片子的 代码/三维/*.js（或 画风/<名>/三维/*.js），是 ES 模块，render.py 按文件名顺序加载：
//   const { THREE, V3 } = S3;
//   S3.布景('高台', async g => { g.add(new THREE.Mesh(S3.倒角盒(2.4, 1, 2), S3.石材(0x8a909a, .45, .45))); g.光 = S3.光(g); });
//   布景里要等的（模型、贴图）直接 await；全部建好 S3.ready 才算好，render.py 等它再开始渲。
// 镜头里（普通脚本）：
//   SHOT('B2', { 三维: (lt, x) => { S3.显示('高台'); S3.机(V3(-.9, 1.75, 8.2), V3(-.8, .75, 0), { 光圈: .3 }); S3.布景们.高台.光.set(V3(0, 1, 0), 1); },
//                final: (c, lt, x) => { const p = S3.投影(V3(-1.2, 1, .75)); MG.长线(c, [p.x, p.y], ...); } });
//   顺序：先渲 三维（画到画布上），再画 final/board（2D 叠加），再过成片质感、上字幕。只有 3D 没有 2D 叠加时可以不写 final。
// 镜内硬切：S3.机切(lt, [0, t => S3.机(...)], [2.4, t => S3.机(...)])，每段的 t 从段头算；检查按切点算，不报"突然跳动"。
// 随机都用 U.rng(种子)；renderAt 必须是纯函数：同一个 t 画出同一帧（布景的状态每帧按 t 重新设，不靠上一帧）。
import * as THREE from 'three';
// 后期用 pmndrs postprocessing（Zlib）：几个效果并成一遍着色器，比 three.js 自带的一串 Pass 快；环境光遮蔽用 N8AO（ISC）
import { EffectComposer, RenderPass, EffectPass, Effect, EffectAttribute, BloomEffect, ToneMappingEffect, ToneMappingMode, SMAAEffect, SMAAPreset } from 'postprocessing';
import { N8AOPostPass } from 'n8ao';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { Text as TroikaText } from 'troika-three-text';   // 3D 里锐利的字（SDF），MIT
import { Reflector } from 'three/addons/objects/Reflector.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CameraRig, CameraAction } from 'three/addons/three-story-controls.esm.js';   // 纽约时报的相机支架（身体、头、眼睛三层，摄影术语的运镜动作），Apache-2.0

const { W, H } = STAGE, clamp = U.clamp, V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const renderer = new THREE.WebGLRenderer({ antialias: false, stencil: false, depth: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });   // 抗锯齿交给后期（MSAA + SMAA）
renderer.setSize(W, H); renderer.setPixelRatio(1); renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.NoToneMapping; renderer.toneMappingExposure = 1.05;   // 色调映射在后期链里做（S3.色调），曝光仍从这里读
const scene = new THREE.Scene(); scene.background = new THREE.Color(0x06080b); scene.fog = new THREE.FogExp2(0x101318, 0.03);
const camera = new THREE.PerspectiveCamera(34, W / H, 0.1, 200);
const UT = { value: 0 };   // 着色器里的时间（体积光的烟、袍摆）

// ---------- 后期链：渲染（4× MSAA）→ 环境光遮蔽 → 景深 → 泛光 + 色调映射 → SMAA ----------
// 景深：按深度缓冲算每个像素的弥散圆，黄金角螺旋取 20 个样（出自《傲慢》，改写成 postprocessing 的效果）
class DofEffect extends Effect {
  constructor() {
    super('Dof', `uniform float focus, ap;
      float lz(vec2 uv){ return -getViewZ(readDepth(uv)); }
      float coc(vec2 uv){ float z=lz(uv); return clamp(ap*abs(z-focus)/z,0.,1.)*9.*resolution.y/720.; }
      void mainImage(const in vec4 c0, const in vec2 uv, const in float depth, out vec4 o){ float r0=coc(uv); if(ap<=0.||r0<.5){ o=c0; return; }
        vec3 acc=c0.rgb; float ws=1.;
        for(int i=0;i<20;i++){ float fi=float(i)+.5, r=sqrt(fi/20.)*r0, a=fi*2.39996; vec2 q=uv+vec2(cos(a),sin(a))*r*texelSize;
          float w=coc(q)>=r*.6?1.:.2; acc+=texture2D(inputBuffer,q).rgb*w; ws+=w; }
        o=vec4(acc/ws,c0.a); }`, { attributes: EffectAttribute.DEPTH | EffectAttribute.CONVOLUTION, uniforms: new Map([['focus', new THREE.Uniform(5)], ['ap', new THREE.Uniform(0)]]) });
  }
  set focus(v) { this.uniforms.get('focus').value = v; } set ap(v) { this.uniforms.get('ap').value = v; }
}
const composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType, multisampling: 4 });   // 4× MSAA：细边（纸卡的棱）不再一闪一闪
composer.addPass(new RenderPass(scene, camera));
// 环境光遮蔽（N8AO）：缝里、接触的地方自然变暗。半径按米算，每帧 S3.遮蔽 设
const ao = new N8AOPostPass(scene, camera, W, H); Object.assign(ao.configuration, { aoSamples: 16, denoiseSamples: 8, denoiseRadius: 12, gammaCorrection: false, halfRes: false });
composer.addPass(ao);
const dof = new DofEffect(); composer.addPass(new EffectPass(camera, dof));
const bloom = new BloomEffect({ mipmapBlur: true, intensity: 1, luminanceThreshold: .8, luminanceSmoothing: .1, radius: .7 });
const tone = new ToneMappingEffect({ mode: ToneMappingMode.AGX });
composer.addPass(new EffectPass(camera, bloom, tone));
composer.addPass(new EffectPass(camera, new SMAAEffect({ preset: SMAAPreset.HIGH })));

// ---------- 灯：默认一套暗场的环境光（天光、月光、逆光、补光），S3.环境(k) 整体调亮暗 ----------
const hemi = new THREE.HemisphereLight(0x4a5468, 0x0a0c10, 1.0), moon = new THREE.DirectionalLight(0x8090b0, .8), back = new THREE.DirectionalLight(0xb0bcd8, 1.9), fill = new THREE.DirectionalLight(0x7d8698, .55);
moon.position.set(-8, 10, 6); back.position.set(2, 6, -12); fill.position.set(1, 3, 14); scene.add(hemi, moon, back, fill);
const AMB = [hemi, moon, back, fill].map(l => [l, l.intensity]);
// 环境反射：暗渐变的天球加头顶一块暖色光板，给金属和石头的高光一点东西可映
{ const es = new THREE.Scene(); es.add(new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), new THREE.ShaderMaterial({ side: THREE.BackSide,
    vertexShader: `varying vec3 p; void main(){ p=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader: `varying vec3 p; void main(){ float y=normalize(p).y; gl_FragColor=vec4(mix(vec3(.02,.022,.028),vec3(.16,.18,.22),smoothstep(-.2,.8,y)),1.); }` })));
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 1.6, .9), side: THREE.DoubleSide })); panel.position.set(0, 8, 0); panel.rotation.x = Math.PI / 2; es.add(panel);
  const rim = new THREE.Mesh(new THREE.PlaneGeometry(8, 3), new THREE.MeshBasicMaterial({ color: new THREE.Color(.5, .56, .7), side: THREE.DoubleSide })); rim.position.set(0, 2, -9); es.add(rim);
  scene.environment = new THREE.PMREMGenerator(renderer).fromScene(es, .02).texture; }
const ENV0 = scene.environment, SKILL_URL = window.SKILL_URL || '/skill/';
// 实拍环境贴图（Poly Haven CC0 的 HDRI，素材/环境/<名>.hdr；没有的用 脚本/三维素材.py 下）：布景里 g.环境图 = await S3.环境图('fireplace')，
// 显示这个布景时金属、纸、陶土的高光和反射就映着真实的房间；不写的布景用上面那个暗渐变球。只管反射，不当背景
const ENVS = {}, pmrem = new THREE.PMREMGenerator(renderer);
const 环境图 = async 名 => ENVS[名] || (ENVS[名] = new RGBELoader().loadAsync(`${SKILL_URL}素材/环境/${名}.hdr`).then(t => { const e = pmrem.fromEquirectangular(t).texture; t.dispose(); return e; }));

// ---------- 材质和形体 ----------
const TL = new THREE.TextureLoader(), TEX = {}, MAT_URL = SKILL_URL + '素材/材质/';
// 一种材质的几张贴图：按 素材/材质/索引.json（脚本/三维素材.py 写）知道有哪几张——diff 颜色、nor_gl 法线、rough 粗糙度、ao 遮蔽、metal 金属度
let IDX = null;
const loadMat = async kind => TEX[kind] || (TEX[kind] = (async () => {
  IDX = IDX || fetch(MAT_URL + '索引.json').then(r => r.json()); const has = (await IDX)[kind];
  if (!has) throw new Error(`素材/材质/ 里没有 ${kind}（用 脚本/三维素材.py 下，或看 索引.json）`);
  const one = n => has.includes(n) ? TL.loadAsync(`${MAT_URL}${kind}_${n}.jpg`) : null;
  const [map, normalMap, roughnessMap, aoMap, metalnessMap] = await Promise.all(['diff', 'nor_gl', 'rough', 'ao', 'metal'].map(one));
  if (map) map.colorSpace = THREE.SRGBColorSpace;
  const T = { map, normalMap, roughnessMap, aoMap, metalnessMap }; for (const k in T) if (!T[k]) delete T[k]; else { T[k].wrapS = T[k].wrapT = THREE.RepeatWrapping; T[k].anisotropy = 8; }
  return T; })());
// 实拍 PBR 材质（Poly Haven、ambientCG 的 CC0 贴图，素材/材质/，清单见那里的 来源.txt）。布景里 await S3.材质('wood_table_worn', { 平铺: [3, 2], 色: 0xffffff })
//   色 乘在颜色贴图上（调深浅冷暖）；法线 凹凸强弱；粗糙 乘粗糙度；金属 有 metal 贴图时默认 1；反射 环境反射强弱；物理 true 用 MeshPhysical（布料光泽 sheen、清漆 clearcoat 等再自己设）
const 材质 = async (种类, { 平铺 = [1, 1], 色 = 0xffffff, 法线 = 1, 粗糙 = 1, 金属, 反射 = .5, 遮蔽 = 1, 物理 = false } = {}) => { const T = await loadMat(种类), o = {};
  for (const k in T) { o[k] = T[k].clone(); o[k].needsUpdate = true; o[k].repeat.set(...平铺); }
  const M = 物理 ? THREE.MeshPhysicalMaterial : THREE.MeshStandardMaterial;
  return new M({ color: 色, roughness: 粗糙, metalness: 金属 ?? (o.metalnessMap ? 1 : 0), envMapIntensity: 反射, aoMapIntensity: 遮蔽, ...o, normalScale: new THREE.Vector2(法线, 法线) }); };
// 石材（《傲慢》的写法，保留）：cracked_concrete 裂纹混凝土、rough_concrete 粗混凝土、rock_face 岩面
const 石材 = (色, 平铺x = 4, 平铺y = 1, 种类 = 'cracked_concrete', 法线 = 1.2) => 材质(种类, { 平铺: [平铺x, 平铺y], 色, 法线, 反射: .35 });
// Poly Haven 的模型（glTF，脚本/三维素材.py 下到片子的 画风/<名>/模型/）：await S3.gltf(FILM_URL + '画风/暗桌/模型/wooden_stool_01/wooden_stool_01.gltf')，返回场景组，自带材质
const gltf = async url => { const g = (await new GLTFLoader().loadAsync(url)).scene; g.traverse(o => { if (o.isMesh) o.castShadow = o.receiveShadow = true; }); return g; };
// 3D 里的字（troika，SDF 排版，近看也锐利）：await S3.文字('交稿', { 字号: .06, 色: 0x3a2c20, 字重: 900 })。字只在布景里建一次，不按帧改内容；
//   字体用 skill 的 思源宋体（字重 400 / 600 / 900）；返回的物体当普通 Mesh 摆（默认面朝 +z、居中）；材质可换（.material = 任意 three 材质，会自动带上字形）
const 文字 = async (字, { 字号 = .1, 色 = 0xffffff, 字重 = 900, 宽, 行距 = 1.2, 字距 = 0, 对齐 = 'center', 描边 = 0, 描边色 = 0x000000 } = {}) => {
  const t = new TroikaText(); Object.assign(t, { text: 字, fontSize: 字号, color: 色, font: (window.GLYPH_FONTS || {})[`Song-${字重}`], anchorX: 'center', anchorY: 'middle',
    maxWidth: 宽 ?? Infinity, lineHeight: 行距, letterSpacing: 字距, textAlign: 对齐, outlineWidth: 描边, outlineColor: 描边色, sdfGlyphSize: 128 });
  await new Promise(r => t.sync(r)); return t; };
// 带倒角的方块：棱上接得住一线高光，不是生硬的 CG 方盒
const 倒角盒 = (w, h, d, b = .025) => { const s = new THREE.Shape(), x = w / 2 - b, y = h / 2 - b;
  s.moveTo(-x, -y); s.lineTo(x, -y); s.lineTo(x, y); s.lineTo(-x, y); s.lineTo(-x, -y);
  const geo = new THREE.ExtrudeGeometry(s, { depth: Math.max(.001, d - 2 * b), bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelSegments: 3, curveSegments: 1 });
  geo.translate(0, 0, -(d - 2 * b) / 2); geo.computeVertexNormals(); return geo; };
// Blender 导出的 OBJ（带烘焙进顶点色的阴影，见 脚本/blender/）。遮蔽拉开：按 5%、97% 分位把阴影值拉到 [下, 1]，凹处更暗
const 模型 = async (url, { 遮蔽拉开 = [.16, 1] } = {}) => {
  const obj = await new OBJLoader().loadAsync(url), all = [];
  obj.traverse(o => { const c = o.isMesh && o.geometry.attributes.color; if (c) for (let i = 0; i < c.count; i += 7) all.push(c.getX(i)); });
  if (all.length && 遮蔽拉开) { all.sort((a, b) => a - b); const lo = all[all.length * .05 | 0], hi = all[all.length * .97 | 0], [a, b] = 遮蔽拉开;
    obj.traverse(o => { const c = o.isMesh && o.geometry.attributes.color; if (!c) return;
      for (let i = 0; i < c.count; i++) { const v = a + (b - a) * Math.pow(clamp((c.getX(i) - lo) / (hi - lo)), 1.1); c.setXYZ(i, v, v, v); } }); }
  return obj;
};
// 布料轻摆：材质挂上这个，越往下（模型本地 y 越小）摆幅越大，每个物体按位置错开相位
const 摆动 = (m, { 高 = .8, 幅 = .006 } = {}) => { m.onBeforeCompile = sh => { sh.uniforms.uT = UT; sh.vertexShader = 'uniform float uT;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
    float ph=modelMatrix[3].x*2.3+modelMatrix[3].z*1.7; float sw=pow(1.-clamp(position.y/${高.toFixed(3)},0.,1.),1.5);
    transformed.x+=(sin(uT*1.3+ph+position.y*6.)*${幅}+sin(uT*2.9+ph*1.3+position.z*9.)*${幅 / 3})*sw;
    transformed.z+=(cos(uT*1.1+ph*.7+position.y*5.)*${幅 * .8})*sw;`); }; m.customProgramCacheKey = () => 'sway' + 高 + 幅; return m; };

// ---------- 可平铺的分形噪声（云的质感）、雾团、贴地低雾 ----------
const 平铺噪声 = (N, seed, oct, per, fn) => {
  const c = document.createElement('canvas'); c.width = c.height = N; const g = c.getContext('2d'), img = g.createImageData(N, N), r = U.rng(seed);
  const L = []; for (let o = 0; o < oct; o++) { const P = per << o, a = new Float32Array(P * P); for (let i = 0; i < P * P; i++) a[i] = r(); L.push([P, a]); }
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { let v = 0, amp = .5, tot = 0;
    for (const [P, a] of L) { const fx = x / N * P, fy = y / N * P, ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy, sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      const q = (i, j) => a[((j % P) * P + (i % P))];
      v += amp * ((q(ix, iy) * (1 - sx) + q(ix + 1, iy) * sx) * (1 - sy) + (q(ix, iy + 1) * (1 - sx) + q(ix + 1, iy + 1) * sx) * sy); tot += amp; amp *= .5; }
    const k = (y * N + x) * 4, al = fn(v / tot, x / N - .5, y / N - .5); img.data[k] = img.data[k + 1] = img.data[k + 2] = 255; img.data[k + 3] = al * 255; }
  g.putImageData(img, 0, 0); return c; };
const TICK = [];   // 每帧按 t 更新的东西（雾的漂移）
let puff = null;
// 远处一圈雾团（不旋转，旋转会拉出条纹）：种子、个数、离中心的远近、色
const 雾团 = (parent, { 种子 = 71, 个数 = 46, 近 = 9, 远 = 25, 色 = 0x646a74, 弧 = [1.08, .84] } = {}) => {
  puff = puff || new THREE.CanvasTexture(平铺噪声(256, 77, 5, 4, (v, x, y) => { const m = clamp(1 - Math.hypot(x * 2.1, y * 2.1)); return clamp((v - .38) * 2.2) * m * m * (3 - 2 * m) * .55; }));
  const grp = new THREE.Group(), r = U.rng(种子), list = [];
  for (let i = 0; i < 个数; i++) {
    const a = Math.PI * (弧[0] + r() * 弧[1]), d = 近 + r() * (远 - 近), sz = 4 + r() * 5;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: puff, color: 色, transparent: true, opacity: .35 + r() * .35, depthWrite: false, fog: false }));
    s.scale.set(sz * 2.4, sz * .55, 1); s.position.set(Math.cos(a) * d, sz * .26 + .05 + r() * .3, Math.sin(a) * d * .8 - 2); grp.add(s); list.push({ s, x0: s.position.x, v: (r() - .4) * .25 });
  }
  TICK.push(t => list.forEach(f => f.s.position.x = f.x0 + t * f.v)); parent.add(grp); return grp;
};
const 低雾 = (parent, { 色 = 0x707680, 浓 = 1, 大小 = 70 } = {}) => {
  const t = new THREE.CanvasTexture(平铺噪声(512, 88, 6, 3, v => clamp((v - .3) * 1.6) * .5)); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(4, 4);
  const t2 = t.clone(); t2.needsUpdate = true; t2.repeat.set(2.3, 2.3); const grp = new THREE.Group();
  for (const [yy, op, tx] of [[.06, .55, t], [.3, .32, t2]]) { const m = new THREE.Mesh(new THREE.PlaneGeometry(大小, 大小), new THREE.MeshBasicMaterial({ map: tx, color: 色, transparent: true, opacity: op * 浓, depthWrite: false }));
    m.rotation.x = -Math.PI / 2; m.position.y = yy; grp.add(m); }
  TICK.push(s => { t.offset.set(s * .012, s * .004); t2.offset.set(-s * .007, s * .009); }); parent.add(grp); return grp;
};

// ---------- 光：聚光灯 + 体积光柱（光线步进，带流动的烟）+ 柔边落地光 ----------
const volVS = `varying vec3 vW; void main(){ vec4 w=modelMatrix*vec4(position,1.); vW=w.xyz; gl_Position=projectionMatrix*viewMatrix*w; }`;
const volFS = `uniform float k,time,r0,r1,hgt; uniform vec3 col,apex; varying vec3 vW;
  float hs(vec3 p){ p=fract(p*.3183099+.1); p*=17.; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
  float vn(vec3 x){ vec3 i=floor(x),f=fract(x); f=f*f*(3.-2.*f);
    return mix(mix(mix(hs(i),hs(i+vec3(1,0,0)),f.x),mix(hs(i+vec3(0,1,0)),hs(i+vec3(1,1,0)),f.x),f.y),
               mix(mix(hs(i+vec3(0,0,1)),hs(i+vec3(1,0,1)),f.x),mix(hs(i+vec3(0,1,1)),hs(i+vec3(1,1,1)),f.x),f.y),f.z); }
  float dens(vec3 p){ float h=clamp((apex.y-p.y)/hgt,0.,1.); float R=mix(r0,r1,h); float rr=length(p.xz-apex.xz)/R; if(rr>1.) return 0.;
    float n=vn(p*vec3(4.,.8,4.)+vec3(0.,time*.35,0.))*.6+vn(p*vec3(9.,2.,9.)+vec3(time*.12,time*.6,0.))*.4;
    float core=exp(-rr*rr*40.)*1.3, body=exp(-rr*rr*6.)*(.15+.55*n);
    return (core+body)*(.35+.65*h)*smoothstep(0.,.12,h)*smoothstep(1.,.9,h)*(1.-rr*rr); }   // 贴近地面的一截收掉，不糊住人
  void main(){ vec3 rd=normalize(vW-cameraPosition); float st=r1*2.4/18., a=0.; vec3 p=vW;
    for(int i=0;i<18;i++){ a+=dens(p)*st; p+=rd*st; }
    gl_FragColor=vec4(col*k*a*1.1,1.); }`;
let poolTex = null;
const 光 = (parent, { 色 = 0xffb870, 柱色 = 0xffa45a, 高 = 13 } = {}) => {
  poolTex = poolTex || new THREE.CanvasTexture(平铺噪声(256, 19, 4, 4, (v, x, y) => { const d = Math.hypot(x, y) * 2; return clamp(1 - d) ** 1.6 * (.75 + .5 * v); }));
  const L = { spot: new THREE.SpotLight(色, 0, 30, .085, .7, 1.2),
    vol: new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 40, 1, true), new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
      uniforms: { k: { value: 0 }, time: UT, r0: { value: .1 }, r1: { value: .4 }, hgt: { value: 高 }, col: { value: new THREE.Color(柱色) }, apex: { value: V3(0, 0, 0) } }, vertexShader: volVS, fragmentShader: volFS })),
    pool: new THREE.Mesh(new THREE.CircleGeometry(1.1, 48), new THREE.MeshBasicMaterial({ map: poolTex, color: 0xffa860, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })) };
  L.spot.castShadow = true; L.spot.shadow.mapSize.set(1024, 1024); L.spot.shadow.bias = -.001; L.spot.shadow.normalBias = .05; L.spot.shadow.radius = 4;
  L.pool.rotation.x = -Math.PI / 2; parent.add(L.spot, L.spot.target, L.vol, L.pool);
  // 把光放到落点 p 上：亮度 k 0–1、宽度 w 倍、张角 ang
  L.set = (p, k, w = 1, ang = .085) => { L.spot.position.set(p.x, p.y + 高, p.z); L.spot.target.position.copy(p); L.spot.intensity = 60 * k; L.spot.angle = ang;
    const u = L.vol.material.uniforms, r0 = .08 * w, r1 = .3 * w; u.k.value = k; u.r0.value = r0; u.r1.value = r1;
    L.vol.updateMatrixWorld(); u.apex.value.copy(parent.localToWorld(V3(p.x, p.y + 高, p.z)));
    L.vol.position.set(p.x, p.y + 高 / 2, p.z); L.vol.scale.set(1, 高, 1); L.vol.geometry.dispose();
    L.vol.geometry = new THREE.CylinderGeometry(r0 * 1.15, r1 * 1.15, 1, 40, 1, true); L.vol.visible = k > .001;
    L.pool.position.set(p.x, p.y + .006, p.z); L.pool.scale.setScalar(w); L.pool.material.opacity = .42 * k; };
  return L;
};
// 光束里的浮尘：大小不一，有的离焦（大而淡）
const 浮尘 = (parent, { 个数 = 240, 色 = 0xffc888, 种子 = 404 } = {}) => {
  const r = U.rng(种子), base = [], pos = new Float32Array(个数 * 3); for (let i = 0; i < 个数; i++) base.push([r() - .5, r(), r() - .5, .02 + r() * .05]);
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: 色, size: 2.0 * H / 720, sizeAttenuation: false, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  parent.add(pts);
  pts.set = (p, t, k, w = 1) => { base.forEach(([x, y, z, v], i) => { const yy = (y + t * v) % 1; pos.set([p.x + x * .7 * w * (.3 + yy) + Math.sin(t * .7 + i) * .02, p.y + (1 - yy) * 4, p.z + z * .7 * w], i * 3); });
    geo.attributes.position.needsUpdate = true; pts.material.opacity = .65 * k; };
  return pts;
};

// ---------- 镜面：软边、可淡入；藏 里的物体不出现在倒影里（《傲慢》镜子里没有金冠）----------
// 镜面要比地面高一点（默认 .012），不然从地下的虚拟机位往上看会被地面挡住；倒影里看得到多远，取决于镜面伸到多靠近镜头
const 镜面 = (parent, { 半径 = 2, 位置 = V3(0, .012, 0), 藏 = [], 亮 = 2.6, 分辨率 = .67 } = {}) => {
  const shader = { uniforms: { color: { value: V3(亮, 亮 * .97, 亮 * .93) }, tDiffuse: { value: null }, textureMatrix: { value: null }, op: { value: 0 } },
    vertexShader: `uniform mat4 textureMatrix; varying vec4 vP; varying vec2 vU; void main(){ vU = uv; vP = textureMatrix * vec4(position, 1.); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
    fragmentShader: `uniform vec3 color; uniform sampler2D tDiffuse; uniform float op; varying vec4 vP; varying vec2 vU;
      void main(){ vec3 b = texture2DProj(tDiffuse, vP).rgb; float r = length(vU - .5) * 2.; gl_FragColor = vec4(b * color, op * smoothstep(1., .45, r)); }` };
  const m = new Reflector(new THREE.CircleGeometry(1, 72), { textureWidth: Math.round(W * 分辨率), textureHeight: Math.round(H * 分辨率), clipBias: 0, shader });
  Object.assign(m.material, { transparent: true, depthWrite: false }); m.rotation.x = -Math.PI / 2; m.position.copy(位置); m.scale.set(半径, 半径, 1); parent.add(m);
  const rb = m.onBeforeRender; m.onBeforeRender = (...a) => { if (m.material.uniforms.op.value <= 0) return; const hid = 藏.filter(o => o.visible); hid.forEach(o => o.visible = false); rb(...a); hid.forEach(o => o.visible = true); };
  m.淡 = k => { m.material.uniforms.op.value = k; m.visible = k > 0; };
  return m;
};

// ---------- 布景、相机、每帧 ----------
const SETS = {}, BUILDS = [];
const 布景 = (name, fn) => { if (SETS[name]) throw new Error(`3D 布景 ${name} 登记了两次`); const g = new THREE.Group(); g.visible = false; scene.add(g); SETS[name] = g; BUILDS.push(Promise.resolve(fn(g, S3))); return g; };
const 显示 = name => { if (!SETS[name]) throw new Error(`没有 3D 布景 ${name}`); for (const k in SETS) SETS[k].visible = k === name; scene.environment = SETS[name].环境图 || ENV0; };
const 环境 = k => AMB.forEach(([l, i0]) => l.intensity = i0 * k);
let TNOW = 0;
// ---------- 相机：挂在 three-story-controls 的支架上（身体管位置，头和眼睛管朝向），动作都是摄影术语 ----------
// 每帧先把支架复位到"基础机位"，再把这一刻各个运镜动作该走到的量执行上去：跳到任意 t 都一样（纯函数）
const rig = new CameraRig(camera, scene), _look = new THREE.PerspectiveCamera(), _up = V3(0, 1, 0);
const 摆 = (pos, look) => { _look.position.copy(pos); _look.up.copy(_up); _look.lookAt(look); _look.updateMatrixWorld(); rig.setWorldCoordinates({ position: pos.clone(), quaternion: _look.quaternion.clone() }); };
const 收尾 = (pos, look, o) => {   // 呼吸、冲击、视角、景深：所有运镜最后都过这一道
  const t = TNOW, a = o.呼吸 ?? 1, s = pos.distanceTo(look) * .0013 * a, kick = o.冲击 || 0, d = pos.distanceTo(look);
  const n = (f, p) => Math.sin(t * f + p) * .6 + Math.sin(t * f * 2.13 + p * 1.7) * .3 + Math.sin(t * f * 4.71 + p * .3) * .1;
  rig.do(CameraAction.Truck, n(.7, 1) * s); rig.do(CameraAction.Pedestal, n(.9, 2) * s + kick * .4);
  rig.do(CameraAction.Tilt, (n(.8, 5) * s * .35 - kick) / d); rig.do(CameraAction.Pan, -(n(.6, 4) * s * .35 + kick * .3) / d, 'eyes');
  rig.do(CameraAction.Roll, n(.45, 6) * .0035 * a + (o.滚 || 0));
  camera.fov = o.视角 ?? 34; camera.aspect = W / H; camera.updateProjectionMatrix(); rig.body.updateMatrixWorld(true);
  dof.focus = o.对焦 ?? camera.getWorldPosition(V3(0, 0, 0)).distanceTo(look); dof.ap = o.光圈 ?? .35;
};
// 相机：位置、看向；视角（度）、对焦（默认看向点的距离）、光圈（景深强弱，0 不虚）、呼吸（极轻的手持感，默认 1 = 距离 × 0.13%；对标的机位几乎锁死）、冲击（S3.冲击 的值）、滚（弧度）
const 机 = (pos, look, o = {}) => { 摆(pos, look); 收尾(pos, look, o); };
// 运镜：基础机位 + 一串运镜动作，每个动作有 从/到（镜头内秒）和 曲线（GSAP 的名字，默认 'power2.inOut'）：
//   S3.运镜(lt, { 位置, 看向, 视角 }, [{ 推: .6, 从: 0, 到: 4 }, { 摇: 8 }, { 漂: .01 }], { 时长: x.d, 光圈, 对焦, 呼吸, 冲击 })
//   推 / 拉 米（沿视线前后，推轨 dolly）；横移 米（往右为正，truck）；升降 米（往上为正，pedestal）；
//   摇 度（往左为正，pan）；俯仰 度（往上为正，tilt）；滚 度（roll）；变焦 视角（度，从基础视角变到这个）；
//   环绕 度（绕 心 转，默认绕看向点，往右为正）；漂 每秒比例（匀速往前推，静止镜头也活着：.01 = 每秒推近 1% 的距离）
const 运镜 = (lt, 基, 动作 = [], o = {}) => {
  // 每个动作的进度 0–1：从 从 走到 到（不写 到 就走到这一镜结束 o.时长，没给时长按 4 秒），曲线是 GSAP 的名字
  const P = m => { const t0 = m.从 ?? 0, t1 = m.到 ?? o.时长 ?? t0 + 4; return lt <= t0 ? 0 : lt >= t1 ? 1 : gsap.parseEase(m.曲线 || 'power2.inOut')((lt - t0) / (t1 - t0)); };
  let pos = 基.位置.clone(); const look = 基.看向.clone(), dist = pos.distanceTo(look); let fov = 基.视角 ?? o.视角 ?? 34;
  for (const m of 动作) if ('环绕' in m) { const c = m.心 || look, a = -m.环绕 * Math.PI / 180 * P(m);
    pos.sub(c).applyAxisAngle(_up, a).add(c); }
  摆(pos, look);
  for (const m of 动作) {
    const kk = P(m);
    if ('推' in m) rig.do(CameraAction.Dolly, -m.推 * kk); if ('拉' in m) rig.do(CameraAction.Dolly, m.拉 * kk);
    if ('横移' in m) rig.do(CameraAction.Truck, m.横移 * kk); if ('升降' in m) rig.do(CameraAction.Pedestal, m.升降 * kk);
    if ('漂' in m) rig.do(CameraAction.Dolly, -dist * m.漂 * Math.max(0, lt - (m.从 || 0)));
    if ('摇' in m) rig.do(CameraAction.Pan, m.摇 * Math.PI / 180 * kk, 'eyes'); if ('俯仰' in m) rig.do(CameraAction.Tilt, m.俯仰 * Math.PI / 180 * kk);
    if ('滚' in m) rig.do(CameraAction.Roll, m.滚 * Math.PI / 180 * kk); if ('变焦' in m) fov += (m.变焦 - fov) * kk;
  }
  收尾(pos, look, Object.assign({}, o, { 视角: fov }));
};
// Blender 里打的相机动画（脚本/blender/相机.py 导出的 .glb）：布景里 await S3.相机动画('名', 地址)，镜头里 S3.播相机('名', lt, { 光圈, 对焦 })
const CAMS = {};
const 相机动画 = async (名, url) => { const g = await new GLTFLoader().loadAsync(url); const cam = g.cameras[0]; if (!cam) throw new Error(`${url} 里没有相机`);
  const mixer = new THREE.AnimationMixer(g.scene); g.animations.forEach(c => mixer.clipAction(c).play()); CAMS[名] = { g, cam, mixer, 长: Math.max(0, ...g.animations.map(c => c.duration)) }; return CAMS[名]; };
const 播相机 = (名, t, o = {}) => { const C = CAMS[名]; if (!C) throw new Error(`没有相机动画 ${名}`);
  C.mixer.setTime(Math.min(Math.max(0, t), C.长)); C.g.scene.updateMatrixWorld(true);
  const pos = C.cam.getWorldPosition(V3(0, 0, 0)), q = C.cam.getWorldQuaternion(new THREE.Quaternion()), fwd = V3(0, 0, -1).applyQuaternion(q);
  rig.setWorldCoordinates({ position: pos, quaternion: q }); 收尾(pos, o.看向 || pos.clone().add(fwd.multiplyScalar(o.对焦 || 5)), Object.assign({ 视角: C.cam.fov, 呼吸: 0 }, o)); };
// 镜内硬切：段 [起秒, t => 摆机位]；返回第几段，并告诉检查这是新的一段
const 机切 = (lt, ...segs) => { let i = 0; while (i + 1 < segs.length && lt >= segs[i + 1][0]) i++; segs[i][1](lt - segs[i][0]); window.__SEG = i; return i; };
// 冲击：t0 那一下，之后快速衰减的抖动（给 机 的 冲击，或物体的位移）
const 冲击 = (t, t0, amp = .012) => t < t0 ? 0 : amp * Math.exp(-(t - t0) * 9) * Math.sin((t - t0) * 55);
// 3D 点 → 画面像素（2D 叠加用，按当前相机）
const 投影 = p => { camera.updateMatrixWorld(true); const v = p.clone().project(camera); return { x: (v.x + 1) / 2 * W, y: (1 - v.y) / 2 * H, 前: v.z < 1 }; };
// 泛光：强（默认 .55）、半径 0–1（默认 .55）、门槛（亮过多少才发光，默认 .8）。数和《傲慢》的写法一样，内部换算成 mipmap 泛光
const 泛光 = (强 = .55, 半径 = .55, 门槛 = .8) => { bloom.intensity = 强 * BLOOM_K; bloom.mipmapBlurPass.radius = .35 + .55 * 半径; bloom.luminanceMaterial.threshold = 门槛; };
const BLOOM_K = 1.6;
// 环境光遮蔽：强（默认 1，0 关）、半径（米，默认按布景尺度 .5）、衰减（默认 1）。每帧复位，镜头里要改再调
const AO0 = { 强: 1, 半径: .5, 衰减: 1 }; let AOD = { ...AO0 };
const 遮蔽 = (强 = AOD.强, 半径 = AOD.半径, 衰减 = AOD.衰减) => { ao.enabled = 强 > 0; const c = ao.configuration;
  if (c.intensity !== 强 * 2.5) c.intensity = 强 * 2.5; if (c.aoRadius !== 半径) c.aoRadius = 半径; if (c.distanceFalloff !== 衰减) c.distanceFalloff = 衰减; };
// 整条片的默认（在布景模块里调一次）：S3.遮蔽默认({ 半径: .12 })——小桌面的场景半径要小，台阶、房间的大
const 遮蔽默认 = o => { AOD = { ...AO0, ...o }; };
// 色调映射：'AGX'（默认，高光过渡自然、亮处不发假的青黄）或 'ACES'（《傲慢》的，更艳更硬）。整条片定一次
const 色调 = m => { tone.mode = ToneMappingMode[m === 'ACES' ? 'ACES_FILMIC' : m]; };

// ---------- 模拟回放：Blender 里刚体、布料算好烘焙下来（脚本/blender/模拟.py），这里按 t 读，跳到任意一帧都一样 ----------
// 布景里：const 塔倒 = await S3.回放(FILM_URL + '画风/暗桌/模型/塔倒.json', { 材质: (名, o) => 纸 }); g.add(塔倒);
// 镜头里：S3.布景们.桌面.塔倒.到(lt - 1.2)（t 是模拟自己的秒数，<0 停在第一帧，超过停在最后一帧）；塔倒.物体['Card.012'] 是单个物体
const 回放 = async (url, { 材质: mk = () => new THREE.MeshStandardMaterial({ color: 0xc8c0b4, roughness: .8 }) } = {}) => {
  const D = await (await fetch(url)).json(), bin = D.物体.some(o => o.类 === '布料') ? new Float32Array(await (await fetch(url.replace(/\.json$/, '.bin'))).arrayBuffer()) : null;
  const g = new THREE.Group(), qa = new THREE.Quaternion(), qb = new THREE.Quaternion(); g.物体 = {};
  for (const o of D.物体) {
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(o.顶点, 3));
    if (o.法线) geo.setAttribute('normal', new THREE.Float32BufferAttribute(o.法线, 3)); if (o.uv) geo.setAttribute('uv', new THREE.Float32BufferAttribute(o.uv, 2));
    if (o.索引) geo.setIndex(o.索引); if (!o.法线) geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, mk(o.名, o)); m.name = o.名; m.castShadow = m.receiveShadow = true; m.frustumCulled = o.类 !== '布料';
    if (o.缩放) m.scale.set(...o.缩放); g.add(m); g.物体[o.名] = m; o.m = m;
  }
  g.到 = t => { const f = clamp(t * D.fps, 0, D.帧数 - 1), i = Math.floor(f), j = Math.min(i + 1, D.帧数 - 1), k = f - i;
    for (const o of D.物体) { const m = o.m;
      if (o.类 === '刚体') { const a = o.轨, A = i * 7, B = j * 7;
        m.position.set(a[A] + (a[B] - a[A]) * k, a[A + 1] + (a[B + 1] - a[A + 1]) * k, a[A + 2] + (a[B + 2] - a[A + 2]) * k);
        qa.fromArray(a, A + 3); qb.fromArray(a, B + 3); m.quaternion.slerpQuaternions(qa, qb, k); }
      else { const n = o.顶点.length, P = m.geometry.attributes.position, A = o.偏移 + i * n, B = o.偏移 + j * n;
        for (let q = 0; q < n; q++) P.array[q] = bin[A + q] + (bin[B + q] - bin[A + q]) * k;
        P.needsUpdate = true; m.geometry.computeVertexNormals(); } } };
  g.到(0); g.时长 = (D.帧数 - 1) / D.fps; return g;
};

// stage.js 调：这一镜写了 三维 就先渲 3D 画到 c 上
const frame = (c, id, lt, x) => {
  const s = TIMELINE.find(q => q.id === id); TNOW = (s ? s.from : 0) + lt; UT.value = TNOW;
  环境(1); 泛光(); 遮蔽(); scene.fog.density = .03; globalThis.__N8AO_T = TNOW;
  SHOTS[id].三维(lt, x); TICK.forEach(f => f(TNOW));
  composer.render(); c.drawImage(renderer.domElement, 0, 0);
};

// ---------- 绑骨人物：造型在片子里建（脚本/blender/绑骨人.py），姿势每帧按 t 算；身体动作可以用动作捕捉（参考/动作.md「人物动作怎么选」） ----------
// const 人 = await S3.人物(FILM_URL + '画风/x/模型/人.glb', { 双面: ['衣'], 附件 });  await 人.载动作('站起');   // 动作读 片子/素材/动作/站起.json（脚本/动作库.py 取）
// 镜头里：人.摆(人.捕('站起', { 起, 速, 循环, 就地, 偏, 脚偏, 抬头 }), lt)；几个动作连着：人.摆(人.串([{ 名: '站起', 时长: 2.6 }, { 名: '低头走', 循环: true, 时长: 3 }], { 过渡: .4 }), lt)；也可以自己写姿势函数：人.摆(t => ({ 盆, 盆转, 腰, 胸, 颈, 头, 脚L, 脚R, 手L, 手R }), lt)
// 附件(c)：下摆、围巾这类随身体动的东西（骨名不限），在 c.D 里写它们相对静止姿势的转动；c.前、c.再前 是 .1、.2 秒前的解，用来算迟滞。没写的骨跟父骨转。
const 人物 = async (地址, 选 = {}) => {
  const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z), Q = () => new THREE.Quaternion(), E = (x, y = 0, z = 0) => Q().setFromEuler(new THREE.Euler(x, y, z, 'YXZ'));
  const 模 = await new GLTFLoader().loadAsync(地址), root = 模.scene, g = new THREE.Group(); g.add(root);
  root.traverse(o => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; o.frustumCulled = false; if ((选.双面 || []).includes(o.material.name)) o.material.side = THREE.DoubleSide; } });
  const 骨 = {}, 顺序 = []; root.traverse(o => { if (o.isBone) { 骨[o.name] = o; 顺序.push(o.name); } });   // traverse 先父后子
  for (const n of ['pelvis', 'spine1', 'spine2', 'neck', 'head', ...['upper', 'fore', 'hand', 'thigh', 'shin', 'foot'].flatMap(b => [b + '_L', b + '_R'])]) if (!骨[n]) throw new Error(`${地址} 少了骨头 ${n}（骨名见 脚本/blender/绑骨人.py）`);
  root.updateMatrixWorld(true); const 逆 = root.matrixWorld.clone().invert(), R = {}, P = {};
  for (const n in 骨) { const m = 逆.clone().multiply(骨[n].matrixWorld), p = V(), q = Q(), s = V(); m.decompose(p, q, s); R[n] = q; P[n] = p; }
  const 骨父 = n => 骨[n].parent && 骨[n].parent.isBone ? 骨[n].parent.name : null, 根父 = 骨.pelvis.parent; 根父.updateMatrixWorld(true);
  const 根父逆 = 逆.clone().multiply(根父.matrixWorld).invert(), 根父转 = Q(); { const p = V(), s = V(); 逆.clone().multiply(根父.matrixWorld).decompose(p, 根父转, s); }
  const 段长 = (a, b) => P[a].distanceTo(P[b]), 方向 = (a, b) => P[b].clone().sub(P[a]).normalize(), 对向 = (rest, 向) => Q().setFromUnitVectors(rest, 向.clone().normalize());
  const 腿长 = [段长('thigh_L', 'shin_L'), 段长('shin_L', 'foot_L')], 臂长 = [段长('upper_L', 'fore_L'), 段长('fore_L', 'hand_L')];
  const 反解 = (根, 目标, 长, 极) => { const d = 目标.clone().sub(根), L = Math.min(d.length(), (长[0] + 长[1]) * .999); d.normalize(); const a = (长[0] * 长[0] - 长[1] * 长[1] + L * L) / (2 * L), h = Math.sqrt(Math.max(0, 长[0] * 长[0] - a * a)), 侧 = 极.clone().sub(d.clone().multiplyScalar(极.dot(d))).normalize(); const 膝 = 根.clone().add(d.multiplyScalar(a)).add(侧.multiplyScalar(h)); return [膝, 根.clone().add(目标.clone().sub(根).setLength(L))]; };
  const 随 = (J, n, 父, D0) => { J[n] = J[父].clone().add(P[n].clone().sub(P[父]).applyQuaternion(D0)); };
  const 腿角 = J => ['L', 'R'].map(s => { const v = J['shin_' + s].clone().sub(J['thigh_' + s]); return Math.atan2(v.z, -v.y); });
  // 动作捕捉：躯干和脚取每帧世界朝向相对 T 姿势的转动；手臂只取方向（T 姿势和这里的静止姿势不同）；脚用反解踩在目标点上，膝盖朝向跟数据
  const 动作库 = {}, 比例 = d => P.pelvis.y / d.rest.Hips[1];
  g.载动作 = async (名, 路 = FILM_URL + '素材/动作/' + encodeURIComponent(名) + '.json') => { const r = await fetch(路); if (!r.ok) throw new Error(`读不到动作 ${路}：先 python 脚本/动作库.py 取 ${名} <片子目录>`); 动作库[名] = await r.json(); };
  g.捕 = (名, c = {}) => t => { const d = 动作库[名], N = d.帧数, s = 比例(d); let f = (c.起 || 0) * 30 + t * (c.速 || 1) * 30, 圈 = 0; if (c.循环) { 圈 = Math.floor(f / (N - 1)); f -= 圈 * (N - 1); } f = clamp(f, 0, N - 1); const i = Math.floor(f), j = Math.min(N - 1, i + 1), w = f - i;
    const 根a = d.帧[0].Hips, 根b = d.帧[N - 1].Hips, 取 = b => { const A = d.帧[i][b], B = d.帧[j][b]; return { p: V(A[0], A[1], A[2]).lerp(V(B[0], B[1], B[2]), w), q: new THREE.Quaternion(A[3], A[4], A[5], A[6]).slerp(new THREE.Quaternion(B[3], B[4], B[5], B[6]), w) }; };
    const 差 = b => { const r = d.rest[b]; return 取(b).q.multiply(new THREE.Quaternion(r[3], r[4], r[5], r[6]).invert()); };
    const 髋 = 取('Hips').p, 移 = c.就地 ? V(髋.x, 0, 髋.z).negate() : V(圈 * (根b[0] - 根a[0]), 0, 圈 * (根b[2] - 根a[2])), 偏 = c.偏 ? c.偏(髋.y, t) : [0, 0, 0], 脚偏 = c.脚偏 || [0, 0];
    const 位 = b => 取(b).p.add(移).multiplyScalar(s), 盆转 = new THREE.Euler().setFromQuaternion(差('Hips'), 'YXZ'), 肢 = {};
    for (const [n, B, 边] of [['L', 'Left', 1], ['R', 'Right', -1]]) { const 髋点 = 取(B + 'UpLeg').p, 膝 = 取(B + 'Leg').p, 踝 = 取(B + 'Foot').p, 窄 = 边 * (Math.abs(P['thigh_' + n].x) - Math.abs(d.rest[B + 'UpLeg'][0]) * s), 踝位 = 位(B + 'Foot');   // 人物胯宽和数据不同，脚跟着胯走
      肢['脚' + n] = { 踝: V(踝位.x + 窄 + 偏[0] + 脚偏[0], P['foot_' + n].y + (踝.y - d.rest[B + 'Foot'][1]) * s, 踝位.z + 脚偏[1]), 极: 膝.clone().sub(髋点.clone().add(踝).multiplyScalar(.5)).add(V(0, 0, .02)), 转: 差(B + 'Foot') };
      肢['手' + n] = { 上: 取(B + 'ForeArm').p.sub(取(B + 'Arm').p).normalize(), 前: 取(B + 'Hand').p.sub(取(B + 'ForeArm').p).normalize() }; }
    const 盆 = 位('Hips'), 抬 = c.抬头 || 0; return { 捕: { 盆: V(盆.x + 偏[0], 髋.y * s + 偏[1], 盆.z + 偏[2]), 肢, 躯: { pelvis: 差('Hips'), spine1: 差('Spine1'), spine2: 差('Spine2'), neck: E(-抬 * .4).multiply(差('Neck')), head: E(-抬).multiply(差('Head')) } }, 盆转: [盆转.x, 盆转.y, 盆转.z] }; };
  // 动作连起来：人.串([{ 名, 起, 时长, 速, 循环, 抬头, ... }, ...], { 过渡: .4 })。后一段的水平位置接上前一段，交接的 过渡 秒里两段混合；没写 时长 就放到这段动作结束。
  const 缓混 = k => k * k * (3 - 2 * k), 混 = (a, b, k) => { const c = { 盆: a.捕.盆.clone().lerp(b.捕.盆, k), 肢: {}, 躯: {} }; for (const n in a.捕.躯) c.躯[n] = a.捕.躯[n].clone().slerp(b.捕.躯[n], k);
    for (const s of ['L', 'R']) { const f = a.捕.肢['脚' + s], h = b.捕.肢['脚' + s], m = a.捕.肢['手' + s], o = b.捕.肢['手' + s]; c.肢['脚' + s] = { 踝: f.踝.clone().lerp(h.踝, k), 极: f.极.clone().lerp(h.极, k), 转: f.转.clone().slerp(h.转, k) }; c.肢['手' + s] = { 上: m.上.clone().lerp(o.上, k).normalize(), 前: m.前.clone().lerp(o.前, k).normalize() }; }
    return { 捕: c, 盆转: a.盆转.map((v, i) => v + (b.盆转[i] - v) * k) }; };
  const 平移 = (p, o) => { const c = p.捕; c.盆.x += o.x; c.盆.z += o.z; for (const s of ['L', 'R']) { c.肢['脚' + s].踝.x += o.x; c.肢['脚' + s].踝.z += o.z; } return p; };
  g.串 = (段们, 选 = {}) => { const 过 = 选.过渡 ?? .4; let 段表 = null;
    const 建 = () => { 段表 = []; let 头 = 0, 移 = V(); for (const a of 段们) { const d = 动作库[a.名], 速 = a.速 || 1, 长 = a.时长 ?? (d.帧数 / 30 - (a.起 || 0)) / 速, 动 = g.捕(a.名, a); if (段表.length) { const 前 = 段表[段表.length - 1], 中 = 头 + 过 / 2, 前位 = 平移(前.动(中 - 前.头), 前.移).捕.盆, 后位 = 动(过 / 2).捕.盆; 移 = V(前位.x - 后位.x, 0, 前位.z - 后位.z); } 段表.push({ 动, 头, 长, 移 }); 头 += 长 - 过; } };
    return t => { if (!段表) 建(); let i = 段表.length - 1; while (i > 0 && t < 段表[i].头) i--; const 这 = 段表[i], p = 平移(这.动(t - 这.头), 这.移); const 前 = 段表[i - 1]; if (!前 || t >= 这.头 + 过) return p; return 混(平移(前.动(t - 前.头), 前.移), p, 缓混((t - 这.头) / 过)); }; };
  const 解捕 = c => { const D = { ...c.躯 }, J = { pelvis: c.盆 }; 随(J, 'spine1', 'pelvis', D.pelvis); 随(J, 'spine2', 'spine1', D.spine1); 随(J, 'neck', 'spine2', D.spine2); 随(J, 'head', 'neck', D.neck);
    for (const s of ['L', 'R']) { 随(J, 'thigh_' + s, 'pelvis', D.pelvis); const 脚 = c.肢['脚' + s], [膝, 踝] = 反解(J['thigh_' + s], 脚.踝, 腿长, 脚.极); J['shin_' + s] = 膝; J['foot_' + s] = 踝;
      D['thigh_' + s] = 对向(方向('thigh_' + s, 'shin_' + s), 膝.clone().sub(J['thigh_' + s])); D['shin_' + s] = 对向(方向('shin_' + s, 'foot_' + s), 踝.clone().sub(膝)); D['foot_' + s] = 脚.转;
      随(J, 'upper_' + s, 'spine2', D.spine2); const 手 = c.肢['手' + s]; J['fore_' + s] = J['upper_' + s].clone().add(手.上.clone().multiplyScalar(臂长[0])); J['hand_' + s] = J['fore_' + s].clone().add(手.前.clone().multiplyScalar(臂长[1]));
      D['upper_' + s] = 对向(方向('upper_' + s, 'fore_' + s), 手.上); D['fore_' + s] = 对向(方向('fore_' + s, 'hand_' + s), 手.前); D['hand_' + s] = D['fore_' + s].clone(); }
    return { D, J, 腿角: 腿角(J) }; };
  // 手写姿势：D 每根骨相对静止姿势的转动（角色坐标系），J 关节位置；只计算不写回，附件用得上
  const 解 = p => { if (p.捕) return 解捕(p.捕); const D = {}, J = {};
    D.pelvis = E(p.盆转[0], p.盆转[1] || 0, p.盆转[2] || 0); J.pelvis = V(...p.盆);
    D.spine1 = D.pelvis.clone().multiply(E(p.腰[0], p.腰[1] || 0, p.腰[2] || 0)); D.spine2 = D.spine1.clone().multiply(E(p.胸[0], p.胸[1] || 0, p.胸[2] || 0));
    D.neck = D.spine2.clone().multiply(E(p.颈[0], p.颈[1] || 0)); D.head = D.neck.clone().multiply(E(p.头[0], p.头[1] || 0, p.头[2] || 0));
    随(J, 'spine1', 'pelvis', D.pelvis); 随(J, 'spine2', 'spine1', D.spine1); 随(J, 'neck', 'spine2', D.spine2); 随(J, 'head', 'neck', D.neck);
    for (const s of ['L', 'R']) { const 边 = s === 'L' ? 1 : -1;
      随(J, 'thigh_' + s, 'pelvis', D.pelvis); const 脚 = p['脚' + s], 踝目标 = V(脚.位[0], P['foot_' + s].y + (脚.抬 || 0), 脚.位[1]);
      const [膝, 踝] = 反解(J['thigh_' + s], 踝目标, 腿长, V(边 * .08, 0, 1)); J['shin_' + s] = 膝; J['foot_' + s] = 踝;
      D['thigh_' + s] = 对向(方向('thigh_' + s, 'shin_' + s), 膝.clone().sub(J['thigh_' + s])); D['shin_' + s] = 对向(方向('shin_' + s, 'foot_' + s), 踝.clone().sub(膝)); D['foot_' + s] = E(脚.俯 || 0, 脚.转 || 0);
      随(J, 'upper_' + s, 'spine2', D.spine2); const 手 = p['手' + s], 手目标 = V(...手.位);
      const [肘, 腕] = 反解(J['upper_' + s], 手目标, 臂长, V(边 * (手.肘外 ?? 1), 手.肘上 ?? 0, 手.肘后 ?? -1)); J['fore_' + s] = 肘; J['hand_' + s] = 腕;
      D['upper_' + s] = 对向(方向('upper_' + s, 'fore_' + s), 肘.clone().sub(J['upper_' + s])); D['fore_' + s] = 对向(方向('fore_' + s, 'hand_' + s), 腕.clone().sub(肘)); D['hand_' + s] = D['fore_' + s].clone().multiply(E(手.腕 || 0)); }
    return { D, J, 腿角: 腿角(J) }; };
  g.摆 = (动作, t) => { const p = 动作(t), 今 = 解(p), { D, J } = 今; if (选.附件) 选.附件({ p, D, J, 腿角: 今.腿角, 前: 解(动作(t - .1)), 再前: 解(动作(t - .2)), P, 方向, 对向, E, V });
    const 全 = {}; 骨.pelvis.position.copy(J.pelvis).applyMatrix4(根父逆);
    for (const n of 顺序) { const 父 = 骨父(n); if (!D[n]) D[n] = 父 ? D[父] : Q(); 全[n] = D[n].clone().multiply(R[n]); const 父转 = 父 ? 全[父] : 根父转; 骨[n].quaternion.copy(父转.clone().invert().multiply(全[n])); }
    g.关节 = J; };
  return g;
};

const S3 = window.S3 = { THREE, V3, 人物, scene, camera, renderer, composer, rig, 布景, 显示, 布景们: SETS, 环境, 机, 运镜, 相机动画, 播相机, 机切, 冲击, 投影, 泛光, 光, 浮尘, 雾团, 低雾, 石材, 倒角盒, 模型, 摆动, 平铺噪声, 镜面, 环境图, 材质, gltf, 文字, 遮蔽, 遮蔽默认, 色调, 回放, frame,
  get t() { return TNOW; }, ready: null };
window.THREE = THREE;
// 片子的 3D 布景模块（render.py 注入 S3_FILES）：按顺序加载，布景里的异步（模型、贴图）都等完
// 布景注册时立刻执行，模块按文件名加载，所以"不是函数""没定义"多半是用了后面模块才定义的东西，报错时直接说
const 顺序提示 = e => /is not a function|is not defined|of undefined/.test(String(e)) ? `\n（模块按文件名顺序加载：${(window.S3_FILES || []).map(u => decodeURI(u).split('/').pop()).join(' → ')}。布景注册时立刻执行，后面模块定义的东西这时还不能用：把它移到更靠前的文件）` : '';
S3.ready = (async () => { for (const u of window.S3_FILES || []) await import(u); await Promise.all(BUILDS); await Promise.all(window.__WAIT || []); return true; })().catch(e => { console.error('3D 布景出错：' + (e && e.stack || e) + 顺序提示(e)); return '3D 布景出错：' + e + 顺序提示(e); });
