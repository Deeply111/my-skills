// MG 基础工具：相当于 After Effects 自带的那一套——形状、布尔、外扩、重复、父子变换、缓动、路径修剪、变形、沿路径走、
// 程序化动作（弹出、错峰、惯性回弹、晃动、循环）、遮罩揭示、投影、渐变、虚线；
// 形状变化（锯齿、波浪、鼓起凹进、扭转、内缩）、按人眼混色、挤压拉伸、跟随拖尾残影、字变形状。
// 不带画风：圆角、线宽、颜色、缓动曲线、时长都由调用的镜头或画笔传进来，这里只给中性的默认值。
// 形状统一用「点列」表示：[[x, y], ...]，闭合形状首尾不重复。修剪、变形、沿路径走都吃点列；MG.path 转成 Path2D 再填色描边。
// 角度用画布的约定：0 朝右，顺时针为正，单位弧度。所有随机都走种子。
(() => {
let W = STAGE.W, H = STAGE.H; U.onStage((w, h) => { W = w; H = h; });   // 画布尺寸跟 U.setStage 走（横屏或竖屏，见 脚本/画幅.py）
const { clamp, lerp } = U;
const TAU = Math.PI * 2;
const MG = window.MG = {};

// ---------- 形状（都以中心定位，返回点列） ----------
MG.ellipse = (cx, cy, rx, ry, n = 96) => { const o = []; for (let i = 0; i < n; i++) { const a = i / n * TAU; o.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]); } return o; };
MG.circle = (cx, cy, r, n = 96) => MG.ellipse(cx, cy, r, r, n);
// 圆角矩形：r 是圆角半径，超过短边一半按一半算（r = 短边一半就是胶囊）
MG.rect = (cx, cy, w, h, r = 0, seg = 12) => {
  r = clamp(r, 0, Math.min(w, h) / 2); const x0 = cx - w / 2, y0 = cy - h / 2, x1 = cx + w / 2, y1 = cy + h / 2;
  if (r < 0.5) return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  const o = [], corner = (ox, oy, a0) => { for (let k = 0; k <= seg; k++) { const a = a0 + k / seg * Math.PI / 2; o.push([ox + Math.cos(a) * r, oy + Math.sin(a) * r]); } };
  corner(x1 - r, y0 + r, -Math.PI / 2); corner(x1 - r, y1 - r, 0); corner(x0 + r, y1 - r, Math.PI / 2); corner(x0 + r, y0 + r, Math.PI);
  return o;
};
MG.capsule = (cx, cy, w, h) => MG.rect(cx, cy, w, h, Math.min(w, h) / 2);
// 任意多边形倒圆角：每个角沿两边各退 r（不超过边长一半），用二次曲线连起来
MG.roundCorners = (pts, r, seg = 10) => {
  if (r <= 0) return pts;
  const n = pts.length, o = [];
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n];
    const l0 = Math.hypot(p0[0] - p1[0], p0[1] - p1[1]), l2 = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]), d = Math.min(r, l0 / 2, l2 / 2);
    const a = [p1[0] + (p0[0] - p1[0]) * d / l0, p1[1] + (p0[1] - p1[1]) * d / l0], b = [p1[0] + (p2[0] - p1[0]) * d / l2, p1[1] + (p2[1] - p1[1]) * d / l2];
    for (let k = 0; k <= seg; k++) { const t = k / seg, u = 1 - t; o.push([u * u * a[0] + 2 * u * t * p1[0] + t * t * b[0], u * u * a[1] + 2 * u * t * p1[1] + t * t * b[1]]); }
  }
  return o;
};
// 正多边形 / 星形：rot 是第一个顶点的角度（默认朝上），round 是倒角半径
MG.poly = (cx, cy, r, n, { rot = -Math.PI / 2, round = 0 } = {}) => {
  const o = []; for (let i = 0; i < n; i++) { const a = rot + i / n * TAU; o.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); }
  return MG.roundCorners(o, round);
};
MG.star = (cx, cy, r0, r1, n, { rot = -Math.PI / 2, round = 0 } = {}) => {
  const o = []; for (let i = 0; i < n * 2; i++) { const a = rot + i / (n * 2) * TAU, r = i % 2 ? r1 : r0; o.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); }
  return MG.roundCorners(o, round);
};
// 扇形（inner = 0）或圆环的一段：从角度 a0 到 a1
MG.arc = (cx, cy, r, a0, a1, { inner = 0, n = 64 } = {}) => {
  const o = [], m = Math.max(2, Math.ceil(n * Math.abs(a1 - a0) / TAU));
  for (let k = 0; k <= m; k++) { const a = lerp(a0, a1, k / m); o.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); }
  if (inner <= 0) o.push([cx, cy]); else for (let k = m; k >= 0; k--) { const a = lerp(a0, a1, k / m); o.push([cx + Math.cos(a) * inner, cy + Math.sin(a) * inner]); }
  return o;
};
// 心形（常用的心形参数方程），r 约等于半宽
MG.heart = (cx, cy, r, n = 96) => { const o = [], k = r / 16; for (let i = 0; i < n; i++) { const t = i / n * TAU; o.push([cx + 16 * Math.sin(t) ** 3 * k, cy - (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) * k]); } return o; };
// 三次贝塞尔曲线（开放点列）
MG.curve = (p0, p1, p2, p3, n = 48) => PAINT.bez(p0, p1, p2, p3, n);

