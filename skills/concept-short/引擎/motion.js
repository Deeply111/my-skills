// 动作库：按用途命名的动作预设，镜头里一行调用。在 camera.js 之后加载。
// 每种画风在 片子/<片名>/画风/<画风名>/运动.js 里写运动规范，动作预设读它，同一种画风的片子手感统一：
//   STYLES.<画风名>.运动 = { 曲线: { 到场: [.16, 1, .3, 1], ... }, 快慢: 1, 每秒张数: 30, 摄像机效果: ['视差', '惯性'] }
//   曲线 只写要改的那几条；快慢 是所有默认时长的倍数（1.2 = 都慢两成）；每秒张数 12 或 15 就是一顿一顿的画风（stage.js 按它取时间）。
//   片子里几种画风都写了运动规范时（比如第 3 步的候选），每个镜头写 画风: '名'，说用哪一种：SHOT('S1', { 画风: '水墨', final: ... })。
//
// 用法（t 是镜头内的秒数）：
//   const s = 动.到场(lt, 1.2);              → { a 不透明度, dx, dy }：从下方 40 像素处淡入到位
//   const s = 动.退场(lt, 3, { 角度: 0 });   → { a, dx, dy }：往右走掉、淡出
//   const [x, y] = 动.移动(lt, 1, .8, [200, 900], [700, 900], { 预备: .03 });   先往反方向收 3% 再走
//   const k = 动.强调(lt, 2);                → 缩放：1 → 1.06 → 1，不弹
//   const p = 动.揭示(lt, 1, .8);  动.变形(lt, 1, .8)   → 0–1 的进度
//   const s = 动.落地(lt, 1, .5, 300, { 名: '木箱' });   → { dy, sx, sy }：掉下来、着地压扁一下、余震；全片看得见的落地最多两次
//   动.错开(i)  第 i 个晚多少秒；动.跟随(f, lt, 主动作时长)  附属部分在主动作走到 65% 时才跟上
//   动.淡(lt, t0, 时长, 进)  淡入淡出（用平稳曲线：先快后慢的曲线会把一半变化挤在第一帧）
//   动.呼吸(lt)  主体待着时的轻微起伏（缩放）
//   const p = 动.姿势(lt, 2.2, .5, 看光, 回头, { 预备: .03 });   人物换姿势：头先动、手脚晚到晚停，可带预备，不冲过头
// 规矩（参考 cinetic 实测）：冲过头只给真的落地，只是到场的东西不冲过头，字永远不冲过头；预备动作全片一两次。
(() => {
const DEF = {
  曲线: {
    到场: [.16, 1, .3, 1],          // 快到、慢慢停稳
    退场: [.55, .055, .675, .19],    // 慢起、加速离开，接切镜
    碰撞: [.55, 0, .9, .55],         // 越来越快，撞上那一刻最快
    平稳: [.37, 0, .63, 1],          // 淡入淡出、漂、停留
    揭示: [.65, 0, .35, 1],          // 揭示、变形
  },
  快慢: 1, 每秒张数: 30,
};
// 这一镜用哪种画风的运动规范：镜头写了 画风 就用它；没写时，片子里只有一种画风写了运动规范就用那一种，几种都写了就报错（不然会串：
// 第 3 步几种候选放在一条片里时，一种 12 张一秒的画风会让别的候选也一顿一顿）
// 结果按画风缓存（一帧里会调几十次）；画风文件还在陆续加载时 STYLES 会变，所以键里带上已加载的画风数
const specCache = new Map();
const spec = (name = window.__SHOT && (window.SHOTS[window.__SHOT] || {}).画风) => {
  const all = window.STYLES || {}, key = (name || '') + '|' + Object.keys(all).length;
  if (specCache.has(key)) return specCache.get(key);
  let m = null;
  if (name) {
    if (!all[name]) throw new Error(`镜头 ${window.__SHOT} 写的画风「${name}」没加载：片子.json 的"画风"里要列上它`);
    m = all[name].运动 || null;
  } else {
    const ms = Object.entries(all).filter(([, v]) => v && v.运动);
    if (ms.length > 1) throw new Error(`几种画风都写了运动规范（${ms.map(e => e[0]).join('、')}），镜头 ${window.__SHOT || '?'} 要写 画风: '名'，说用哪一种`);
    if (ms.length) m = ms[0][1].运动;
  }
  const r = Object.assign({}, DEF, m || {}); r.曲线 = Object.assign({}, DEF.曲线, m && m.曲线);
  specCache.set(key, r); return r;
};
window.MOTION_SPEC = spec;
const { clamp } = U;
// 曲线：运动规范里的名字（到场、退场……，值是四个数的贝塞尔或 GSAP 的曲线名），也可以直接写 GSAP 的曲线名（'power2.inOut'、'back.out(1.4)'、'elastic.out(1, .4)'、'expo.out'）
const easeCache = new Map();
const gs = n => { if (!easeCache.has(n)) { const f = window.gsap && gsap.parseEase(n); if (!f) throw new Error(`没有「${n}」这条曲线（动作库或 GSAP）`); easeCache.set(n, f); } return easeCache.get(n); };
const curve = name => { const c = spec().曲线[name]; if (!c) return gs(name); return typeof c === 'string' ? gs(c) : MG.bezier(...c); };
const dur = d => d * spec().快慢;
const prog = (t, t0, d, name) => curve(name)(clamp((t - t0) / dur(d)));
window.__MOTION = [];   // 这一帧发生的落地、预备动作，给 render.py 数次数
const note = (种类, 名) => __MOTION.push({ 种类, 名: 名 || '' });
window.__MOVES = [];    // 这一帧正在进行的动作（种类、起点、时长）：查"几样东西同时起步、一样快"和"镜头开头已经动到一半"
const live = (种类, t, t0, d) => { if (t >= t0 && t <= t0 + d) __MOVES.push({ 种类, t0: +t0.toFixed(3), d: +d.toFixed(3), t: +t.toFixed(3) }); };

const 动 = window.动 = {};
动.曲线 = curve;
// ---------- GSAP（v4）：业内打磨过的曲线和时间线 ----------
// 动.缓('power3.out')(p) → 0–1 的曲线；CustomEase 可以自定义：CustomEase.create('落定', 'M0,0 C.2,0 .1,1.1 .4,1 .6,.98 1,1')，再 动.缓('落定')
// 动.补(t, t0, 时长, 从, 到, '曲线')：一个值从 从 走到 到（数或数组）；动作本身用 GSAP 的曲线
// 动.时间线(键, 建) → (t) => 物：几段动作排成一条时间线（GSAP timeline），按镜头内时间直接跳到那一刻，读出 物 上的值。
//   const 推纸 = 动.时间线('推纸', (tl, 物) => { 物.x = 0; 物.转 = 0;
//     tl.to(物, { x: 1.2, duration: .8, ease: 'power2.in' }, 2.7).to(物, { 转: 3.1, duration: .8, ease: 'power1.out' }, 2.7); });
//   const s = 推纸(lt);   // s.x、s.转
//   时间线只在第一次用到时建一次（暂停的），每帧 seek 到 lt：同一个 lt 永远得到同一组值（纯函数）。
动.缓 = gs;
动.补 = (t, t0, d, 从, 到, 名 = 'power2.inOut') => { const p = gs(名)(clamp((t - t0) / dur(d))); return Array.isArray(从) ? 从.map((v, i) => v + (到[i] - v) * p) : 从 + (到 - 从) * p; };
const TLS = new Map();
动.时间线 = (键, 建) => {
  if (!TLS.has(键)) { const 物 = {}, tl = gsap.timeline({ paused: true }); 建(tl, 物); TLS.set(键, { tl, 物, 初: Object.assign({}, 物) }); }
  const T = TLS.get(键);
  return t => { T.tl.seek(Math.max(0, t), true); return Object.assign({}, T.物); };   // suppressEvents：跳着走，不触发回调
};
动.淡 = (t, t0, d = .4, 进 = true) => { const p = prog(t, t0, d, '平稳'); return 进 ? p : 1 - p; };
const dir = (角度, 距离) => [Math.cos(角度 * Math.PI / 180) * 距离, Math.sin(角度 * Math.PI / 180) * 距离];
// 到场：从 角度 方向（度，90 = 从下方）距离 像素处移到原位，同时淡入；不冲过头
动.到场 = (t, t0, { 时长 = .5, 距离 = 40, 角度 = 90, 淡 = true } = {}) => {
  const p = prog(t, t0, 时长, '到场'), [ox, oy] = dir(角度, 距离); live('到场', t, t0, dur(时长));
  return { a: 淡 ? 动.淡(t, t0, 时长 * .8) : 1, dx: ox * (1 - p), dy: oy * (1 - p) };
};
// 退场：往 角度 方向走 距离 像素，同时淡出
动.退场 = (t, t0, { 时长 = .35, 距离 = 40, 角度 = 90, 淡 = true } = {}) => {
  const p = prog(t, t0, 时长, '退场'), [ox, oy] = dir(角度, 距离); live('退场', t, t0, dur(时长));
  return { a: 淡 ? 动.淡(t, t0 + 时长 * .2, 时长 * .8, false) : 1, dx: ox * p, dy: oy * p };
};
// 移动：从 从 到 到；预备 = 先往反方向收的比例（.02–.04），在出发前 0.13 秒内收完
动.移动 = (t, t0, d, 从, 到, { 曲线 = '到场', 预备 = 0, 名 } = {}) => {
  const dx = 到[0] - 从[0], dy = 到[1] - 从[1];
  const A = [从[0] - dx * 预备, 从[1] - dy * 预备];   // 预备收到的位置；没有预备时就是起点
  if (预备 && t <= t0 - .13) return 从.slice();
  if (预备 && t < t0) { note('预备', 名); const q = curve('平稳')((t - (t0 - .13)) / .13); return [从[0] + (A[0] - 从[0]) * q, 从[1] + (A[1] - 从[1]) * q]; }
  live('移动', t, t0, dur(d)); const p = prog(t, t0, d, 曲线); return [A[0] + (到[0] - A[0]) * p, A[1] + (到[1] - A[1]) * p];
};
// 强调：轻轻放大再回来，不弹
动.强调 = (t, t0, { 时长 = .5, 幅度 = .06 } = {}) => { const q = clamp((t - t0) / dur(时长)); return 1 + 幅度 * Math.sin(Math.PI * curve('平稳')(q)); };
动.揭示 = (t, t0, d = .8) => (live('揭示', t, t0, dur(d)), prog(t, t0, d, '揭示'));
动.变形 = (t, t0, d = .8) => (live('变形', t, t0, dur(d)), prog(t, t0, d, '揭示'));
// 落地：从 高度 像素上方掉下来（碰撞曲线，越来越快），着地压扁（宽 +8%、高 −10%）再余震收住。全片看得见的落地最多两次
动.落地 = (t, t0, d, 高度, { 名 } = {}) => {
  const hit = t0 + dur(d);
  if (t < hit) return { dy: -高度 * (1 - prog(t, t0, d, '碰撞')), sx: 1, sy: 1 };
  note('落地', 名 || `${hit.toFixed(2)} 秒`);   // 没写名字按落地的时刻区分，同一镜几次落地不会只算一次
  const f = (t - hit) * 60, q = f < 1 ? f : Math.max(0, 1 - (f - 1) / 4), settle = 1 - Math.exp(-f / 4) * Math.sin(f / 1.6) * .035;
  return { dy: 0, sx: (1 + .08 * q) * (2 - settle), sy: (1 - .10 * q) * settle };
};
// 姿势：主体（人物）从姿势 从 换到姿势 到，t0 起、时长 d。姿势是主体骨架认的那种对象（数、数组、嵌套的表情都插值，别的在一半时切）。
// 自带两样：① 先后——默认头先动（face、look、tilt、expr），身子晚 15%（lean、x、y、h、toe），手脚晚 30%（aF、aB、lF、lB），
// 晚到的部分也晚停，就是跟随和重叠；先后: '身先' 反过来（推、拽这类由身子带的动作），false 全身一起，或 { 键: 晚几秒 } 逐个指定。
// ② 预备——预备: .03 先往反方向收 3%，在出发前 0.13 秒内收完（规矩同 动.移动：2–4%，少用）。到位不冲过头。
//   const p = 动.姿势(lt, 2.2, .5, 看光, 回头);   RIG.solve(RIG.pose({ ...p, x, y, h }))
const PART = { face: 0, look: 0, tilt: 0, expr: 0, lean: .15, x: .15, y: .15, h: .15, toe: .15, aF: .3, aB: .3, lF: .3, lB: .3 };
const mixV = (a, b, p) => typeof a === 'number' && typeof b === 'number' ? a + (b - a) * p
  : Array.isArray(a) && Array.isArray(b) ? a.map((v, i) => mixV(v, b[i], p))
  : a && b && typeof a === 'object' && typeof b === 'object' ? Object.fromEntries([...new Set([...Object.keys(a), ...Object.keys(b)])].map(k => [k, mixV(a[k] ?? b[k], b[k] ?? a[k], p)]))
  : (p < .5 ? a : b);
动.姿势 = (t, t0, d, 从, 到, { 曲线 = '平稳', 先后 = '头先', 预备 = 0, 名 } = {}) => {
  const D = dur(d), keys = [...new Set([...Object.keys(从), ...Object.keys(到)])];
  const late = k => 先后 && typeof 先后 === 'object' ? (先后[k] || 0) : !先后 ? 0 : (先后 === '身先' ? .3 - (PART[k] ?? .15) : (PART[k] ?? .15)) * D;
  if (预备 && t > t0 - .13 && t < t0) note('预备', 名);
  live('姿势', t, t0, D * 1.3);
  return Object.fromEntries(keys.map(k => { const a = 从[k] ?? 到[k], b = 到[k] ?? 从[k], s = t0 + late(k);
    const p = t < s ? (预备 ? -预备 * curve('平稳')(clamp((t - (s - .13)) / .13)) : 0) : -预备 + (1 + 预备) * curve(曲线)(clamp((t - s) / D));   // 从预备收到的位置出发，不跳
    return [k, mixV(a, b, p)]; }));
};
动.错开 = (i, 利落 = false) => i * (利落 ? .1 : .18) * spec().快慢;
动.跟随 = (f, t, 主动作时长, 比例 = .65) => f(t - 比例 * dur(主动作时长));
动.呼吸 = (t, { 周期 = 3.5, 幅度 = .012 } = {}) => 1 + 幅度 * Math.sin(t / 周期 * Math.PI * 2);
// 起跳（出自《傲慢》上台阶）：蹲（前 18%）→ 腾空走弧线、身子拉长一点 → 落地一沉（后 18%）。返回 { x, y 位置, sx, sy 缩放, 落 落地那一刻的 0–1 冲击 }
//   const j = 动.跳(lt, .5, .62, [x0, y0], [x1, y1], { 高: 40 });   y 往下为正（画面坐标）；3D 里把 y 取反着用
//   落地的声音对在 t0 + d * .82（落地那一刻），起跳前要长出来的东西（台阶）在 t0 - .16 开始长
动.跳 = (t, t0, d, 从, 到, { 高 = 40, 蹲 = .05, 拉 = .02, 名 } = {}) => {
  const D = dur(d), ph = clamp((t - t0) / D); live('跳', t, t0, D);
  const q = U.ease.inOut(clamp((ph - .18) / .64));
  const x = 从[0] + (到[0] - 从[0]) * q, y = 从[1] + (到[1] - 从[1]) * q - Math.sin(q * Math.PI) * 高;
  const k = ph < .18 ? Math.sin(ph / .18 * Math.PI) * 蹲 : ph > .82 ? Math.sin((ph - .82) / .18 * Math.PI) * 蹲 * .8 : -拉 * Math.sin(q * Math.PI);
  if (名 && ph > .82) note('落地', 名);
  return { x, y, sx: 1 + k * .5, sy: 1 - k, 落: ph > .82 ? Math.sin((ph - .82) / .18 * Math.PI) : 0 };
};
})();
