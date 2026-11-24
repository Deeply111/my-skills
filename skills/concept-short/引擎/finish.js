// 成片质感：全片一套，所有镜头做完后统一过一道（业内的合成和调色那一步）。在 motion.js 之后加载。
// 写在 代码/质感.js：QUALITY({ 颗粒: 1.5, 暗角: .25, 光晕: .2, 纸纹: .15, 雾: { 色: '#e8e2d4', 浓: .15, 从: .45, 到: .8 }, 调色: { 冷暖: .1, 反差: 0, 饱和: -.1 } })
//   不写 质感.js 也会做防色带的抖动。顺序：镜头 → 质感 → 字幕 → 镜头标注，质感不盖到字上。
//   抖动：每个像素加一层固定的 ±1 色阶的细噪，把渐变压缩后的色带打散，默认开（抖动: false 关掉）。
//   颗粒：只加在平滑的渐变里，σ 约 1–2 个色阶，每帧变化；有纹理的地方不加。
//   暗角、光晕、纸纹、雾：0–1 的强度，按画风选，做到"去掉了才发现少了什么"。
//   调色：冷暖、反差、饱和 −1–1，微调整片；色彩剧本定的颜色不能被调歪（检查会量偏了多少）。
// 胶片（v4，出自《傲慢》，默认都是 0 不开；开了就在最前面用显卡过一遍，再做上面这些）：
//   溢色 亮处往外渗一圈暖色（胶片乳剂层的 halation，《傲慢》.75）；薄雾 亮处把周围大范围抬一点，空气感（.16）；
//   色散 越靠边红蓝错开越多（1 = 《傲慢》的量）；畸变 轻微桶形畸变（1）；片门 画面极轻的抖动（1）；分离色调 暗部偏青、亮部偏暖（1）；
//   抬黑 黑不死、蒙一层灰（.022）；高光肩 亮处柔和地收、不刺眼（1）；漏光 右侧渗进一道暖光（0–1，按镜头开）；闪白 整幅冲白（0–1）
//   查找表（v4）：一张 .cube 调色表，把成熟的胶片色彩一次套上（比手调分离色调稳）。QUALITY({ 查找表: '暖胶片', 查找表强度: .7 })；
//     表在 skill 的 素材/查找表/（脚本/查找表.py 生成，我们自己算的，没有授权问题），写带 / 的路径就从片子目录读；每镜可改 查找表强度，不能换表
//   按镜头微调：SHOT('A1', { 质感: { 溢色: .9 } }) 或 质感: lt => ({ 漏光: .5 * Math.sin(Math.PI * Math.min(1, lt / 1.6)) })，和全片的合并
(() => {
const { W, H } = STAGE;
let Q = { 抖动: true, 颗粒: 0 };
window.QUALITY = o => { Q = Object.assign({ 抖动: true, 颗粒: 0 }, o); if (Q.查找表) loadLut(Q.查找表); };
// .cube 读成 3D 贴图的数据；render.py 等 window.__WAIT 里的都好了才开始渲
let LUT = null;
const loadLut = name => { const url = name.includes('/') ? (window.FILM_URL || '/film/') + name : (window.SKILL_URL || '/skill/') + '素材/查找表/' + name + '.cube';
  (window.__WAIT = window.__WAIT || []).push(fetch(url).then(r => { if (!r.ok) throw new Error(`找不到查找表 ${url}`); return r.text(); }).then(t => {
    let N = 0; const v = [];
    for (const ln of t.split(/\r?\n/)) { const l = ln.trim(); if (!l || l[0] === '#') continue;
      if (l.startsWith('LUT_3D_SIZE')) N = +l.split(/\s+/)[1]; else if (/^[-\d.]/.test(l)) { const [r, g, b] = l.split(/\s+/).map(Number); v.push(r, g, b, 1); } }
    if (!N || v.length !== N * N * N * 4) throw new Error(`查找表 ${url} 格式不对（要 LUT_3D_SIZE 和 N³ 行）`);
    LUT = { N, data: new Float32Array(v), up: false }; })); };
const cv = (w = W, h = H) => Object.assign(document.createElement('canvas'), { width: w, height: h });
const scratch = cv(), small = cv(W / 4, H / 4);
let ditherPat = null, grainPat = null, paper = null;
const pattern = (seed, f) => { const r = U.rng(seed), a = new Int8Array(W * H); for (let i = 0; i < a.length; i++) a[i] = f(r); return a; };
// 固定的三角分布抖动（−1、0、+1 的概率 1:2:1）；颗粒用高斯近似，取样时按帧挪开位置
const tpdf = r => Math.round(r() + r() - 1);
const gauss = r => Math.round((r() + r() + r() + r() - 2) * 1.73 * 4);   // σ ≈ 4 个单位，用时再乘系数

// 量一帧的平均颜色（OKLab 的 L、b），检查质感有没有把色彩剧本调歪
const okLB = c => {
  const g = small.getContext('2d'); g.drawImage(c.canvas, 0, 0, W / 4, H / 4);
  const d = g.getImageData(0, 0, W / 4, H / 4).data; let L = 0, B = 0, n = 0;
  const lin = v => (v /= 255) <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4;
  for (let i = 0; i < d.length; i += 32) {
    const r = lin(d[i]), gg = lin(d[i + 1]), b = lin(d[i + 2]);
    const l = Math.cbrt(.4122214708 * r + .5363325363 * gg + .0514459929 * b), m = Math.cbrt(.2119034982 * r + .6806995451 * gg + .1073969566 * b), s = Math.cbrt(.0883024619 * r + .2817188376 * gg + .6299787005 * b);
    L += .2104542553 * l + .793617785 * m - .0040720468 * s; B += .0259040371 * l + .7827717662 * m - .808675766 * s; n++;
  }
  return [L / n, B / n];
};
// 色带：竖着看几列，找很长、很平滑、首尾却只差几个色阶的渐变（少于 30 个色阶就会出色带）
const banding = d => {
  let worst = null;
  for (let x = 27; x < W; x += 108) {
    let run = 0, lo = 255, hi = 0;
    for (let y = 0; y < H; y++) {
      const i = (y * W + x) * 4, v = .299 * d[i] + .587 * d[i + 1] + .114 * d[i + 2];
      const pv = y ? (() => { const j = ((y - 1) * W + x) * 4; return .299 * d[j] + .587 * d[j + 1] + .114 * d[j + 2]; })() : v;
      if (Math.abs(v - pv) <= 1.5) { run++; lo = Math.min(lo, v); hi = Math.max(hi, v); }
      else { run = 0; lo = 255; hi = 0; }
      if (run >= 300 && hi - lo >= 4 && hi - lo < 30 && (!worst || hi - lo < worst.级)) worst = { 级: Math.round(hi - lo), x, y };
    }
  }
  return worst;
};

// ---------- 胶片：WebGL 全屏着色器 ----------
const GK = ['溢色', '薄雾', '色散', '畸变', '片门', '分离色调', '抬黑', '高光肩', '漏光', '闪白', '查找表强度'];
let GL = null;
const glInit = () => {
  const glc = cv(), gl = glc.getContext('webgl2', { preserveDrawingBuffer: true, premultipliedAlpha: false }); if (!gl) throw new Error('成片质感的胶片效果要 WebGL2');
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
  const pr = gl.createProgram();
  gl.attachShader(pr, sh(gl.VERTEX_SHADER, `#version 300 es
in vec2 p; out vec2 vUv; void main(){ vUv = p * .5 + .5; gl_Position = vec4(p, 0., 1.); }`));
  gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, `#version 300 es
precision highp float; precision mediump sampler3D; uniform sampler2D tSrc, tB1, tB2; uniform sampler3D tLut; uniform float lutK, lutN; uniform float time, halo, veil, ca, dist, gate, split, lift, shoulder, leak, flash; uniform vec2 res; in vec2 vUv; out vec4 o;
void main(){
  vec2 d = vUv - .5; d.x *= res.x / res.y; float r2 = dot(d, d);
  vec2 uv = .5 + (vUv - .5) * (1. - .014 * dist + .03 * dist * r2);                                   // 桶形畸变（先放大一点，四边不露底）
  uv += vec2(sin(time * 2.3) + .5 * sin(time * 5.9 + 1.), cos(time * 1.9) + .5 * sin(time * 6.7)) * .00022 * gate;   // 片门抖动
  vec2 cc = (uv - .5) * .0022 * ca * (.4 + r2 * 2.);                                                // 色散：越靠边越明显
  vec3 c = vec3(texture(tSrc, uv + cc).r, texture(tSrc, uv).g, texture(tSrc, uv - cc).b);
  vec3 b1 = texture(tB1, uv).rgb, b2 = texture(tB2, uv).rgb;
  c += max(b1 - .5, 0.) * vec3(1., .48, .24) * halo;                                                 // 溢色
  c += b2 * vec3(.95, .97, 1.) * veil;                                                               // 薄雾
  float L = dot(c, vec3(.299, .587, .114));
  c += split * mix(vec3(-.006, .004, .016), vec3(.022, .008, -.014), smoothstep(.08, .6, L));        // 分离色调
  c = lift * vec3(.92, .96, 1.) + c * (1. - lift);                                                   // 抬黑
  c = c / (1. + max(c - .85, 0.) * 1.2 * shoulder);                                                  // 高光肩
  c += leak * vec3(1., .5, .22) * smoothstep(.95, 0., distance(vUv, vec2(1.05, .25 - .06 * sin(time * 1.3)))) * .55;   // 漏光（右侧）
  if (lutK > 0.) { vec3 lc = clamp(c, 0., 1.) * (lutN - 1.) / lutN + .5 / lutN; c = mix(c, texture(tLut, lc).rgb, lutK); }   // 查找表（.cube 的 R 变化最快，对应贴图的 x）
  c = mix(c, vec3(1., .94, .86), flash);
  o = vec4(c, 1.); }`));
  gl.bindAttribLocation(pr, 0, 'p'); gl.linkProgram(pr); gl.useProgram(pr);
  const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const tex = i => { const t = gl.createTexture(); gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, t);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v); return t; };
  const T = [tex(0), tex(1), tex(2)]; ['tSrc', 'tB1', 'tB2'].forEach((n, i) => gl.uniform1i(gl.getUniformLocation(pr, n), i));
  const lutT = gl.createTexture(); gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_3D, lutT);
  for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_3D, k, v);
  gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA16F, 1, 1, 1, 0, gl.RGBA, gl.FLOAT, new Float32Array([0, 0, 0, 1])); gl.uniform1i(gl.getUniformLocation(pr, 'tLut'), 3);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true); gl.viewport(0, 0, W, H);
  const U_ = n => gl.getUniformLocation(pr, n);
  return { glc, gl, T, lutT, U: U_, b1: cv(Math.round(W / 6), Math.round(H / 6)), b2: cv(Math.round(W / 12), Math.round(H / 12)) };
};
const filmGrade = (c, P, time) => {
  GL = GL || glInit(); const { gl, T, b1, b2 } = GL;
  const g1 = b1.getContext('2d'), g2 = b2.getContext('2d');
  // 每次先清空：模糊会让边缘变透明，不清的话上一帧的残影从边上透出来、一次次累积（画面就不是纯函数了）
  g1.clearRect(0, 0, b1.width, b1.height); g1.filter = `blur(${(W / 768).toFixed(2)}px)`; g1.drawImage(c.canvas, 0, 0, b1.width, b1.height); g1.filter = 'none';
  g2.clearRect(0, 0, b2.width, b2.height); g2.filter = `blur(${(W / 320).toFixed(2)}px)`; g2.drawImage(b1, 0, 0, b2.width, b2.height); g2.filter = 'none';
  [c.canvas, b1, b2].forEach((src, i) => { gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, T[i]); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src); });
  const u = (n, v) => gl.uniform1f(GL.U(n), v || 0);
  u('time', time); gl.uniform2f(GL.U('res'), W, H);
  if (LUT && !LUT.up) { gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_3D, GL.lutT); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA16F, LUT.N, LUT.N, LUT.N, 0, gl.RGBA, gl.FLOAT, LUT.data); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true); LUT.up = true; }
  u('lutK', LUT ? P.查找表强度 ?? 1 : 0); u('lutN', LUT ? LUT.N : 1);
  u('halo', P.溢色); u('veil', P.薄雾); u('ca', P.色散); u('dist', P.畸变); u('gate', P.片门); u('split', P.分离色调); u('lift', P.抬黑); u('shoulder', P.高光肩); u('leak', P.漏光); u('flash', P.闪白);
  gl.drawArrays(gl.TRIANGLES, 0, 3); c.drawImage(GL.glc, 0, 0);
};