// ---------- 画出来 ----------
MG.path = (pts, closed = true) => U.poly(pts, closed);
MG.fill = (c, pts, style) => { c.fillStyle = style; c.fill(MG.path(pts)); };
MG.stroke = (c, pts, style, w = 4, { closed = false, cap = 'round', join = 'round', dash = null, offset = 0 } = {}) => {
  if (pts.length < 2) return;
  c.save(); c.strokeStyle = style; c.lineWidth = w; c.lineCap = cap; c.lineJoin = join;
  if (dash) { c.setLineDash(dash); c.lineDashOffset = -offset; }
  c.stroke(MG.path(pts, closed)); c.restore();
};
// 虚线：offset 随时间变就是「蚂蚁线」
MG.dash = (c, pts, style, w, on, off, offset = 0, closed = false) => MG.stroke(c, pts, style, w, { closed, dash: [on, off], offset, cap: 'butt' });
MG.linear = (c, x0, y0, x1, y1, stops) => { const g = c.createLinearGradient(x0, y0, x1, y1); stops.forEach(([q, col]) => g.addColorStop(q, col)); return g; };
MG.radial = (c, x, y, r0, r1, stops) => { const g = c.createRadialGradient(x, y, r0, x, y, r1); stops.forEach(([q, col]) => g.addColorStop(q, col)); return g; };

// ---------- 点列运算 ----------
const segs = (pts, closed) => { const L = [0]; const n = pts.length, m = closed ? n : n - 1;
  for (let i = 0; i < m; i++) { const a = pts[i], b = pts[(i + 1) % n]; L.push(L[i] + Math.hypot(b[0] - a[0], b[1] - a[1])); } return L; };
MG.length = (pts, closed = false) => { const L = segs(pts, closed); return L[L.length - 1]; };
// 沿路径 q（0–1）处的点和切线角
MG.along = (pts, q, closed = false) => {
  const L = segs(pts, closed), tot = L[L.length - 1], n = pts.length, d = (closed ? ((q % 1) + 1) % 1 : clamp(q)) * tot;
  let i = 1; while (i < L.length - 1 && L[i] < d) i++;
  const a = pts[i - 1], b = pts[i % n], t = (d - L[i - 1]) / ((L[i] - L[i - 1]) || 1);
  return { x: lerp(a[0], b[0], t), y: lerp(a[1], b[1], t), a: Math.atan2(b[1] - a[1], b[0] - a[0]) };
};
// 按弧长等距取 n 个点（变形前对齐点数用）
MG.resample = (pts, n, closed = true) => { const o = []; for (let i = 0; i < n; i++) { const p = MG.along(pts, closed ? i / n : i / (n - 1), closed); o.push([p.x, p.y]); } return o; };
// 路径修剪：只留 s 到 e 这一段（0–1）。闭合形状可以给 offset 让起点绕圈走
MG.trim = (pts, s, e, { closed = false, offset = 0, step = 3 } = {}) => {
  if (e < s) [s, e] = [e, s];
  if (e - s <= 0) return [];
  const tot = MG.length(pts, closed), n = Math.max(2, Math.ceil((e - s) * tot / step)), o = [];
  for (let k = 0; k <= n; k++) { const p = MG.along(pts, s + (e - s) * k / n + offset, closed); o.push([p.x, p.y]); }
  return o;
};
// 形状变形：两个闭合形状都等距取 n 点，自动找最贴合的起点和方向，再逐点插值
MG.morph = (A, B, p, n = 128) => {
  const a = MG.resample(A, n), b0 = MG.resample(B, n);
  let best = 1e18, bo = 0, br = false;
  for (const rev of [false, true]) { const b = rev ? b0.slice().reverse() : b0;
    for (let o = 0; o < n; o += 2) { let s = 0; for (let i = 0; i < n; i += 4) { const q = b[(i + o) % n]; s += (a[i][0] - q[0]) ** 2 + (a[i][1] - q[1]) ** 2; }
      if (s < best) { best = s; bo = o; br = rev; } } }
  const b = br ? b0.slice().reverse() : b0;
  return a.map((q, i) => { const r = b[(i + bo) % n]; return [lerp(q[0], r[0], p), lerp(q[1], r[1], p)]; });
};
// 点列做变换（和 MG.xf 一样的参数），需要拿到变换后的坐标时用
MG.move = (pts, { x = 0, y = 0, rot = 0, s = 1, sx = s, sy = s, ax = 0, ay = 0 } = {}) => {
  const cs = Math.cos(rot), sn = Math.sin(rot);
  return pts.map(([px, py]) => { const u = (px - ax) * sx, v = (py - ay) * sy; return [x + u * cs - v * sn, y + u * sn + v * cs]; });
};

