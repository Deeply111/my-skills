// 舞台：横屏 1920×1080 为主、竖屏 1080×1920 为辅（片子.json 的 "画幅"）。镜头登记、按时间找镜头、每个镜头自动用最新的一版。
// 镜头文件里写：SHOT('A1', { board: (c, lt, x) => {...}, final: ... })   两版：分镜版（含粗动作，按每秒 12 张一顿一顿地放）、精修版
//   c 画布，lt 镜头内的时间（秒），x = { W, H, d 镜头时长, p 镜头内进度 0–1 }
//   同一个对象里还可以写 字幕: {...}，这一镜字幕放在哪（见 subs.js）；机: CAM(...)，这一镜的摄像机（见 camera.js）；
//   声: [...]，这一镜的音效（见 render.py 和 脚本/音效.py）。动作预设见 motion.js，成片质感见 finish.js
//   regions: (lt, x) => ({ 主体: [左, 上, 右, 下] })，这一镜画面主体在屏幕上的位置，字幕自动躲开、压到了检查提醒（见 subs.js "自动找空处"）
//   画风: '水墨'，这一镜用哪种画风的运动规范（见 motion.js）；片子里只有一种画风写了运动规范时可以不写，几种都写了就必须写
// 画风文件把画笔挂在 STYLES.<画风名> 上，镜头里用 STYLES.<画风名>.xxx 调用。
(() => {
U.setStage(STAGE.W, STAGE.H);
const { W, H } = STAGE;
const SHOTS = window.SHOTS = {};
const ORDER = ['final', 'board'];   // 精修版 > 分镜版（粗动作已并进分镜版）
window.STYLES = window.STYLES || {};
window.TIMELINE = window.TIMELINE || [];      // [{ id, from, to, 卡 }]，render.py 从 代码/时间轴.json 注入；卡 = 这个镜头属于哪张画面卡，字幕按它排

window.SHOT = (id, versions) => {
  if (SHOTS[id]) throw new Error(`镜头 ${id} 登记了两次`);
  if (versions.block) throw new Error(`镜头 ${id} 写了 block：粗动作已并进分镜版，写在 board 里（SKILL.md "每个镜头两版"）`);
  SHOTS[id] = versions;
  if (versions.转场) 转场载(versions.转场);
};

const pick = (id, want) => {
  const v = SHOTS[id];
  if (!v) throw new Error(`没有镜头 ${id}`);
  const k = want || ORDER.find(k => v[k]) || (v.三维 ? 'final' : undefined);
  if (!v[k] && v.三维) return [k, () => {}];   // 只有 3D、没有 2D 叠加的镜头
  if (!v[k]) throw new Error(`镜头 ${id} 没有 ${want || '任何'} 版`);
  return [k, v[k]];
};

// ---------- 转场：镜头写 转场: { 名, 时长, 参数 }，或 SHOT.转场(镜头, { ... })；效果来自 gl-transitions（引擎/第三方/gl-transitions/，目录.md 列了 191 种）。以这一镜结尾的切点为中心，前后各占一半。
// 前后两镜都渲，用着色器混合，再加质感和字幕，所以字不跟着变。前一镜放完停在最后一帧，后一镜开始前停在第一帧。只是可选工具，手法和选择见 参考/镜头.md。
const 转场别名 = { 溶解: 'Fade', 胶片溶解: 'FilmDissolve', 压暗: 'FadeColor', 褪色: 'FadeGrayscale', 叠暗: 'MultiplyBlend', 梦境: 'Dreamy', 互融: 'Morph', 过曝: 'Overexposure', 光晕: 'BloomDissolve', 光线: 'LightRays', 光条: 'LightStreaks', 扫光: 'LightWipe', 镜头光: 'LensFlare', 闪色: 'FlashFade', 闪入: 'DreamyZoom', 热边: 'GlowDissolve', 描边暗场: 'EdgeGlow', 烧片: 'FilmBurn', 显影: 'PhotoDevelop', 定格: 'Snapshot', 虚焦: 'DefocusBlur', 光斑: 'BokehDissolve', 糊化: 'LinearBlur', 甩: 'WhipPan', 竖甩: 'WhipTilt', 转甩: 'WhipSpin', 冲焦: 'CrossZoom', 震: 'CameraShake', 推入: 'SimpleZoom', 拉出: 'SimpleZoomOut', 穿越: 'Tunnel', 鱼眼: 'Fisheye', 眨眼: 'EyeBlink', 光圈: 'ApertureWipe', 液态玻璃: 'Refraction', 热浪: 'HeatHaze', 烟: 'SmokeDissolve', 灰飞: 'Disintegrate', 墨: 'InkBleed', 笔刷: 'BrushWipe', 泼墨: 'SplatterWipe', 水涨: 'LiquidFill', 水滴: 'WaterDrop', 涟漪: 'Ripple', 黏液: 'GooeyWipe', 火墙: 'FlameWipe', 烧穿: 'BurnThrough', 融化: 'DoomMelt', 碎裂: 'Shatter', 撕纸: 'PaperTear', 揉纸: 'Crumple', 碎纸: 'Shred', 翻页: 'BookFlip', 卷页: 'InvertedPageCurl', 幕布: 'Curtains', 开门: 'Doorway', 拼图: 'Puzzle', 风吹: 'Wind', 龙卷: 'Vortex', 蜂巢: 'Honeycomb', 揉球: 'Sphere', 圆开: 'CircleOpen', 圆收: 'CircleIris', 方收: 'RectangleIris', 擦: 'DirectionalWipe', 推: 'Directional', 漩涡: 'Swirl', 故障: 'GlitchMemories', 雪花: 'TvStatic', 失信号: 'TvLostSignal', 关电视: 'TvTurnOff', 录像带: 'VhsTracking', 全息: 'Hologram', 像素: 'Pixelize', 字符: 'Ascii', 网点: 'Halftone' }, 转场源 = {}, 转场程序 = {};
const 转场载 = 选 => { const n = 转场别名[选.名] || 选.名; if (转场源[n]) return; 转场源[n] = fetch('/skill/引擎/第三方/gl-transitions/' + n + '.glsl').then(r => { if (!r.ok) throw new Error(`没有转场 ${选.名}：别名和文件名见 引擎/第三方/gl-transitions/目录.md`); return r.text(); }).then(t => { 转场源[n] = t; }); (window.__WAIT = window.__WAIT || []).push(转场源[n]); };
SHOT.转场 = (id, 选) => { SHOTS[id].转场 = 选; 转场载(选); };
let 转场gl = null, 转场画布 = null;
const 转场混合 = (A, B, 选, k) => { const W0 = A.canvas.width, H0 = A.canvas.height;
  if (!转场gl) { const cv = document.createElement('canvas'); cv.width = W0; cv.height = H0; const gl = 转场gl = cv.getContext('webgl', { preserveDrawingBuffer: true, premultipliedAlpha: false }); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true); gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE); const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW); gl.纹 = [0, 1].map(i => { const t = gl.createTexture(); gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, t); for (const [a, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, a, v); return t; }); }
  const gl = 转场gl, n = 转场别名[选.名] || 选.名, 键 = n + JSON.stringify(选.参数 || {});
  if (!转场程序[键]) { if (typeof 转场源[n] !== 'string') throw new Error(`转场 ${选.名} 还没读进来`);
    for (const a in 选.参数 || {}) if (!new RegExp('uniform\\s+\\w+\\s+' + a + '\\b').test(转场源[n])) throw new Error(`转场 ${选.名} 没有参数 ${a}，可调项写在 ${n}.glsl 开头`);
    const 源 = 转场源[n].replace(/uniform\s+(\w+)\s+(\w+)\s*(?:;\s*\/\/\s*=\s*([^;\n]+)[^\n]*|\/\*\s*=\s*([^*]+?)\s*\*\/\s*;)/g, (m, t, a, v, w) => { const 值 = String((选.参数 && a in 选.参数) ? 选.参数[a] : (v || w).trim()); return `const ${t} ${a} = ${t === 'float' && /^[-+]?\d+$/.test(值) ? 值 + '.' : 值};`; });
    const 编 = (ty, txt) => { const h = gl.createShader(ty); gl.shaderSource(h, txt); gl.compileShader(h); if (!gl.getShaderParameter(h, gl.COMPILE_STATUS)) throw new Error('转场着色器 ' + n + '：' + gl.getShaderInfoLog(h)); return h; };
    const P = gl.createProgram(); gl.attachShader(P, 编(gl.VERTEX_SHADER, 'attribute vec2 p; varying vec2 v_uv; void main(){ v_uv = p * .5 + .5; gl_Position = vec4(p, 0., 1.); }'));
    gl.attachShader(P, 编(gl.FRAGMENT_SHADER, 'precision highp float; varying vec2 v_uv; uniform sampler2D 甲from, 甲to; uniform float progress, ratio; vec4 getFromColor(vec2 uv){ return texture2D(甲from, uv); } vec4 getToColor(vec2 uv){ return texture2D(甲to, uv); }\n'.replace(/甲/g, 'u_') + 源 + '\nvoid main(){ gl_FragColor = vec4(transition(v_uv).rgb, 1.); }')); gl.linkProgram(P); 转场程序[键] = P; }
  const P = 转场程序[键]; gl.useProgram(P); gl.viewport(0, 0, W0, H0); const loc = gl.getAttribLocation(P, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  [[A.canvas, 'u_from'], [B.canvas, 'u_to']].forEach(([cv, u], i) => { gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, gl.纹[i]); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv); gl.uniform1i(gl.getUniformLocation(P, u), i); });
  gl.uniform1f(gl.getUniformLocation(P, 'progress'), k); gl.uniform1f(gl.getUniformLocation(P, 'ratio'), W0 / H0); gl.drawArrays(gl.TRIANGLES, 0, 3); return gl.canvas; };