window.drawFinish = (c, frame) => {
  const rec = window.__MEASURE ? { 前: okLB(c) } : null;
  const sq = (window.SHOTS && window.__SHOT && SHOTS[window.__SHOT] || {}).质感, Q0 = Q;
  Q = Object.assign({}, Q0, typeof sq === 'function' ? sq(window.__LT || 0) : sq || {});   // 这一镜的质感和全片的合并
  try {
  c.save(); c.setTransform(1, 0, 0, 1, 0, 0);
  if (GK.some(k => Q[k]) || Q.查找表) filmGrade(c, Q, frame / 30);
  if (Q.雾) {
    const { 色 = '#e8e2d4', 浓 = .15, 从 = .4, 到 = .8 } = Q.雾, gr = c.createLinearGradient(0, H * 从, 0, H * 到), [r, g, b] = U.rgb(色);
    const col = a => `rgba(${r},${g},${b},${a})`;
    gr.addColorStop(0, col(0)); gr.addColorStop(.5, col(浓)); gr.addColorStop(1, col(0)); c.fillStyle = gr; c.fillRect(0, 0, W, H);
  }
  if (Q.光晕) {   // 只让亮处发光：压暗、拉高反差、模糊，再用"滤色"叠回去
    const g = small.getContext('2d'); g.clearRect(0, 0, W / 4, H / 4); g.filter = 'brightness(.7) contrast(2.2) blur(6px)';   // 先清空（v3 漏了：模糊的透明边会透出上一帧） g.drawImage(c.canvas, 0, 0, W / 4, H / 4); g.filter = 'none';
    c.globalCompositeOperation = 'screen'; c.globalAlpha = Q.光晕; c.drawImage(small, 0, 0, W, H); c.globalCompositeOperation = 'source-over'; c.globalAlpha = 1;
  }
  if (Q.暗角) { const gr = c.createRadialGradient(W / 2, H / 2, H * .3, W / 2, H / 2, H * .72); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, `rgba(0,0,0,${Q.暗角})`); c.fillStyle = gr; c.fillRect(0, 0, W, H); }
  if (Q.纸纹) {   // 纸不动：纹理生成一次，正片叠底
    if (!paper) { paper = cv(W / 2, H / 2); const g = paper.getContext('2d'), im = g.createImageData(W / 2, H / 2), r = U.rng(7);
      for (let y = 0; y < H / 2; y++) for (let x = 0; x < W / 2; x++) { const v = 235 + PAINT.noise(x / 40, y / 40) * 14 + PAINT.noise(x / 6, y / 6) * 6 + (r() - .5) * 10, i = (y * W / 2 + x) * 4; im.data[i] = im.data[i + 1] = v; im.data[i + 2] = v - 6; im.data[i + 3] = 255; }
      g.putImageData(im, 0, 0); }
    c.globalCompositeOperation = 'multiply'; c.globalAlpha = Q.纸纹; c.drawImage(paper, 0, 0, W, H); c.globalCompositeOperation = 'source-over'; c.globalAlpha = 1;
  }
  // 调色、颗粒、抖动合成一遍逐像素处理（整幅的滤镜和叠加在无界面的浏览器里很慢）
  if (Q.抖动 !== false || Q.颗粒 || Q.调色 || rec) {
    const im = c.getImageData(0, 0, W, H), d = im.data, N = W * H;
    if (rec && Q.抖动 === false) rec.色带 = banding(d);
    if (!ditherPat) ditherPat = pattern(11, tpdf);
    if (Q.颗粒 && !grainPat) grainPat = pattern(23, gauss);
    const { 冷暖 = 0, 反差 = 0, 饱和 = 0 } = Q.调色 || {}, ct = 1 + 反差 * .3, sat = 1 + 饱和 * .5, wr = 冷暖 * 12, grade = !!Q.调色;
    // 颗粒只加在平滑的地方：在缩小图上按 4×4 的块判断，块里和右、下邻居差得很少就算平滑
    let smooth = null;
    if (Q.颗粒) {
      const g = small.getContext('2d'); g.drawImage(c.canvas, 0, 0, W / 4, H / 4); const sd = g.getImageData(0, 0, W / 4, H / 4).data, sw = W / 4;
      smooth = new Uint8Array(sw * H / 4);
      for (let y = 0; y < H / 4 - 1; y++) for (let x = 0; x < sw - 1; x++) { const i = (y * sw + x) * 4, j = i + 4, l = i + sw * 4;
        smooth[y * sw + x] = Math.abs(sd[i] - sd[j]) + Math.abs(sd[i + 1] - sd[l + 1]) + Math.abs(sd[i + 2] - sd[l + 2]) < 4 ? 1 : 0; }
    }
    const k = (Q.颗粒 || 0) / 4, off = Q.颗粒 ? Math.floor(U.hash(frame, 3) * N) : 0, dith = Q.抖动 !== false, sw = W / 4;
    for (let p = 0, i = 0; p < N; p++, i += 4) {
      let r = d[i], g = d[i + 1], b = d[i + 2];
      if (grade) { const y = .299 * r + .587 * g + .114 * b; r = (y + (r - y) * sat - 128) * ct + 128 + wr; g = (y + (g - y) * sat - 128) * ct + 128 + wr * .3; b = (y + (b - y) * sat - 128) * ct + 128 - wr; }
      let n = dith ? ditherPat[p] : 0;
      if (smooth && smooth[((p / W | 0) >> 2) * sw + ((p % W) >> 2)]) n += grainPat[(p + off) % N] * k;
      d[i] = r + n; d[i + 1] = g + n; d[i + 2] = b + n;
    }
    c.putImageData(im, 0, 0);
  }
  c.restore();
  } finally { Q = Q0; }
  if (rec) { const a = okLB(c); rec.dL = a[0] - rec.前[0]; rec.db = a[1] - rec.前[1]; delete rec.前; window.__FINISHREC = rec; }
};
})();