// ---------- 父子变换 ----------
// MG.xf 里嵌套 MG.xf 就是父子链接：子物体跟着父物体走。
// ax, ay 是锚点（绕哪个点转、按哪个点缩放，用自己的坐标）；x, y 是锚点放在父物体里的位置。
MG.xf = (c, { x = 0, y = 0, rot = 0, s = 1, sx = s, sy = s, ax = 0, ay = 0, alpha = 1 } = {}, fn) => {
  c.save(); c.translate(x, y); if (rot) c.rotate(rot); if (sx !== 1 || sy !== 1) c.scale(sx, sy); if (ax || ay) c.translate(-ax, -ay);
  if (alpha !== 1) c.globalAlpha *= alpha;
  fn(c); c.restore();
};

// ---------- 布尔和外扩 ----------
// 两个形状相加 / 相减（a 减 b）/ 取交叉 / 只留不重叠的部分，结果用 style 填色
const OPS = { add: 'source-over', subtract: 'destination-out', intersect: 'destination-in', exclude: 'xor' };
// 中间用的画布和要画上去的画布一样大（摄像机的层按 范围 开，可能比画面大）
const fitScratch = (key, c) => { const s = PAINT.scratch(key); if (s.width !== c.canvas.width || s.height !== c.canvas.height) { s.width = c.canvas.width; s.height = c.canvas.height; } return s; };
MG.bool = (c, a, b, op, style) => {
  const s = fitScratch('mg_bool', c), g = s.getContext('2d');
  g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, s.width, s.height); g.setTransform(c.getTransform());
  g.globalCompositeOperation = 'source-over'; g.fillStyle = '#000'; g.fill(MG.path(a));
  g.globalCompositeOperation = OPS[op]; g.fill(MG.path(b));
  g.globalCompositeOperation = 'source-in'; g.fillStyle = style; g.setTransform(1, 0, 0, 1, 0, 0); g.fillRect(0, 0, s.width, s.height);
  g.globalCompositeOperation = 'source-over';
  c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.drawImage(s, 0, 0); c.restore();
};
// 外扩一圈：形状向外长 d 像素，填 style（贴纸白边、轮廓光）。先画外扩，再在上面画原形状
MG.grow = (c, pts, d, style) => { const p = MG.path(pts); c.save(); c.fillStyle = c.strokeStyle = style; c.lineWidth = d * 2; c.lineJoin = 'round'; c.stroke(p); c.fill(p); c.restore(); };

// ---------- 重复器 ----------
MG.repeat = (n, fn) => { for (let i = 0; i < n; i++) fn(i, n > 1 ? i / (n - 1) : 0); };
// 一圈：fn(x, y, 朝外的角度, i)
MG.ring = (n, cx, cy, r, fn, rot = -Math.PI / 2) => { for (let i = 0; i < n; i++) { const a = rot + i / n * TAU; fn(cx + Math.cos(a) * r, cy + Math.sin(a) * r, a, i); } };
// 一片：fn(x, y, 列, 行, 序号)，整片以 (cx, cy) 为中心
MG.grid = (cols, rows, cx, cy, dx, dy, fn) => { for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) fn(cx + (i - (cols - 1) / 2) * dx, cy + (j - (rows - 1) / 2) * dy, i, j, j * cols + i); };