// 这一帧在不在转场里：在就把另一镜也画出来，混合后写回 c。在 drawShot 里、质感和字幕之前调
const 转场这帧 = (c, id, lt, s, want) => { if (!s || window.__PROBE) return; const i = TIMELINE.indexOf(s), 后 = TIMELINE[i + 1], 前 = TIMELINE[i - 1], d = s.to - s.from; let 选, 另, 另lt, k, 我是前;
  const 这选 = SHOTS[id].转场, 前选 = 前 && SHOTS[前.id] && SHOTS[前.id].转场;
  if (这选 && 后 && lt >= d - 这选.时长 / 2) { 选 = 这选; 另 = 后; 另lt = 0; k = (lt - (d - 选.时长 / 2)) / 选.时长; 我是前 = true; }
  else if (前选 && lt < 前选.时长 / 2) { 选 = 前选; 另 = 前; 另lt = (前.to - 前.from) - 1 / 30; k = (lt + 选.时长 / 2) / 选.时长; 我是前 = false; }
  else return;
  if (!转场画布) { 转场画布 = document.createElement('canvas'); 转场画布.width = c.canvas.width; 转场画布.height = c.canvas.height; }
  const g = 转场画布.getContext('2d'), 存 = ['__TEXTS', '__CAMREC', '__SHOT', '__MOTION', '__MOVES', '__SEG', '__LT', '__NANREC', '__FINISHREC'].map(a => [a, window[a]]);
  const [, f2] = pick(另.id, want), d2 = 另.to - 另.from, x2 = { W, H, d: d2, p: Math.min(1, Math.max(0, 另lt / d2)), lt: 另lt, ct: 另lt, 机: SHOTS[另.id].机 };
  window.__TEXTS = []; window.__CAMREC = null; window.__SHOT = 另.id; window.__MOTION = []; window.__MOVES = []; window.__NANREC = null; window.__SEG = x2.机 && x2.机.段 ? x2.机.段(x2.ct) : 0; window.__LT = 另lt;
  g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, W, H); if (SHOTS[另.id].三维) S3.frame(g, 另.id, 另lt, x2); g.save(); f2(g, 另lt, x2); g.restore();
  for (const [a, v] of 存) window[a] = v;
  const 出 = 转场混合(我是前 ? c : g, 我是前 ? g : c, 选, Math.min(1, Math.max(0, k))); c.setTransform(1, 0, 0, 1, 0, 0); c.drawImage(出, 0, 0); };

