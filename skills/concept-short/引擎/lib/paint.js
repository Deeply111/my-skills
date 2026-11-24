// 纯代码绘画的底层：画布与缓存、噪声、颜色、纸和墙的纹理、颗粒、手绘线、热气、粒子。不带任何画风。
// 绘画类的笔（毛笔、水彩、厚涂……）和风格重画在 引擎/笔刷库/，片子.json 写明才加载。
// 约定：所有随机都用种子；「抖动线条」按 boilFps 换种子（手绘动画的 boiling line），其余保持帧间稳定。
(() => {
let W = STAGE.W, H = STAGE.H; U.onStage((w, h) => { W = w; H = h; });   // 画布尺寸跟 U.setStage 走（横屏或竖屏，见 脚本/画幅.py）
const P = window.PAINT = {};
const { clamp, lerp, ease, rng } = U;

// ---------- 画布 ----------
P.canvas = (w = W, h = H) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const CACHE = {};
P.cached = (key, w, h, fn) => { if (!CACHE[key]) { const c = P.canvas(w, h); fn(c.getContext('2d'), c); CACHE[key] = c; } return CACHE[key]; };
P.scratch = (key) => { if (!CACHE['s_' + key]) CACHE['s_' + key] = P.canvas(); return CACHE['s_' + key]; };

// ---------- 噪声 ----------
const perm = new Uint8Array(512); { const r = rng(1337); const p = [...Array(256).keys()]; for (let i = 255; i > 0; i--) { const j = (r() * (i + 1)) | 0; [p[i], p[j]] = [p[j], p[i]]; } for (let i = 0; i < 512; i++) perm[i] = p[i & 255]; }
const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
const grad = (h, x, y) => { const u = (h & 1) ? x : -x, v = (h & 2) ? y : -y; return (h & 4) ? u + v * 0.5 : u * 0.5 + v; };
P.noise = (x, y) => {                                   // Perlin 2D，约 [-1,1]
  const X = Math.floor(x) & 255, Y = Math.floor(y) & 255; x -= Math.floor(x); y -= Math.floor(y);
  const u = fade(x), v = fade(y), a = perm[X] + Y, b = perm[X + 1] + Y;
  return lerp(lerp(grad(perm[a], x, y), grad(perm[b], x - 1, y), u), lerp(grad(perm[a + 1], x, y - 1), grad(perm[b + 1], x - 1, y - 1), u), v);
};
P.fbm = (x, y, o = 4) => { let s = 0, a = 0.5, f = 1; for (let i = 0; i < o; i++) { s += a * P.noise(x * f, y * f); a *= 0.5; f *= 2; } return s; };

// ---------- 颜色 ----------
P.hex = h => { h = h.replace('#', ''); if (h.length === 3) h = h.split('').map(x => x + x).join(''); const n = parseInt(h, 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
P.rgb = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
P.mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
P.jitter = (c, r, amt) => [c[0] + (r() - .5) * amt, c[1] + (r() - .5) * amt, c[2] + (r() - .5) * amt];

// ---------- 纹理（缓存） ----------
// 纸/墙/岩石：底色 + 多层噪声斑驳 + 细颗粒
// 斑驳是柔和的低频噪声，半尺寸算再放大，看不出区别、快约 4 倍；细颗粒仍按全尺寸加。
P.texture = (key, base, opt = {}) => P.cached('tex_' + key, W, H, (g) => {
  const { scale = 0.004, amt = 26, grain = 14, dark = null, seed = 1 } = opt;
  const w = Math.ceil(W / 2), h = Math.ceil(H / 2), s = P.canvas(w, h), sg = s.getContext('2d');
  const sm = sg.createImageData(w, h), q = sm.data, b = P.hex(base), dk = dark ? P.hex(dark) : null;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const n = P.fbm(x * 2 * scale + seed, y * 2 * scale, 5), i = (y * w + x) * 4;
    const c = dk ? P.mix(b, dk, clamp(n * 1.2 + 0.25)) : b;
    q[i] = c[0] + n * amt; q[i + 1] = c[1] + n * amt; q[i + 2] = c[2] + n * amt * 0.8; q[i + 3] = 255;
  }
  sg.putImageData(sm, 0, 0);
  g.imageSmoothingQuality = 'high'; g.drawImage(s, 0, 0, W, H);
  if (grain) {
    const img = g.getImageData(0, 0, W, H), d = img.data, r = rng(seed);
    for (let i = 0; i < d.length; i += 4) { const gr = (r() - .5) * grain; d[i] += gr; d[i + 1] += gr; d[i + 2] += gr; }
    g.putImageData(img, 0, 0);
  }
});
// 颗粒噪点叠层（扁平插画的 grain、旧印刷）：透明底上的随机点
P.grain = (key, density = 0.08, col = [0, 0, 0], alpha = 0.18) => P.cached('grain_' + key, W, H, (g) => {
  const img = g.createImageData(W, H), d = img.data, r = rng(key.length * 97 + 3);
  for (let i = 0; i < W * H; i++) if (r() < density) { d[i * 4] = col[0]; d[i * 4 + 1] = col[1]; d[i * 4 + 2] = col[2]; d[i * 4 + 3] = 255 * alpha * (0.4 + r() * 0.6); }
  g.putImageData(img, 0, 0);
});
// ---------- 手绘线 ----------
// 把折线/曲线采样后加噪声抖动；boil = 当前时间换种子的频率（0 = 不抖）
P.boilSeed = (t, fps = 12) => Math.floor(t * fps);
P.roughPath = (c, pts, { amp = 2, seed = 1, closed = false, step = 6 } = {}) => {
  const r = rng(seed);
  // 先按 step 重采样
  const out = [];
  const N = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < N; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.round(L / step));
    for (let k = 0; k < n; k++) { const q = k / n; out.push([lerp(a[0], b[0], q) + (r() - .5) * amp, lerp(a[1], b[1], q) + (r() - .5) * amp]); }
  }
  if (!closed) out.push([pts[pts.length - 1][0] + (r() - .5) * amp, pts[pts.length - 1][1] + (r() - .5) * amp]);
  c.beginPath(); out.forEach((p, i) => i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])); if (closed) c.closePath();
};
// 三次贝塞尔采样成点列（便于 roughPath / 变形）
P.bez = (p0, p1, p2, p3, n = 24) => { const o = []; for (let i = 0; i <= n; i++) { const t = i / n, u = 1 - t; o.push([u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0], u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]]); } return o; };
// SVG path 字符串 → Path2D（写复杂轮廓最省事）
P.path = (d) => new Path2D(d);