// ---------- 缓动 ----------
// 动作规格里的曲线用 CSS 的 cubic-bezier 四个数写（和 AE、Figma、Material 的写法一样），MG.bezier 把它变成函数
const bzCache = {};
MG.bezier = (x1, y1, x2, y2) => {
  const key = [x1, y1, x2, y2].join(); if (bzCache[key]) return bzCache[key];
  const bx = t => 3 * x1 * t * (1 - t) ** 2 + 3 * x2 * t * t * (1 - t) + t ** 3, by = t => 3 * y1 * t * (1 - t) ** 2 + 3 * y2 * t * t * (1 - t) + t ** 3;
  return bzCache[key] = p => { if (p <= 0) return 0; if (p >= 1) return 1; let lo = 0, hi = 1; for (let k = 0; k < 30; k++) { const m = (lo + hi) / 2; if (bx(m) < p) lo = m; else hi = m; } return by((lo + hi) / 2); };
};
MG.ease = {
  ...U.ease,
  outQuint: p => 1 - (1 - p) ** 5,
  outExpo: p => p >= 1 ? 1 : 1 - 2 ** (-10 * p),
  inOutExpo: p => p <= 0 ? 0 : p >= 1 ? 1 : p < .5 ? 2 ** (20 * p - 10) / 2 : (2 - 2 ** (-20 * p + 10)) / 2,
  inBack: (p, s = 1.70158) => (s + 1) * p ** 3 - s * p * p,                                   // 先往回收一点再走：蓄力
  outBack: (p, s = 1.70158) => 1 + (s + 1) * (p - 1) ** 3 + s * (p - 1) ** 2,                // 冲过头一点再回来
  outElastic: (p, period = 0.3) => p <= 0 ? 0 : p >= 1 ? 1 : 2 ** (-10 * p) * Math.sin((p - period / 4) * TAU / period) + 1,
};
// 弹簧：按秒算（不按进度），从 0 走向 1。freq 每秒振几次，damp 阻尼比（越小弹得越多，1 = 不弹）
MG.spring = (dt, { freq = 2.2, damp = 0.4 } = {}) => {
  if (dt <= 0) return 0;
  const w = TAU * freq, z = Math.min(damp, 0.999), wd = w * Math.sqrt(1 - z * z);
  return 1 - Math.exp(-z * w * dt) * (Math.cos(wd * dt) + z * w / wd * Math.sin(wd * dt));
};

// ---------- 程序化动作 ----------
// t0 开始、dur 秒走完，返回缓动后的 0–1
MG.tween = (t, t0, dur, ease = MG.ease.linear) => ease(clamp((t - t0) / dur));
// 错峰：第 i 个比前一个晚 each 秒
MG.stagger = (t, i, t0, each, dur, ease) => MG.tween(t, t0 + i * each, dur, ease);
// 弹出：t0 起从 0 弹到 1（带一点冲过头），返回缩放值
MG.pop = (t, t0, spring = {}) => MG.spring(t - t0, { freq: 2.6, damp: 0.45, ...spring });
// 收回：t1 起 dur 秒内先微微鼓一下再缩没
MG.popOut = (t, t1, dur = 0.3) => 1 - MG.ease.inBack(clamp((t - t1) / dur), 2.2);
// 惯性回弹：f(t) 是一段在 tStop 停下的运动（返回数或 [x, y]）。停下以后按停前的速度冲过头、来回衰减，像 AE 的 inertial bounce 表达式
MG.inertia = (f, t, tStop, { freq = 2.5, decay = 5 } = {}) => {
  const v0 = f(Math.min(t, tStop));
  if (t <= tStop) return v0;
  const h = 1 / 60, a = f(tStop), b = f(tStop - h), dt = t - tStop, w = TAU * freq, k = Math.sin(w * dt) / Math.exp(decay * dt) / w;
  return Array.isArray(a) ? a.map((q, i) => q + (q - b[i]) / h * k) : a + (a - b) / h * k;
};
// 晃动：平滑的随机起伏，freq 每秒大约晃几下，amp 幅度
MG.wiggle = (t, freq, amp, seed = 1) => PAINT.noise(t * freq + 0.5, seed * 17.31) * amp * 1.4;
MG.wiggle2 = (t, freq, amp, seed = 1) => [MG.wiggle(t, freq, amp, seed), MG.wiggle(t, freq, amp, seed + 101)];
// 循环：每 period 秒从 0 走到 1；pingpong 来回走
MG.loop = (t, period) => ((t % period) + period) % period / period;
MG.pingpong = (t, period) => { const q = MG.loop(t, period * 2) * 2; return q < 1 ? q : 2 - q; };

