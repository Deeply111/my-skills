// 通用工具（最先加载，其余引擎文件都用）
(() => {
// ---------- 工具 ----------
window.U = {
  TAU: Math.PI * 2,
  clamp: (x, a = 0, b = 1) => Math.max(a, Math.min(b, x)),
  lerp: (a, b, p) => a + (b - a) * p,
  // smoothstep：x 在 [a,b] 内平滑地从 0 走到 1（开场写出、渐显、段内节奏都用它）
  ss: (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); },
  // 把 p 的 [a,b] 段线性拉成 0..1（转场里分阶段用）
  seg: (p, a, b) => Math.max(0, Math.min(1, (p - a) / (b - a))),
  // 步进帧率：把连续时间量化成 fps 步——「一顿一顿」是很多风格的味道本身：
  // 橡皮管卡通 12fps（一拍二）、皮影杆操 10fps、跳舞小人 8fps 硬切、手绘线条沸腾 8–12fps、胶片层 24fps。
  stepTime: (t, fps) => Math.floor(t * fps) / fps,
  ease: {
    linear: p => p,
    inOut: p => p < .5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2,
    out: p => 1 - Math.pow(1 - p, 3),
    in: p => p * p * p,
    outBack: p => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2); },
  },
  // 种子随机：mulberry32
  rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; },
  hash(i, j = 0) { let h = (i * 374761393 + j * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; },
  // 点列 → Path2D（折线）
  poly(pts, closed = true) { const p = new Path2D(); pts.forEach((q, i) => i ? p.lineTo(q[0], q[1]) : p.moveTo(q[0], q[1])); if (closed) p.closePath(); return p; },
};

// ---------- 颜色 ----------
// 任何 CSS 颜色（#rgb、#rrggbb、#rrggbbaa、rgb()、rgba()、颜色名……）→ [r, g, b]，透明度不管。交给画布去认，写错的颜色直接报错。
// 渐变、图案这类不是颜色字符串的返回 null。
const _col = document.createElement('canvas').getContext('2d'), _rgb = new Map();
U.rgb = col => {
  if (typeof col !== 'string') return null;
  if (_rgb.has(col)) return _rgb.get(col);
  _col.fillStyle = '#000000'; _col.fillStyle = col; const a = _col.fillStyle;
  _col.fillStyle = '#ffffff'; _col.fillStyle = col; const b = _col.fillStyle;
  if (a !== b) throw new Error(`颜色写错了：「${col}」`);
  const v = a[0] === '#' ? [1, 3, 5].map(i => parseInt(a.slice(i, i + 2), 16)) : a.match(/[\d.]+/g).slice(0, 3).map(Number);
  _rgb.set(col, v); return v;
};

// ---------- 画布尺寸 ----------
// stage.js 启动时按 window.STAGE_INIT 调一次 U.setStage（render.py 从片子.json 的画幅注入：横屏 1920×1080，竖屏 1080×1920）。用到画布尺寸的库（PAINT、KIT、画笔……）用 U.onStage 登记，
// 尺寸一改全部跟着改；登记时立刻按当前尺寸回调一次，后加载的库也拿得到。
const stageHooks = [];
window.STAGE = Object.assign({ W: 1920, H: 1080 }, window.STAGE_INIT || {});   // 默认横屏
// 版式（安全区、字幕字号和默认位置）：render.py 从 脚本/画幅.py 注入 window.LAYOUT，引擎只读不写
window.LAYOUT = window.LAYOUT || null;
U.onStage = f => { stageHooks.push(f); f(window.STAGE.W, window.STAGE.H); };
U.setStage = (w, h) => { w = Math.round(+w); h = Math.round(+h); if (!(w > 0 && h > 0)) throw new Error(`U.setStage：尺寸不对 ${w}×${h}`); window.STAGE = { W: w, H: h }; stageHooks.forEach(f => f(w, h)); };

// ---------- 冻结布局 ----------
// 凡是"先取点（读像素、量字形）再随机"的布局：抗锯齿在显卡和软件模拟下差一两个像素，后面的随机序列就整体错位（《傲慢》标题金线）。
// 第一次跑时把结果存进 代码/冻结/<名>.json（render.py 写），以后只读这份，哪台机器、哪块显卡渲出来都一样。删掉文件就重新算。
//   const pts = U.freeze('标题取点', () => 取点再随机的计算);   返回值要能转 JSON
window.FROZEN = window.FROZEN || {}; window.__FREEZE_NEW = {};
U.freeze = (name, fn) => { if (name in FROZEN) return FROZEN[name]; const v = fn(); FROZEN[name] = window.__FREEZE_NEW[name] = JSON.parse(JSON.stringify(v)); return FROZEN[name]; };

// 查缺字用 MG.hasGlyph（mg.js，直接查字体文件的字形表）。别用 measureText 和回退字体比宽度：缺字时浏览器静默换系统字体，宽度照样对，测不出来。

})();