// ---------- 通用元素 ----------
// 热气：几条随时间上行的正弦曲线（风格化的 S 形可传 width/color）
P.steam = (c, t, x, y, { h = 80, n = 3, color = 'rgba(255,255,255,.8)', width = 4, spread = 16, wobble = 10, seed = 1 } = {}) => {
  c.save(); c.lineCap = 'round'; c.lineWidth = width;
  for (let k = 0; k < n; k++) {
    const ox = (k - (n - 1) / 2) * spread, ph = t * 3 + k * 2.1 + seed;
    const g = c.createLinearGradient(0, y, 0, y - h); g.addColorStop(0, color); g.addColorStop(1, 'rgba(255,255,255,0)'); c.strokeStyle = g;
    c.beginPath(); for (let s = 0; s <= 20; s++) { const q = s / 20; const xx = x + ox + Math.sin(ph - q * 5) * wobble * q, yy = y - q * h; s ? c.lineTo(xx, yy) : c.moveTo(xx, yy); } c.stroke();
  }
  c.restore();
};
// 粒子：给定种子与时间，返回确定的粒子位置（飘落/上浮）。每颗 life 秒从 y0 走到 y1，快慢由 life 和 y0、y1 的距离决定
P.particles = (n, seed, t, { x0 = 0, x1 = W, y0 = -40, y1 = H + 40, drift = 30, life = 6 } = {}) => {
  const r = rng(seed), out = [];
  for (let i = 0; i < n; i++) { const bx = lerp(x0, x1, r()), ph = r() * life; r(); const q = ((t + ph) % life) / life;   // 空取一次：原来这里取的数没用上，留着让同一个种子的粒子位置不变
    out.push({ x: bx + Math.sin((t + ph) * 1.7 + i) * drift, y: lerp(y0, y1, q), a: r() * Math.PI * 2 + t * (r() - .5) * 3, s: 0.6 + r() * 0.8, q, i }); }
  return out;
};
})();