// ---------- 遮罩揭示 ----------
// 只在形状里面画（invert = true 就只在外面画）
MG.clip = (c, pts, fn, invert = false) => {
  c.save(); const p = MG.path(pts);
  if (invert) { const q = new Path2D(); q.rect(-W, -H, W * 3, H * 3); q.addPath(p); c.clip(q, 'evenodd'); } else c.clip(p);
  fn(c); c.restore();
};
// 圆形擦出：p 从 0 到 1，圆从 (cx, cy) 长到盖满画面
MG.iris = (c, cx, cy, p, fn) => { const R = Math.hypot(Math.max(cx, W - cx), Math.max(cy, H - cy)); if (p <= 0) return; MG.clip(c, MG.circle(cx, cy, R * p, 128), fn); };
// 直线擦出：沿角度 ang 的方向推进，p 从 0 到 1
MG.wipe = (c, p, ang, fn) => {
  if (p <= 0) return;
  const R = Math.hypot(W, H), cx = W / 2, cy = H / 2, dx = Math.cos(ang), dy = Math.sin(ang), nx = -dy, ny = dx, front = -R / 2 + R * p;
  MG.clip(c, [[cx - dx * R / 2 + nx * R, cy - dy * R / 2 + ny * R], [cx + dx * front + nx * R, cy + dy * front + ny * R],
              [cx + dx * front - nx * R, cy + dy * front - ny * R], [cx - dx * R / 2 - nx * R, cy - dy * R / 2 - ny * R]], fn);
};

// ---------- 投影 ----------
// 硬边投影：整块形状平移 (dx, dy) 画一份
MG.shadow = (c, pts, dx, dy, style) => MG.fill(c, MG.move(pts, { x: dx, y: dy }), style);
// 长投影：形状沿角度 ang 拉出 len 长的影子（扁平插画常见）；alpha 是整条影子的透明度，影子自己不叠深
MG.longShadow = (c, pts, ang, len, style, alpha = 1) => {
  const s = fitScratch('mg_long', c), g = s.getContext('2d'), dx = Math.cos(ang) * len, dy = Math.sin(ang) * len, n = pts.length;
  g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, s.width, s.height); g.setTransform(c.getTransform()); g.fillStyle = style;
  for (let i = 0; i < n; i++) { const a = pts[i], b = pts[(i + 1) % n]; g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.lineTo(b[0] + dx, b[1] + dy); g.lineTo(a[0] + dx, a[1] + dy); g.closePath(); g.fill(); }
  g.fill(MG.path(MG.move(pts, { x: dx, y: dy })));
  c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha *= alpha; c.drawImage(s, 0, 0); c.restore();
};

// ---------- 形状变化（AE 形状层的修改器） ----------
// 点 i 处朝外的法线（按点列的绕向判断里外）
const area = pts => { let s = 0; for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; s += a[0] * b[1] - b[0] * a[1]; } return s / 2; };
const normals = (pts, closed = true) => { const n = pts.length, sg = area(pts) > 0 ? 1 : -1;
  return pts.map((p, i) => { const a = pts[closed ? (i - 1 + n) % n : Math.max(0, i - 1)], b = pts[closed ? (i + 1) % n : Math.min(n - 1, i + 1)];
    const tx = b[0] - a[0], ty = b[1] - a[1], l = Math.hypot(tx, ty) || 1; return [ty / l * sg, -tx / l * sg]; }); };