const BOARD = {};   // 分镜版上一张画好的画（drawShot 里复用）
// 画一个镜头的某一刻；want 不写就用最新的一版。返回用的是哪一版。
window.drawShot = (c, id, lt, want, d) => {
  const [k, f] = pick(id, want);
  window.__SHOT = id;   // 先记下是哪一镜：动作库按这一镜的画风取运动规范（motion.js）
  const n = k === 'board' ? 12 : window.MOTION_SPEC ? MOTION_SPEC().每秒张数 : 30;   // 分镜版每秒 12 张；精修版按画风的每秒张数取时间
  const lt0 = lt;   // 字幕、标注按真实时间走，不跟着顿
  if (n < 30) lt = Math.floor(lt * n + 1e-6) / n;
  // 这一帧是不是换了一张画：一顿一顿的画风停住的那几帧不算（字幕、标注、摄像机照样在动），render.py 的检查只拿换了画的帧比前后
  const step = id + '#' + (n < 30 ? Math.floor(lt0 * n + 1e-6) : Math.round(lt0 * 30));
  if (!window.__PROBE) { window.__FRESH = step !== window.__lastStep; window.__lastStep = step; }
  const s = TIMELINE.find(q => q.id === id);
  if (d === undefined) d = s ? s.to - s.from : 0;   // 抽静帧时从时间轴查镜头时长
  // 机 = 这一镜的摄像机（camera.js）；ct = 摄像机用的时间：分镜版的画一顿一顿，摄像机照样每秒 30 帧平滑地动
  const x = { W, H, d, p: d ? Math.min(1, Math.max(0, lt / d)) : 0, lt, ct: k === 'board' ? lt0 : lt, 机: SHOTS[id].机 };
  window.__TEXTS = []; window.__CAMREC = null; window.__SHOT = id; window.__MOTION = []; window.__MOVES = []; window.__FINISHREC = null; window.__NANREC = null;
  window.__SEG = x.机 && x.机.段 ? x.机.段(x.ct) : 0; window.__LT = lt;   // __LT：质感写成函数时按镜头内时间算（finish.js）   // 镜内硬切的第几段（CAM.切；3D 镜头由 S3.机切 设）
  c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, W, H);
  // 分镜版同一顿、摄像机没在动：直接贴上一次画好的那张（连同登记的字、摄像机记录），只重画字幕和标注。
  // 不然 --label 的时间码每帧都变，整片每帧都得从头画一遍
  const still = k === 'board' && !window.__PROBE && !(x.机 && x.机.动 && x.机.动(lt0, d)) ? step : null;
  if (still && still === BOARD.key) { c.drawImage(BOARD.cv, 0, 0); Object.assign(window, BOARD.rec); }
  else {
    if (SHOTS[id].三维) { if (!window.S3) throw new Error(`镜头 ${id} 写了 三维，但 3D 层没加载`); S3.frame(c, id, lt, x); }   // 先渲 3D（引擎/3d.js），2D 叠在上面
    c.save(); f(c, lt, x); c.restore();
    BOARD.key = still;
    if (still) { BOARD.cv = BOARD.cv || Object.assign(document.createElement('canvas'), { width: W, height: H });
      const g = BOARD.cv.getContext('2d'); g.clearRect(0, 0, W, H); g.drawImage(c.canvas, 0, 0);
      BOARD.rec = { __TEXTS: __TEXTS, __CAMREC: __CAMREC, __MOTION: __MOTION, __MOVES: __MOVES, __NANREC: __NANREC }; }
  }
  if (window.__diff && !window.__PROBE) window.__DIFFV = window.__FRESH ? __diff(c) : null;   // render.py 用：和上一帧差多少，在加质感之前量（颗粒每帧都变）。试画（字幕自动选位量底色）不算帧
  if (k !== 'board') 转场这帧(c, id, lt, s, want);
  if (window.drawFinish && k !== 'board') drawFinish(c, Math.round(((s ? s.from : 0) + lt) * 30));   // 成片质感在字幕之下（finish.js）；分镜版不加，业内动态分镜也不做质感
  if (s && window.drawSubs && !window.__PROBE) drawSubs(c, s.from + lt0, id, lt0, x, want);   // 字幕层在镜头之上，不受摄像机影响（subs.js）；want 给自动选位试画同一版用
  if (window.LABEL && !window.__PROBE) drawLabel(c, id, s, lt0, k);
  if (window.SAFE && !window.__PROBE) drawSafe(c);
  return k;
};

