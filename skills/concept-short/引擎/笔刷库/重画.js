// 风格重画：先画一张底稿 canvas，再按某种画法重画一遍（笔触、色点、马赛克、网点、像素、切面），外加油画龟裂纹理。
// 属于笔刷库：片子.json 的 "笔刷库" 里写了 "重画" 才加载。依赖 PAINT（lib/paint.js）。
(() => {
let W = STAGE.W, H = STAGE.H; U.onStage((w, h) => { W = w; H = h; });
const P = window.PAINT;
const { clamp, lerp, rng } = U;

// 龟裂纹（古典油画）：随机游走的细裂线网
P.craquelure = (key, alpha = 0.35) => P.cached('crack_' + key, W, H, (g) => {
  const r = rng(77); g.strokeStyle = `rgba(40,25,10,${alpha})`; g.lineWidth = 0.8;
  for (let k = 0; k < 900; k++) {
    let x = r() * W, y = r() * H, a = r() * Math.PI * 2; g.beginPath(); g.moveTo(x, y);
    for (let s = 0; s < 6 + r() * 10; s++) { a += (r() - .5) * 1.6; x += Math.cos(a) * (6 + r() * 14); y += Math.sin(a) * (6 + r() * 14); g.lineTo(x, y); }
    g.stroke();
  }
});


// ---------- 风格渲染器（对一张底稿 canvas 做「重画」） ----------
// 1) 流场笔触：在抖动网格上取底稿颜色，沿 angle(x,y,t) 画短笔触，带深色描边
//    cap：宽笔（width ≥ 30）密排时圆头会连成一排排鹅卵石，改 'butt'。
//    boil：只给要动的区域沸腾，静止区（地板、道具、角色）boil=0 种子固定——全屏 8fps 换种子读成满屏闪烁。
P.strokes = (dst, src, { cell = 12, len = 22, width = 7, angle, seed = 1, t = 0, boil = 8, outline = 0.35, outlineCol = [20, 25, 60], outlineMix = 0.55, jitterCol = 18, mask, alphaMask = false, palette, cap = 'round' } = {}) => {
  const sd = src.getContext('2d').getImageData(0, 0, W, H).data;
  const r = rng(seed * 1000 + P.boilSeed(t, boil));
  dst.lineCap = cap;
  for (let y = 0; y < H + cell; y += cell) for (let x = 0; x < W + cell; x += cell) {
    const px = x + (r() - .5) * cell, py = y + (r() - .5) * cell;
    const ix = clamp(px | 0, 0, W - 1), iy = clamp(py | 0, 0, H - 1), i = (iy * W + ix) * 4;
    if (mask && !mask(px, py)) continue;
    if (alphaMask && sd[i + 3] < 200) continue;
    let col = [sd[i], sd[i + 1], sd[i + 2]];
    const pc = palette ? palette(px, py, col, r) : null; if (pc) col = pc;       // 区域色板：从色组里抽一个颜色
    const a = angle ? angle(px, py, t) : 0, l = len * (0.7 + r() * 0.6);
    const dx = Math.cos(a) * l / 2, dy = Math.sin(a) * l / 2;
    if (outline > 0) { dst.strokeStyle = P.rgb(P.mix(col, outlineCol, outlineMix), outline); dst.lineWidth = width + 2.5; dst.beginPath(); dst.moveTo(px - dx, py - dy); dst.lineTo(px + dx, py + dy); dst.stroke(); }
    dst.strokeStyle = P.rgb(pc ? col : P.jitter(col, r, jitterCol)); dst.lineWidth = width;
    dst.beginPath(); dst.moveTo(px - dx, py - dy); dst.lineTo(px + dx, py + dy); dst.stroke();
  }
};
// 色组工具：给一组 hex 和权重，返回按随机数抽色的函数（配 strokes 的 palette 用）；mixBase 把底稿色混进来保留明暗
P.swatch = (hexes, mixBase = 0.35) => { const cs = hexes.map(P.hex); return (col, r) => { const k = cs[(r() * cs.length) | 0]; return P.mix(k, col, mixBase); }; };
// 2) 色点：椭圆短点，颜色带冷暖偏移、大小不一。不是点彩（点彩是等大的点＋纯色靠视觉混色）。
P.dabs = (dst, src, { cell = 10, size = 9, seed = 2, t = 0, boil = 8, angle = -0.6, shift = 22 } = {}) => {
  const sd = src.getContext('2d').getImageData(0, 0, W, H).data, r = rng(seed * 1000 + P.boilSeed(t, boil));
  for (let y = 0; y < H + cell; y += cell) for (let x = 0; x < W + cell; x += cell) {
    const px = x + (r() - .5) * cell * 1.2, py = y + (r() - .5) * cell * 1.2;
    const i = (clamp(py | 0, 0, H - 1) * W + clamp(px | 0, 0, W - 1)) * 4;
    const warm = r() < 0.5 ? [shift, shift * 0.5, -shift] : [-shift * 0.6, 0, shift];
    dst.fillStyle = `rgb(${sd[i] + warm[0]},${sd[i + 1] + warm[1]},${sd[i + 2] + warm[2]})`;
    dst.beginPath(); dst.ellipse(px, py, size * (0.8 + r() * 0.6), size * 0.45, angle + (r() - .5) * 0.5, 0, Math.PI * 2); dst.fill();
  }
};
// 3) 马赛克：带缝隙的小石块，颜色取中心，略有抖动与倒角
P.mosaic = (dst, src, { tile = 14, grout = '#3b352e', seed = 3, jitter = 0.25 } = {}) => {
  const sd = src.getContext('2d').getImageData(0, 0, W, H).data, r = rng(seed);
  dst.fillStyle = grout; dst.fillRect(0, 0, W, H);
  for (let y = 0; y < H; y += tile) { const off = (y / tile) % 2 ? tile * 0.5 * jitter : 0; for (let x = -tile; x < W; x += tile) {
    const cx = x + off + tile / 2, cy = y + tile / 2, i = (clamp(cy | 0, 0, H - 1) * W + clamp(cx | 0, 0, W - 1)) * 4;
    const c = P.jitter([sd[i], sd[i + 1], sd[i + 2]], r, 14), s = tile * (0.82 + r() * 0.1);
    dst.fillStyle = P.rgb(c); dst.fillRect(cx - s / 2 + (r() - .5) * 1.5, cy - s / 2 + (r() - .5) * 1.5, s, s);
    dst.fillStyle = 'rgba(255,255,255,.12)'; dst.fillRect(cx - s / 2, cy - s / 2, s, 2);
  } }
};
// 4) 网点（本戴点）：颜色取中心，半径随暗度
P.halftone = (dst, src, { cell = 14, paper = '#f4ecd8', seed = 4 } = {}) => {
  const sd = src.getContext('2d').getImageData(0, 0, W, H).data;
  dst.fillStyle = paper; dst.fillRect(0, 0, W, H);
  for (let y = 0; y < H + cell; y += cell) for (let x = 0; x < W + cell; x += cell) {
    const cx = x + ((y / cell) % 2) * cell / 2, i = (clamp(y | 0, 0, H - 1) * W + clamp(cx | 0, 0, W - 1)) * 4;
    const L = (sd[i] * .3 + sd[i + 1] * .59 + sd[i + 2] * .11) / 255;
    dst.fillStyle = `rgb(${sd[i]},${sd[i + 1]},${sd[i + 2]})`;
    dst.beginPath(); dst.arc(cx, y, cell * 0.72 * (0.3 + (1 - L) * 0.9), 0, Math.PI * 2); dst.fill();
  }
};
// 5) 像素：最近邻降采样，可选调色板量化
P.pixelate = (dst, src, { size = 8, palette } = {}) => {
  const w = Math.ceil(W / size), h = Math.ceil(H / size), s = P.scratch('px'), g = s.getContext('2d');
  g.imageSmoothingEnabled = false; g.clearRect(0, 0, w, h); g.drawImage(src, 0, 0, w, h);
  if (palette) { const pal = palette.map(P.hex), im = g.getImageData(0, 0, w, h), d = im.data;
    for (let i = 0; i < d.length; i += 4) { let best = 0, bd = 1e9; for (let k = 0; k < pal.length; k++) { const q = pal[k], dd = (d[i] - q[0]) ** 2 + (d[i + 1] - q[1]) ** 2 + (d[i + 2] - q[2]) ** 2; if (dd < bd) { bd = dd; best = k; } } d[i] = pal[best][0]; d[i + 1] = pal[best][1]; d[i + 2] = pal[best][2]; }
    g.putImageData(im, 0, 0); }
  dst.imageSmoothingEnabled = false; dst.drawImage(s, 0, 0, w, h, 0, 0, w * size, h * size); dst.imageSmoothingEnabled = true;
};
// 6) 立体主义切面：抖动三角网，每块取「偏移视角」的颜色做线性渐变，描暗边
P.facets = (dst, src, { nx = 22, ny = 13, seed = 5, t = 0, shiftAmt = 26, edge = 'rgba(40,30,20,.45)' } = {}) => {
  const sd = src.getContext('2d').getImageData(0, 0, W, H).data, r = rng(seed);
  const pts = []; for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) { const e = i === 0 || j === 0 || i === nx || j === ny; pts.push([i / nx * W + (e ? 0 : (r() - .5) * W / nx * .9), j / ny * H + (e ? 0 : (r() - .5) * H / ny * .9)]); }
  const col = (x, y) => { const i = (clamp(y | 0, 0, H - 1) * W + clamp(x | 0, 0, W - 1)) * 4; return [sd[i], sd[i + 1], sd[i + 2]]; };
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const a = pts[j * (nx + 1) + i], b = pts[j * (nx + 1) + i + 1], c2 = pts[(j + 1) * (nx + 1) + i], d2 = pts[(j + 1) * (nx + 1) + i + 1];
    for (const tri of (r() < .5 ? [[a, b, d2], [a, d2, c2]] : [[a, b, c2], [b, d2, c2]])) {
      const cx = (tri[0][0] + tri[1][0] + tri[2][0]) / 3, cy = (tri[0][1] + tri[1][1] + tri[2][1]) / 3;
      const sh = Math.sin(t * 3 + cx * 0.01) * shiftAmt * r();
      const c0 = col(cx + sh, cy), c1 = P.mix(c0, [60, 45, 30], 0.35);
      const g = dst.createLinearGradient(tri[0][0], tri[0][1], tri[2][0], tri[2][1]); g.addColorStop(0, P.rgb(P.mix(c0, [255, 250, 235], 0.12))); g.addColorStop(1, P.rgb(c1));
      dst.fillStyle = g; dst.beginPath(); tri.forEach((p, k) => k ? dst.lineTo(p[0], p[1]) : dst.moveTo(p[0], p[1])); dst.closePath(); dst.fill();
      dst.strokeStyle = edge; dst.lineWidth = 1.5; dst.stroke();
    }
  }
};

})();