// 锯齿 / 波浪：沿边每 wave 像素起伏一次，幅度 amp；smooth = true 是圆滑的波浪
MG.zigzag = (pts, amp, wave = 40, { smooth = false, closed = true, phase = 0 } = {}) => {
  const L = MG.length(pts, closed), k = Math.max(2, Math.round(L / wave)), n = smooth ? k * 8 : k * 2;
  const q = MG.resample(pts, n, closed), N = normals(q, closed);
  return q.map((p, i) => { const s = smooth ? Math.sin(i / n * k * TAU + phase) : (i % 2 ? 1 : -1); return [p[0] + N[i][0] * amp * s, p[1] + N[i][1] * amp * s]; });
};
// 鼓起 / 收缩：每条边向外鼓（amt > 0）或向里凹（amt < 0），amt 按边长算。给顶点少的形状用（多边形、星形）
MG.bloat = (pts, amt, seg = 12) => {
  const n = pts.length, sg = area(pts) > 0 ? 1 : -1, o = [];
  for (let i = 0; i < n; i++) { const a = pts[i], b = pts[(i + 1) % n], ex = b[0] - a[0], ey = b[1] - a[1], l = Math.hypot(ex, ey);
    const cx = (a[0] + b[0]) / 2 + ey / l * sg * amt * l, cy = (a[1] + b[1]) / 2 - ex / l * sg * amt * l;
    for (let k = 0; k < seg; k++) { const t = k / seg, u = 1 - t; o.push([u * u * a[0] + 2 * u * t * cx + t * t * b[0], u * u * a[1] + 2 * u * t * cy + t * t * b[1]]); } }
  return o;
};
// 扭转：离中心越远转得越多，最外圈转 ang
MG.twist = (pts, ang, cx, cy) => { const R = Math.max(...pts.map(p => Math.hypot(p[0] - cx, p[1] - cy))) || 1;
  return pts.map(([x, y]) => { const r = Math.hypot(x - cx, y - cy), a = Math.atan2(y - cy, x - cx) + ang * r / R; return [cx + Math.cos(a) * r, cy + Math.sin(a) * r]; }); };
// 向内缩一圈（d < 0 是向外扩）。适合圆滑的形状；尖角很多的形状缩多了会自相交
MG.inset = (pts, d, step = 4) => { const q = MG.resample(pts, Math.max(8, Math.round(MG.length(pts, true) / step))), N = normals(q); return q.map((p, i) => [p[0] - N[i][0] * d, p[1] - N[i][1] * d]); };

// ---------- 颜色：按人眼感觉混色（OKLab） ----------
// 普通的 RGB 混色中间会发灰发脏（蓝到黄中间一团灰）；OKLab 里混，过渡亮度均匀、颜色干净
const lin = v => (v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4, gam = v => 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
const toLab = hex => { const [r, g, b] = PAINT.hex(hex).map(lin);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b), m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b), s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s, 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s]; };
const fromLab = ([L, A, B]) => { const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3, m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3, s = (L - 0.0894841775 * A - 1.2914855480 * B) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s].map(v => clamp(gam(v), 0, 255)); };
MG.mix = (a, b, t) => { const p = toLab(a), q = toLab(b), [r, g, bl] = fromLab(p.map((v, i) => lerp(v, q[i], t))); return `rgb(${r | 0},${g | 0},${bl | 0})`; };
// 多个颜色排成一条，t 从 0 到 1 依次经过
MG.ramp = (hexes, t) => { const n = hexes.length - 1, x = clamp(t) * n, i = Math.min(n - 1, Math.floor(x)); return MG.mix(hexes[i], hexes[i + 1], x - i); };

// ---------- 挤压拉伸、跟随、残影 ----------
// 挤压拉伸：k > 1 拉长、k < 1 压扁，面积不变。返回 { sx, sy }，直接传给 MG.xf
MG.squash = k => ({ sx: 1 / k, sy: k });
// 按速度方向拉长：(vx, vy) 是每秒像素，amt 是拉长的力度，max 是最多拉到几倍
MG.stretch = (c, x, y, vx, vy, fn, { amt = 0.0004, max = 1.6 } = {}) => {
  const sp = Math.hypot(vx, vy), k = Math.min(max, 1 + sp * amt), a = Math.atan2(vy, vx);
  MG.xf(c, { x, y, rot: a }, () => MG.xf(c, { sx: k, sy: 1 / k }, () => MG.xf(c, { rot: -a }, fn)));   // 转到运动方向 → 拉长 → 转回来
};
// 速度：f(t) 返回数或 [x, y]，按前后各一帧算每秒的变化
MG.speed = (f, t, h = 1 / 60) => { const a = f(t - h), b = f(t + h); return Array.isArray(a) ? a.map((v, i) => (b[i] - v) / (2 * h)) : (b - a) / (2 * h); };
// 跟随：后面的部分晚 delay 秒做同样的事
MG.lag = (f, t, delay) => f(t - delay);
// 拖尾：沿 f 走过的路，取 n 个点，每个比前一个晚 gap 秒（尾巴、飘带、蛇）
MG.trail = (f, t, n, gap) => { const o = []; for (let i = 0; i < n; i++) o.push(f(t - i * gap)); return o; };
// 残影：fn(tt, alpha) 画 tt 时刻的样子；从最旧的画起，越旧越淡，最后画当前
MG.echo = (c, t, n, gap, fn, fade = 0.5) => { for (let i = n; i >= 1; i--) { c.save(); c.globalAlpha *= fade * (1 - i / (n + 1)); fn(t - i * gap, i); c.restore(); } fn(t, 0); };