// 镜头标注（render.py --label 打开，成片不带）：顶部安全区压一行小字，看片时说得准是哪一镜。
//   简版（给用户看）：镜号、时间码（分:秒.帧）、哪一版；详版（自查用）再加卡号、画面卡的"镜头"和"观众明白"。
//   画面卡的内容由 render.py 注入 window.CARDS = { 卡号: { 镜头, 明白 } }。
const VER = { board: '分镜版', final: '精修版' };
const tc = t => { const f = Math.round(t * 30), m = Math.floor(f / 1800), sec = Math.floor(f / 30) % 60; return `${m}:${String(sec).padStart(2, '0')}.${String(f % 30).padStart(2, '0')}`; };
const drawLabel = (c, id, s, lt, k) => {
  const card = s && s.卡 !== undefined ? String(s.卡) : null, info = (window.CARDS || {})[card] || {};
  const lines = [[id, card && LABEL === '详' ? `卡 ${card}` : null, tc((s ? s.from : 0) + lt), VER[k]].filter(Boolean).join('　')];
  if (LABEL === '详') lines.push([info.镜头, info.明白 && `观众明白：${info.明白}`].filter(Boolean).join('｜') || '画面卡里没写镜头和观众明白');
  c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.font = '600 28px Song'; c.textBaseline = 'middle';
  const fit = t => { if (c.measureText(t).width <= W - 80) return t; while (t.length && c.measureText(t + '…').width > W - 80) t = t.slice(0, -1); return t + '…'; };
  c.fillStyle = 'rgba(0, 0, 0, 0.35)'; c.fillRect(0, 0, W, 24 + lines.length * 42);
  c.fillStyle = 'rgba(255, 255, 255, 0.8)';
  lines.forEach((t, i) => c.fillText(fit(t), 40, 33 + i * 42));
  c.restore();
};

