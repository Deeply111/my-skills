// 摄像机：每个镜头一台，两版共用；画面按远、中、近分层，摄像机一动自动算视差。在 stage.js 之后加载。
//
// 镜头文件里：
//   SHOT('B2', {
//     机: CAM({ 推: 1.3, 从: .5, 到: 3.5 }, { 漂: .01 }),
//     board: (c, lt, x) => CAM.画(c, x, [[.3, 远景], [1, 主体], [1.6, 前景, { 虚: lt => ... }]]),
//   });
//   层从远到近排，每层 [景深系数, (c, lt, x) => {...}, 选项]：远 0.3、中（对焦的那一层）1.0、近 1.6。
//   层的画法照常写，坐标就是画面坐标；摄像机不动时三层和不分层时画出来一样。
//   选项：虚 0–1 或 lt => 0–1（移焦：清楚的和虚化好的两张交叉淡化，不逐帧算模糊）；
//         静 true（这一层的画不随时间变，虚化好的那张存下来重复用）；范围 [x0, y0, x1, y1]（这一层画到哪，默认整个画面：这一层的画布按它开，画在范围外的会被裁掉；查露边也用它）。
//         层里照常用画面坐标画，别用 setTransform(1, 0, 0, 1, 0, 0) 重置坐标（层的画布有偏移）。
//         露边：最远的那层要盖满画面；中、近的层只查画到了边上的那几条边（贴着边有实的颜色，说明本该接着往外画），这条边被移进画面里就算露边。
//
// 运动（可以叠加，从/到 是镜头内的秒数，不写就是整个镜头）：
//   { 推: 1.3 }  推近到 1.3 倍；{ 拉: 1.3 } 拉远；向: [x, y] 推的同时把这一点带到画面中心；猛: true 全片最重的一刻的猛推
//   { 横移: 300 } 摄像机往右移 300 像素（负数往左）；{ 升降: 200 } 往上（负数往下）
//   { 漂: .015 }  每秒放大 1.5%，匀速，静止镜头也活着
//   { 震: 8, 在: 2.1 }  第 2.1 秒震一下，8 像素，0.3 秒内衰减完
//   { 呼吸: 2 }  手持感的轻微晃动，2 像素，有手持感的画风才用
//   曲线：默认起步加速、到位刹车；曲线: '匀速'|'加速'|'刹车'。推拉按倍数均匀变，不会越推越慢。
//   首尾相接的两个运动（前一个的 到 = 后一个的 从），后一个自动提前 0.3 秒起步，中间不会停一下。
// 镜内硬切（同一场景换景别、在动作上剪，不压暗）：机: CAM.切([0, CAM(...全景...)], [2.4, CAM({ 漂: .01 })]) ——
//   每段一台摄像机，段里的 从/到 从这一段开头算；切过去那一帧检查按切点算（不报"突然跳动"），字幕位置照常可以跟着换（字幕写成函数）。
// 设置（不含运动的那个对象）：拖影: true 快动时加拖影（快门 180°）；接上一镜: true 这一镜带着上一镜结束时的速度起步（检查会对比切点两边的速度）。
(() => {
const { W, H } = STAGE, C = [W / 2, H / 2], FPS = 30, BLUR = 11;
const { clamp } = U;
const MOVES = ['推', '拉', '横移', '升降', '漂', '震', '呼吸'];
const CURVE = { 匀速: p => p, 加速: p => p * p * p, 刹车: p => 1 - (1 - p) ** 3, 默认: U.ease.inOut };

window.CAM = (...args) => {
  const set = Object.assign({}, ...args.filter(a => !MOVES.some(k => k in a)));
  const mv = args.filter(a => MOVES.some(k => k in a)).map(a => Object.assign({ 从: 0, 到: Infinity }, a));
  // 首尾相接的移动，后一个提前 0.3 秒起步
  const go = mv.filter(m => '推' in m || '拉' in m || '横移' in m || '升降' in m).sort((a, b) => a.从 - b.从);
  go.forEach((m, i) => { if (i && go.slice(0, i).some(p => Math.abs(p.到 - m.从) < .05)) m.从 = Math.max(go[i - 1].从, m.从 - .3); });
  const prog = (m, t, d) => { const to = Math.min(m.到, d), f = CURVE[m.曲线] || (m.曲线 && window.gsap ? gsap.parseEase(m.曲线) : null) || CURVE.默认; return to <= m.从 ? (t >= m.从 ? 1 : 0) : f(clamp((t - m.从) / (to - m.从))); };   // 曲线也可以写 GSAP 的名字
  const at = (t, d = Infinity) => {
    let cx = C[0], cy = C[1], k = 1, r = 0, sx = 0, sy = 0;
    for (const m of mv) {
      const p = prog(m, t, d);
      if ('推' in m || '拉' in m) { k *= ('推' in m ? m.推 : 1 / m.拉) ** p; if (m.向) { cx += (m.向[0] - C[0]) * p; cy += (m.向[1] - C[1]) * p; } }
      if ('横移' in m) cx += m.横移 * p;
      if ('升降' in m) cy -= m.升降 * p;
      if ('漂' in m && t > m.从) k *= (1 + m.漂) ** (Math.min(t, m.到) - m.从);
      if ('震' in m) { const u = t - m.在; if (u >= 0 && u < .3) { const a = m.震 * Math.exp(-u / .08) * Math.sin(u * 18 * U.TAU); sx += a * .8; sy += a * .6; } }
      if ('呼吸' in m) { sx += m.呼吸 * (Math.sin(t * 1.9) * .6 + Math.sin(t * 3.1 + 1) * .4); sy += m.呼吸 * (Math.sin(t * 1.3 + 2) * .6 + Math.sin(t * 2.7) * .4); r += .2 * Math.sin(t * 1.1); }
    }
    return { cx, cy, k, r, sx, sy };
  };
  const f = (lt, d) => at(lt, d);
  f.at = at; f.set = set;
  f.动 = (lt, d) => { const a = at(lt, d), b = at(lt + 1 / FPS, d); return Math.abs(a.cx - b.cx) + Math.abs(a.cy - b.cy) + Math.abs(a.k - b.k) * 1000 + Math.abs(a.sx - b.sx) + Math.abs(a.sy - b.sy) + Math.abs(a.r - b.r) * 100 > 1e-3; };
  f.猛 = mv.some(m => m.猛);
  f.震 = mv.filter(m => '震' in m).length;
  // 移动量太小（不到 40 像素，又不是漂、震、呼吸），看起来像手抖了一下；推拉带 向 的，把带到中心的那段平移也算上
  const pan = m => m.向 ? Math.hypot(m.向[0] - C[0], m.向[1] - C[1]) : 0;
  f.小 = mv.filter(m => { const n = '横移' in m ? Math.abs(m.横移) : '升降' in m ? Math.abs(m.升降) : '推' in m ? Math.max((m.推 - 1) * H / 2, pan(m)) : '拉' in m ? Math.max((1 - 1 / m.拉) * H / 2, pan(m)) : Infinity; return n < 40; }).length;
  return f;
};

// 镜内硬切：几段摄像机接起来，每段的时间从段头算；f.段(lt) 是第几段（render.py 用它把切点后的帧当新的一段检查）
window.CAM.切 = (...segs) => {
  segs.sort((a, b) => a[0] - b[0]);
  if (!segs.length || segs[0][0] !== 0) throw new Error('CAM.切：第一段要从 0 秒开始');
  const idx = lt => { let i = 0; while (i + 1 < segs.length && lt >= segs[i + 1][0]) i++; return i; };
  const local = (lt, d) => { const i = idx(lt), t0 = segs[i][0], t1 = i + 1 < segs.length ? segs[i + 1][0] : d; return [segs[i][1], lt - t0, (t1 ?? Infinity) - t0]; };
  const at = (lt, d = Infinity) => { const [c, t, dd] = local(lt, d); return c.at(t, dd); };
  const f = (lt, d) => at(lt, d);
  f.at = at; f.set = Object.assign({}, ...segs.map(s => s[1].set)); f.段 = idx; f.切点 = segs.slice(1).map(s => s[0]);
  f.动 = (lt, d) => { const [c, t, dd] = local(lt, d); return idx(lt + 1 / FPS) === idx(lt) && c.动(t, dd); };
  f.猛 = segs.some(s => s[1].猛); f.震 = segs.reduce((n, s) => n + s[1].震, 0); f.小 = segs.reduce((n, s) => n + s[1].小, 0);
  return f;
};

// 某一层在某个摄像机状态下的变换：景深系数 f 的层，平移是对焦层的 f 倍，放大倍数是 k 的 f 次方
const mat = (s, f) => {
  const z = s.k ** f, ox = C[0] + (s.cx - C[0]) * f, oy = C[1] + (s.cy - C[1]) * f;
  return new DOMMatrix().translate(C[0] + s.sx, C[1] + s.sy).rotate(s.r).scale(z).translate(-ox, -oy);
};
// 这一层在屏幕上每帧移动多少像素（取画面四角处最大的位移）
const speed = (a, b, f) => {
  const m = mat(b, f).multiply(mat(a, f).inverse());
  return Math.max(...[[0, 0], [W, 0], [0, H], [W, H]].map(([x, y]) => { const p = m.transformPoint({ x, y }); return Math.hypot(p.x - x, p.y - y); }));
};

const canvases = {};
const cv = (key, w = W, h = H) => { const c = canvases[key]; return c && c.width === w && c.height === h ? c : (canvases[key] = Object.assign(document.createElement('canvas'), { width: w, height: h })); };
const blurred = {};   // 静的层：虚化好的那张按 镜头/层 存下来

window.CAM.画 = (c, x, layers) => {
  const cam = x.机, id = window.__SHOT, lt = x.lt, ct = x.ct ?? x.lt;   // lt 画层用（分镜版一顿一顿），ct 摄像机用（照样每秒 30 帧平滑地动）
  if (!cam) throw new Error(`镜头 ${id} 用了 CAM.画，但没写 机: CAM(...)`);
  const seg = cam.段 ? cam.段(ct) : 0, s0 = cam.at(ct, x.d), s1 = cam.段 && cam.段(ct + 1 / FPS) !== seg ? s0 : cam.at(ct + 1 / FPS, x.d), drag = cam.set.拖影;   // 切点前最后一帧不算速度
  window.__SEG = seg;
  const rec = { 速度: 0, 放大: s1.k / s0.k - 1, 拖影: !!drag, 猛: cam.猛, 震: cam.震, 小: cam.小, 接: !!cam.set.接上一镜, v: [s1.cx - s0.cx, s1.cy - s0.cy], 露边: null,
               总: x.d ? cam.at(x.d, x.d).k / cam.at(0, x.d).k : 1 };   // 总：整个镜头推近了多少倍（推得多，近处的描边会跟着变粗）
  layers.forEach(([f, draw, o = {}], i) => {
    // 先把这一层画在自己的画布上。画布按 范围 开（比画面大的层，画面外的部分也留着，镜头移过去才有东西）
    const R = o.范围 || [0, 0, W, H], ox = Math.floor(R[0]), oy = Math.floor(R[1]), lw = Math.ceil(R[2]) - ox, lh = Math.ceil(R[3]) - oy;
    const L = cv('层' + i, lw, lh), g = L.getContext('2d'), n0 = __TEXTS.length;
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, lw, lh); g.setTransform(1, 0, 0, 1, -ox, -oy); g.save(); draw(g, lt, x); g.restore();
    const place = s => mat(s, f).translate(ox, oy);   // 层画布上的像素 → 屏幕
    // 这一层里登记的字（TEXT.draw / TEXT.mark）换算到屏幕上，检查才知道它跟着镜头跑了多少
    const m0 = place(s0);
    __TEXTS.slice(n0).forEach(t => { const [x0, y0, x1, y1] = t.box, P = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]].map(([px, py]) => m0.transformPoint({ x: px, y: py }));
      t.box = [Math.min(...P.map(q => q.x)), Math.min(...P.map(q => q.y)), Math.max(...P.map(q => q.x)), Math.max(...P.map(q => q.y))]; });
    // 移焦：清楚的和虚化好的两张交叉淡化
    const blur = typeof o.虚 === 'function' ? o.虚(ct) : o.虚 || 0;
    let src = L;
    if (blur > 0) {
      const key = id + '/' + i, B = o.静 && blurred[key] ? blurred[key] : cv('虚' + i, lw, lh);
      if (!(o.静 && blurred[key])) { const bg = B.getContext('2d'); bg.setTransform(1, 0, 0, 1, 0, 0); bg.clearRect(0, 0, lw, lh); bg.filter = `blur(${BLUR}px)`; bg.drawImage(L, 0, 0); bg.filter = 'none';
        if (o.静) { blurred[key] = B; canvases['虚' + i] = null; } }
      const M = cv('合' + i, lw, lh), mg = M.getContext('2d');
      mg.setTransform(1, 0, 0, 1, 0, 0); mg.clearRect(0, 0, lw, lh);
      mg.globalAlpha = 1 - clamp(blur); mg.drawImage(L, 0, 0); mg.globalAlpha = clamp(blur); mg.drawImage(B, 0, 0); mg.globalAlpha = 1;
      src = M;
    }
    // 拖影：快门开半帧，沿运动方向叠几张；每帧移动 4 像素以下不叠
    const v = speed(s0, s1, f); rec.速度 = Math.max(rec.速度, v);
    const n = drag && v > 4 ? Math.min(16, Math.ceil(v * .5 / 3)) : 1;
    c.save(); c.setTransform(1, 0, 0, 1, 0, 0);
    if (n === 1) { c.setTransform(m0); c.drawImage(src, 0, 0); }
    else {
      const A = cv('拖'), ag = A.getContext('2d');
      ag.setTransform(1, 0, 0, 1, 0, 0); ag.clearRect(0, 0, W, H); ag.globalCompositeOperation = 'lighter'; ag.globalAlpha = 1 / n;
      for (let j = 0; j < n; j++) { ag.setTransform(place(cam.at(ct + (j / (n - 1) - .5) * .5 / FPS, x.d))); ag.drawImage(src, 0, 0); }
      ag.globalCompositeOperation = 'source-over'; ag.globalAlpha = 1; c.drawImage(A, 0, 0);
    }
    c.restore();
    // 露边：最远的那层要盖满画面
    if (i === 0) {
      const inv = mat(s0, f).inverse();
      const out = [[0, 0], [W, 0], [0, H], [W, H]].some(([px, py]) => { const p = inv.transformPoint({ x: px, y: py }); return p.x < R[0] - .5 || p.x > R[2] + .5 || p.y < R[1] - .5 || p.y > R[3] + .5; });
      if (out) rec.露边 = '最远的那层没盖满画面';
    } else if (window.__MEASURE && !rec.露边) {   // 中、近的层：贴边有实色的边，移进画面就露了（量的帧才查，要读像素）
      const m = mat(s0, f), [x0, y0, x1, y1] = [ox, oy, ox + lw, oy + lh], name = ['左', '右', '上', '下'];
      const sides = [[x0, y0, 1, y1 - y0, [x0, y0], [x0, y1]], [x1 - 1, y0, 1, y1 - y0, [x1, y0], [x1, y1]], [x0, y0, x1 - x0, 1, [x0, y0], [x1, y0]], [x0, y1 - 1, x1 - x0, 1, [x0, y1], [x1, y1]]];
      sides.forEach(([sx, sy, sw, sh, a, b], j) => {
        if (rec.露边 || sw < 1 || sh < 1) return;
        const d = g.getImageData(sx - ox, sy - oy, sw, sh).data; let solid = 0;
        for (let q = 3; q < d.length; q += 4) if (d[q] > 200) solid++;
        if (solid < d.length / 4 * .2) return;   // 这条边上没什么东西，移进来也看不出
        const inside = [...Array(9)].some((_, k) => { const p = m.transformPoint({ x: a[0] + (b[0] - a[0]) * k / 8, y: a[1] + (b[1] - a[1]) * k / 8 }); return p.x > 2 && p.x < W - 2 && p.y > 2 && p.y < H - 2; });
        if (inside) rec.露边 = `第 ${i + 1} 层（景深 ${f}）的${name[j]}边移进了画面`;
      });
    }
  });
  window.__CAMREC = rec;
};
})();