// ---------- 字变形状 ----------
// 把字的笔画轮廓取出来当形状用：描出来、修剪、遮罩、拿某一笔去变形。字形字体由 render.py 登记在 window.GLYPH_FONTS，
// 页面准备时 MG.loadGlyphFonts() 读进来（opentype.js，引擎/第三方/）。可变字体只能取到默认字重，所以登记的是固定字重的文件。
const GF = {}, GC = {};
MG.loadGlyphFonts = () => Promise.all(Object.entries(window.GLYPH_FONTS || {}).map(([k, url]) => new Promise((res, rej) =>
  opentype.load(url, (e, f) => e ? rej(new Error(`读不了字形字体 ${k}：${e}`)) : (GF[k] = f, res())))));
// 字体里有没有这个字（字幕查缺字用）
MG.hasGlyph = (font, ch) => { const f = GF[font]; if (!f) throw new Error(`字形字体 ${font} 没登记（render.py 的 GLYPH_FONTS）`); return f.charToGlyphIndex(ch) > 0; };
// 一个字在原点的轮廓（基线在 y = 0），曲线按 step 像素拆成点
const glyphContours = (font, ch, size, step) => {
  const key = font + '|' + ch + '|' + size + '|' + step; if (GC[key]) return GC[key];
  const f = GF[font]; if (!f) throw new Error(`字形字体 ${font} 没登记（render.py 的 GLYPH_FONTS）`);
  const out = []; let cur = null, px = 0, py = 0;
  const seg = (fnx, fny, len) => { const k = Math.max(2, Math.ceil(len / step)); for (let i = 1; i <= k; i++) cur.push([fnx(i / k), fny(i / k)]); };
  for (const cm of f.getPath(ch, 0, 0, size).commands) {
    if (cm.type === 'M') { cur = [[cm.x, cm.y]]; out.push(cur); }
    else if (cm.type === 'L') cur.push([cm.x, cm.y]);
    else if (cm.type === 'Q') { const [x0, y0] = [px, py]; seg(t => (1 - t) ** 2 * x0 + 2 * (1 - t) * t * cm.x1 + t * t * cm.x, t => (1 - t) ** 2 * y0 + 2 * (1 - t) * t * cm.y1 + t * t * cm.y, Math.hypot(cm.x - x0, cm.y - y0) * 1.3); }
    else if (cm.type === 'C') { const [x0, y0] = [px, py]; seg(t => (1 - t) ** 3 * x0 + 3 * (1 - t) ** 2 * t * cm.x1 + 3 * (1 - t) * t * t * cm.x2 + t ** 3 * cm.x, t => (1 - t) ** 3 * y0 + 3 * (1 - t) ** 2 * t * cm.y1 + 3 * (1 - t) * t * t * cm.y2 + t ** 3 * cm.y, Math.hypot(cm.x - x0, cm.y - y0) * 1.5); }
    if (cm.type !== 'Z') { px = cm.x; py = cm.y; }
  }
  for (const c of out) { const a = c[0], b = c[c.length - 1]; if (c.length > 1 && Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.01) c.pop(); }
  return GC[key] = { contours: out.filter(c => c.length > 2), adv: f.getAdvanceWidth(ch, size) };
};
// 一段字 → 每个字的形状：[{ ch, x, y, w, contours: [点列...] }]。x, y 是这个字基线的起点；contours 已经放到画面位置上
MG.glyphs = (text, { font = 'Song-600', size = 120, x = 0, y = 0, align = 'left', spacing = 0, step = 3 } = {}) => {
  const chars = [...text], gs = chars.map(ch => glyphContours(font, ch, size, step));
  const total = gs.reduce((s, g) => s + g.adv, 0) + spacing * (chars.length - 1);
  let cx = align === 'center' ? x - total / 2 : align === 'right' ? x - total : x;
  return chars.map((ch, i) => { const g = gs[i], o = { ch, x: cx, y, w: g.adv, contours: g.contours.map(c => c.map(([px, py]) => [px + cx, py + y])) }; cx += g.adv + spacing; return o; });
};
// 一个字（或一组字）所有轮廓合成一个 Path2D，笔画里的洞自动留空
MG.glyphPath = gs => { const p = new Path2D(); (Array.isArray(gs) ? gs : [gs]).forEach(g => g.contours.forEach(c => p.addPath(MG.path(c)))); return p; };
MG.fillGlyphs = (c, gs, style) => { c.fillStyle = style; c.fill(MG.glyphPath(gs)); };