// 安全区参考线（render.py --safe 打开，只给自己构图用，交给用户的图不带）：按画幅（脚本/画幅.py 的 LAYOUT.安全），见 参考/字幕.md
const drawSafe = c => {
  const S = window.LAYOUT.安全, up = S.上, dn = S.下, sd = S.左右, B = S.按钮列;
  c.save(); c.setTransform(1, 0, 0, 1, 0, 0);
  c.fillStyle = 'rgba(230, 40, 60, 0.28)';
  c.fillRect(0, 0, W, H * up); c.fillRect(0, H * dn, W, H * (1 - dn)); if (B) c.fillRect(W * B[0], H * B[1], W * (1 - B[0]), H * (B[2] - B[1]));
  c.fillStyle = 'rgba(230, 40, 60, 0.12)'; c.fillRect(0, H * up, W * sd, H * (dn - up)); c.fillRect(W * (1 - sd), H * up, W * sd, H * (dn - up));
  c.fillStyle = 'rgba(160, 20, 40, 0.9)'; c.font = `600 ${Math.round(H / 64)}px Song`; c.textAlign = 'center';
  c.fillText(`顶部 ${Math.round(up * 100)}%：会被界面盖住`, W / 2, H * up - H / 80); c.fillText(`底部 ${Math.round((1 - dn) * 100)}%：会被进度条、标题、文案盖住`, W / 2, H * dn + H / 38);
  c.restore();
};

// 色板：全片的颜色只写在 代码/色板.js —— window.PALETTE = { 场名: {...} }，window.MEANING = { 名: [色, 意思] }（颜色含义表）。
// 色彩剧本和镜头都用 PAL('场名') 取色，不在别处另写颜色。色板里的键（天、远、光……）由画风定。
window.PAL = name => {
  const p = (window.PALETTE || {})[name];
  if (!p) throw new Error(`色板里没有「${name}」：代码/色板.js`);
  return p;
};

// 色彩剧本：代码/色彩剧本.js 里写 COLORSCRIPT([{ 场, 名, t: [起, 止], 卡: [起, 止], 情绪, draw: (c, P, x) => {...} }])
//   场 = 色板里的场名（P = PAL(场)）；名 不写就用场名，同一场加的格子（最重的一刻、第二个高点）靠它区分；
//   卡 = 对应的画面卡编号，脚本/色彩剧本.py 按它读情绪强度；x = { W, H }。
window.COLORSCRIPT_CELLS = [];
window.COLORSCRIPT = cells => { COLORSCRIPT_CELLS.push(...cells); };
window.drawCell = (c, i) => {
  const s = COLORSCRIPT_CELLS[i];
  c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, W, H);
  c.save(); s.draw(c, PAL(s.场), { W, H }); c.restore();
  return { 名: s.名 || s.场, 场: s.场, t: s.t, 卡: s.卡 || null, 情绪: s.情绪 || '' };
};

// 数值算坏：坐标变成 NaN 或无穷大时，画布不报错、那一笔直接不画。量的那些帧（render.py 每半秒一帧）拦下来记一笔，检查算硬伤
const NUM_ARGS = ['moveTo', 'lineTo', 'bezierCurveTo', 'quadraticCurveTo', 'arc', 'arcTo', 'ellipse', 'rect', 'fillRect', 'strokeRect',
                  'translate', 'scale', 'rotate', 'transform', 'setTransform', 'drawImage', 'fillText', 'strokeText'];
for (const P of [CanvasRenderingContext2D.prototype, Path2D.prototype]) for (const name of NUM_ARGS) {
  const f = P[name]; if (!f) continue;
  P[name] = function (...a) {
    if (window.__MEASURE && !window.__NANREC && a.some(v => typeof v === 'number' && !Number.isFinite(v))) window.__NANREC = `${name}(${a.map(v => typeof v === 'number' ? +v.toFixed(1) : typeof v).join(', ')})`;
    return f.apply(this, a);
  };
}

// 按全片时间画：找到这一刻的镜头，换算成镜头内时间。
window.drawAt = (c, t, want) => {
  const s = TIMELINE.find(q => t >= q.from && t < q.to) || TIMELINE[TIMELINE.length - 1];
  if (!s) throw new Error('时间轴是空的：代码/时间轴.json');
  return drawShot(c, s.id, t - s.from, want, s.to - s.from);
};
})();