// ---------- 比喻元素（出自《傲慢》v6：比喻从场景里长出来）----------
// 全片的比喻元素用同一种颜色或线型（风格卡里定），观众一眼分清"这是比喻，不是布景"。位置贴着画里（或 3D 里，S3.投影）的东西走。
// 长线：从 起 长到 终 的一根细线（二次曲线，控 是控制点），进度 0–1 是长到哪，尾 0–1 是尾巴收到哪（缩回去）；带一层柔光，可加线头亮点
//   MG.长线(c, 起, 控, 终, 进度, '#ece7dc', { 粗: 2, 尾: 0, 尖: 2, 透明: 1, 虚线: null })   → 返回线头的位置（没画返回 null）
//   用法：话线（人开口，一根线弯向听的人）、手臂线（人身上伸出去够东西）、门槛线（台沿亮起一道线横过去）、视线
MG.长线 = (c, 起, 控, 终, 进度, 色, { 粗 = 2, 尾 = 0, 尖 = 0, 透明 = 1, 虚线 = null, 光 = 1 } = {}) => {
  if (进度 <= 尾 || 透明 <= 0) return null;
  const q = s => [(1 - s) ** 2 * 起[0] + 2 * (1 - s) * s * 控[0] + s * s * 终[0], (1 - s) ** 2 * 起[1] + 2 * (1 - s) * s * 控[1] + s * s * 终[1]];
  const pts = []; for (let i = 0; i <= 48; i++) pts.push(q(尾 + (进度 - 尾) * i / 48));
  c.save(); c.globalCompositeOperation = 'lighter'; c.globalAlpha *= 透明;
  if (光) { c.shadowColor = 色; c.shadowBlur = 粗 * 6 * 光; }
  MG.stroke(c, pts, 色, 粗, { dash: 虚线 }); c.shadowBlur = 0; MG.stroke(c, pts, 色, 粗 * .5, { dash: 虚线 });
  const tip = q(进度); if (尖) { c.fillStyle = 色; c.beginPath(); c.arc(tip[0], tip[1], 尖, 0, TAU); c.fill(); }
  c.restore(); return tip;
};
// 碎灰：一点上的东西碎成细粒，散开、往下落、淡掉（进度 0–1）。话碰到门槛线碎掉、气泡飘到耳边散成灰
MG.碎灰 = (c, 点, 进度, 色, { 粒 = 40, 散 = 70, 落 = 90, 种子 = 1 } = {}) => {
  if (进度 <= 0 || 进度 >= 1) return; const r = U.rng(种子), e = 1 - (1 - 进度) ** 2;
  c.save(); c.globalCompositeOperation = 'lighter'; c.fillStyle = 色;
  for (let i = 0; i < 粒; i++) { const vx = (r() - .5) * 散, vy = -10 - r() * 散 * .35, s = 1 + r() * 1.6;
    c.globalAlpha = (1 - e) * (.5 + r() * .5); c.fillRect(点[0] + vx * e, 点[1] + vy * e + 落 * e * e, s, s); }
  c.restore();
};
// 光团：一团小光（中心偏白、外圈是色、柔边），"自己有的东西"、念头、够不着的目标
MG.光团 = (c, 点, 半径, 亮度, 色 = '#eec070') => {
  if (亮度 <= 0) return; const [r, g, b] = U.rgb(色), R = 半径 * 3.2;
  c.save(); c.globalCompositeOperation = 'lighter';
  c.fillStyle = MG.radial(c, 点[0], 点[1], 0, R, [[0, `rgba(255,236,200,${亮度})`], [.18, `rgba(${r},${g},${b},${亮度 * .85})`], [1, `rgba(${r},${g},${b},0)`]]);
  c.beginPath(); c.arc(点[0], 点[1], R, 0, TAU); c.fill(); c.restore();
};
})();
