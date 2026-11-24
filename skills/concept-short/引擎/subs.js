// 字幕层和画里的字。在 stage.js 之后加载。
// 字幕：render.py 从 画面卡.md 和 代码/时间轴.json 读出来注入 window.SUBS，镜头代码里不写字幕的字。
//   SUBS = [{ 卡, 行: ['不是不懂', '是【没做】'], 种类: '普通'|'问句'|'心里话'|'引文', from, to }]
//   【词】是强调词，染强调色、加粗一档；【词|名】用颜色含义表 MEANING 里「名」那种颜色。引文里以「——」开头的行是出处。
//   位置写在镜头文件里：SHOT('A1', { 字幕: { y: .62 }, board: ... })
//     x、y 是字幕块中心在画面宽、高上的比例（默认 x .5、y .73，底部安全区之上）；对齐 'center'|'left'|'right'；色 字的颜色；字号 覆盖默认字号。
//     贴着画里的东西走就写成函数：字幕: (lt, x) => ({ y: .4 + lt * .01 })，参数同镜头；每帧移动不超过 6 像素。
//     不想自己定位置就写 字幕: '自动'（或 { 自动: true, x: .3, 对齐: 'left' }，y 不用写）：引擎在安全区里挑最空的地方，躲开主体（见下面"自动找空处"）。
//   字幕画在镜头之上，不受摄像机影响。出场 0.3 秒（淡入、上移 16 像素，先快后慢），退场 0.2 秒；换镜头时位置跟着换。
//   默认颜色写在 代码/色板.js：window.SUB_STYLE = { 字, 强调, 心里话 }，镜头里的 色 优先。
//   字幕默认带一层贴着字的阴影：浅字配深影、深字配浅影，浅字的影是黑 95%，模糊约字号的 0.2、往下偏 0.05。要改写 SUB_STYLE.阴影 = { 色, 模糊, 偏移 }（模糊、偏移是字号的倍数）；不要阴影写 阴影: false。
//   对比度检查照旧只量字和背后画面，不把阴影算进去：阴影是保险，不是把字放进乱处的理由。
// 字进世界时句子的其余部分用 TEXT.说，样子和字幕一样，观众知道还是同一个声音。
// 画里的字、关键字：在镜头里用 TEXT.draw 画，或者自己画好后用 TEXT.mark 登记位置，检查程序才看得见它（读字时间、安全区、对比度）。
//   只是氛围用、观众不必读的字直接画，不用登记。
(() => {
const { W, H } = STAGE, L = window.LAYOUT, IN = 0.3, OUT = 0.2, RISE = 16, MAXW = W * L.字幕.宽, SAFE = L.安全, MINSZ = L.最小字号;   // 版式按画幅（脚本/画幅.py）
const { clamp } = U;
window.SUBS = window.SUBS || [];
window.__TEXTS = [];   // 这一帧画了哪些要读的字，给 render.py 检查用

// SUB_STYLE 里还可以写（默认都不开，旧片子不变）：字距 每个字之间多空几像素（《傲慢》横屏 1080p 用 4）；句间留白 前后两条字幕首尾相接时，后一条晚多少秒出来（0.16）；
//   出处: '署名' 引文里「——」开头的出处行改成小号斜体、字距更开、偏暗，主句出齐后再淡入
const style = () => Object.assign({ 字: '#f3eee6', 强调: '#f0c27a', 心里话: '#cfc8bc' }, window.SUB_STYLE || {});
const subShadow = (c, st, col, size) => { if (st.阴影 === false) return;
  const sh = Object.assign({ 色: (lum(col) ?? 1) > .4 ? 'rgba(0,0,0,.95)' : 'rgba(255,255,255,.55)', 模糊: .2, 偏移: .05 }, st.阴影 || {});
  c.shadowColor = sh.色; c.shadowBlur = sh.模糊 * size; c.shadowOffsetX = 0; c.shadowOffsetY = sh.偏移 * size; };
const KIND = L.字号;   // 字号、字重，按画幅（竖屏 普通 58/600、问句 70/700、心里话 58/400、引文 50/400；横屏见 脚本/画幅.py）

// 一行拆成小段：[{ t, em, col }]
const runs = (line, emCol) => {
  const out = [], re = /【([^】|]*)(?:\|([^】]*))?】/g; let i = 0, m;
  while ((m = re.exec(line))) {
    if (m.index > i) out.push({ t: line.slice(i, m.index) });
    const mean = m[2] && (window.MEANING || {})[m[2]];
    if (m[2] && !mean) console.error(`强调色「${m[2]}」不在颜色含义表里：代码/色板.js`);
    out.push({ t: m[1], em: true, col: mean ? mean[0] : emCol });
    i = re.lastIndex;
  }
  if (i < line.length) out.push({ t: line.slice(i) });
  return out;
};
window.SUB_PLAIN = s => s.行.join('').replace(/【([^】|]*)(?:\|[^】]*)?】/g, '$1');

// 屏幕上的一块区域：量背后画面的亮度，算和字的颜色的对比度（WCAG），取字背后最不利的那 10%
const lum = col => { const v = U.rgb(col), f = v => (v /= 255) <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4;
  return v && .2126 * f(v[0]) + .7152 * f(v[1]) + .0722 * f(v[2]); };   // 不是颜色字符串（渐变、图案）返回 null，不量对比度
const contrast = (c, box, col) => {
  if (U.rgb(col) === null) return null;
  const x0 = Math.max(0, box[0] | 0), y0 = Math.max(0, box[1] | 0), x1 = Math.min(W, Math.ceil(box[2])), y1 = Math.min(H, Math.ceil(box[3]));
  if (x1 - x0 < 2 || y1 - y0 < 2) return null;
  const d = c.getImageData(x0, y0, x1 - x0, y1 - y0).data, L = [], f = v => (v /= 255) <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4;
  for (let i = 0; i < d.length; i += 16) L.push(.2126 * f(d[i]) + .7152 * f(d[i + 1]) + .0722 * f(d[i + 2]));
  L.sort((a, b) => a - b);
  const lt = lum(col), bg = lt > L[L.length >> 1] ? L[Math.floor(L.length * .9)] : L[Math.floor(L.length * .1)];
  return (Math.max(lt, bg) + .05) / (Math.min(lt, bg) + .05);
};

// ---------- 处理：每句字幕怎么出来 ----------
// 卡里的"字幕处理："写处理的名字（意群、逐字、重读、揭示），不写就是普通：整句淡入、上移 16 像素。种类（问句、心里话、引文）管字多大多粗，处理管怎么出来，可以一起写。
//   普通  整句一起出来，0.3 秒                                       大多数叙述句
//   意群  按词组一块一块出来（BudouX 切词组，换行处也算一块），块与块错开 0.16 秒，一句的错开加起来最多 0.5 秒    长一点的句子，像被"念"出来
//   逐字  一个字一个字出来，错开 0.05 秒，加起来最多 0.6 秒              两三个字的短词、概念；长句别用，读着累
//   重读  整句先出来，【强调词】晚 0.12 秒、用 0.4 秒单独出来（淡入、从 0.9 倍放到 1 倍，不冲过头：字永远不冲过头）   一句话里有一个词要砸下去；没有【】就和普通一样
//   揭示  从左往右擦出来，0.45 秒                                     要留悬念的句子
//   浮现  一个字一个字由虚变清、往上浮 7 像素，错开 0.024 秒，每个字 0.5 秒；退场 0.38 秒平滑淡出   整句叙述（《傲慢》的字幕）；比逐字柔，长句也不累
// 退场：浮现 0.38 秒平滑淡出，其余都是 0.2 秒淡出。出场用的时间读字下限要算进去（检查会按每条的处理算）：字数 ÷ 6 + 出场 + 退场。
// 每种的时间可以在 代码/色板.js 里改：window.SUB_TREAT = { 意群: { stagger: .2 }, 重读: { accent: { delay: .2, dur: .4 } } }。
const TREAT = {
  普通: { in: IN },
  意群: { in: .28, unit: '意群', stagger: .16, span: .5 },
  逐字: { in: .22, unit: '字', stagger: .05, span: .6 },
  重读: { in: IN, accent: { delay: .12, dur: .4 } },
  揭示: { in: .45, wipe: true },
  浮现: { in: .5, unit: '字', stagger: .024, span: .9, blur: 3.2, rise: 7, out: .38, smoothOut: true },
};
const treatName = s => TREAT[s.处理] ? s.处理 : '普通';
const treatOf = s => Object.assign({}, TREAT[treatName(s)], (window.SUB_TREAT || {})[treatName(s)]);
// 一行里的一段字拆成要单独动的小块：拉丁字母和数字连成一块，其余一字一块
const tokenize = text => {
  const out = []; let i = 0;
  while (i < text.length) {
    if (/[A-Za-z0-9]/.test(text[i])) { let j = i; while (j < text.length && /[A-Za-z0-9.%+'-]/.test(text[j])) j++; out.push(text.slice(i, j)); i = j; continue; }
    const n = text.codePointAt(i) > 0xffff ? 2 : 1; out.push(text.slice(i, i + n)); i += n;
  }
  return out;
};
// 这条字幕怎么出来：每个小块属于第几个单位（u[行][第几块]）、几个单位、单位之间错开多久、全部出完要多久（tin）。只看文字，不看画布，算一次缓存
const plan = s => {
  if (s._plan) return s._plan;
  const T = treatOf(s), cuts = new Set(window.BUDOUX ? BUDOUX.parseBoundaries(SUB_PLAIN(s)) : []);
  let off = 0, hasEm = false; const starts = new Set(), rows = [];
  s.行.forEach((src, li) => {
    if (li > 0) starts.add(off);
    const row = [];
    runs(src, '#000').forEach(r => tokenize(r.t).forEach(tk => { row.push({ gi: off, sp: /^\s$/.test(tk) }); off += tk.length; if (r.em) hasEm = true; }));
    rows.push(row);
  });
  const bounds = [...new Set([...cuts, ...starts])].sort((a, b) => a - b); let k = 0;
  const u = rows.map(row => row.map(tk => T.unit === '意群' ? bounds.filter(b => b <= tk.gi).length : T.unit === '字' ? (tk.sp ? Math.max(0, k - 1) : k++) : 0));
  const units = Math.max(0, ...u.flat()) + 1, stag = units > 1 ? Math.min(T.stagger || 0, (T.span ?? Infinity) / (units - 1)) : 0, acc = !!T.accent && hasEm;
  const st = style(), sign = st.出处 === '署名' && s.种类 === '引文' && s.行.some(l => l.startsWith('——'));
  const main = T.in + stag * (units - 1) + (acc ? T.accent.delay + T.accent.dur : 0), tin = main + (sign ? .85 : 0);   // 署名在主句出齐 0.25 秒后用 0.6 秒淡入
  const prev = SUBS.some(q => q !== s && Math.abs(q.to - s.from) < 1e-3), delay = prev ? (st.句间留白 || 0) : 0;
  return s._plan = { name: treatName(s), T, u, units, stag, acc, hasEm, tin, main, sign, delay, out: T.out || OUT, rise: T.rise ?? RISE, simple: units === 1 && !acc && !T.wipe && !T.blur };
};
window.SUBPLAN = s => { const p = plan(s); return { 处理: p.name, 进: +(p.tin + p.delay + p.out - OUT).toFixed(3), 单位: p.units, 有强调: p.hasEm }; };   // 给 render.py 的读字检查用

// 当前时刻的字幕
const activeSub = t => SUBS.findIndex(s => t >= s.from && t < s.to);
// 分镜版一顿一顿时，字幕动着的帧不能复用上一帧：render.py 把它拼进复用的判断里
window.SUBKEY = (t, id) => {
  const i = activeSub(t); if (i < 0) return '';
  const s = SUBS[i], o = (SHOTS[id] || {}).字幕;
  const P = plan(s); return typeof o === 'function' || t < s.from + P.delay + P.tin || t > s.to - P.out ? `${i}@${t}` : `${i}`;
};

// ---------- 自动找空处、躲开画面主体 ----------
// 镜头写 字幕: '自动'：引擎在这一镜字幕清楚显示的那一段里，每隔约 0.25 秒（最少 3 帧、最多 9 帧）各在另一块画布上把这一镜画一遍
// （带质感、不带字幕），缩小读像素，在安全区里五个高度（下、中下、上、中上、中）挑最空的一个：背景起伏小、和整体底色一样亮、
// 不压镜头报告的主体、不进右侧按钮列。整段都尽量空，所以主体在这一镜里走动也躲得开；主体扫过整个安全区时没有哪里全程都空，
// 只能挑压得最少的，检查会提醒。每个（字幕、镜头）只定一次，位置不会跳；一样空的时候靠下的优先。
// regions: (lt, x) => ({ 主体: [左, 上, 右, 下] })：镜头报告主体在屏幕上的位置（镜头运动以后的）。平涂的、和背景同样亮的主体靠亮度看不出来，
// 只有它报了才躲得开；位置写死的字压到了（四周留 24 像素），检查提醒。
const PAD = 36, MARGIN = 24, SLOTS = ['下', '中下', '上', '中上', '中'], SLOT_AT = { 下: 1, 中下: .75, 上: 0, 中上: .25, 中: .5 }, SMALL = 4;
const regionsAt = (id, lt, x) => {
  const f = (SHOTS[id] || {}).regions; if (!f) return [];
  return Object.entries(f(lt, x) || {}).map(([名, r]) => ({ 名, x0: r[0], y0: r[1], x1: r[2], y1: r[3] }));
};
const overlap = (box, regs) => {   // 字框被主体（四周各留 MARGIN）盖住的面积占字框的比例，以及压到了哪些
  const [x0, y0, x1, y1] = box; let sum = 0; const hit = [];
  for (const g of regs) {
    const w = Math.min(x1, g.x1 + MARGIN) - Math.max(x0, g.x0 - MARGIN), h = Math.min(y1, g.y1 + MARGIN) - Math.max(y0, g.y0 - MARGIN);
    if (w > 0 && h > 0) { sum += w * h; hit.push(g.名); }
  }
  return { ratio: Math.min(1, sum / Math.max(1, (x1 - x0) * (y1 - y0))), hit };
};
const pixY = (r, g, b) => .2126729 * (r / 255) ** 2.4 + .7151522 * (g / 255) ** 2.4 + .072175 * (b / 255) ** 2.4;
const areaStats = (img, x, y, w, h) => {   // 全片坐标的一块区域：亮度中位数、起伏（越乱越大）
  const sw = img.width, sh = img.height, x0 = clamp(Math.round(x / SMALL), 0, sw - 1), y0 = clamp(Math.round(y / SMALL), 0, sh - 1),
    x1 = clamp(Math.round((x + w) / SMALL), x0 + 1, sw), y1 = clamp(Math.round((y + h) / SMALL), y0 + 1, sh), d = img.data, ys = [];
  let grad = 0, n = 0;
  for (let j = y0; j < y1; j++) for (let i = x0; i < x1; i++) {
    const p = (j * sw + i) * 4, v = pixY(d[p], d[p + 1], d[p + 2]); ys.push(v);
    if (i + 1 < x1) { grad += Math.abs(v - pixY(d[p + 4], d[p + 5], d[p + 6])); n++; }
  }
  const mean = ys.reduce((a, b) => a + b, 0) / ys.length, sd = Math.sqrt(ys.reduce((a, b) => a + (b - mean) ** 2, 0) / ys.length);
  ys.sort((a, b) => a - b);
  return { 中位: ys[ys.length >> 1], 乱: sd + 2 * grad / Math.max(1, n) };
};
// 这一镜在全片 ti 秒的样子（不带字幕）缩小以后的像素。用 __PROBE 告诉 stage.js 这是试画：不画字幕、标注、参考线，不动 __diff 记的上一帧；
// 试画会重置的那些逐帧记录（摄像机、动作、数值检查……）事后原样放回，不污染真正这一帧的检查。
let _P = null, _S = null;
const probe = (id, ti, want) => {
  const sh = TIMELINE.find(q => q.id === id), lt = ti - sh.from, d = sh.to - sh.from;
  _P = _P || Object.assign(document.createElement('canvas'), { width: W, height: H }).getContext('2d');
  _S = _S || Object.assign(document.createElement('canvas'), { width: W / SMALL, height: H / SMALL }).getContext('2d', { willReadFrequently: true });
  const keep = ['__TEXTS', '__CAMREC', '__SHOT', '__MOTION', '__MOVES', '__FINISHREC', '__NANREC', '__DIFFV', '__MEASURE', '__PROBE'].map(k => [k, window[k]]);
  window.__PROBE = true; window.__MEASURE = false;
  try { drawShot(_P, id, lt, want, d); } finally { keep.forEach(([k, v]) => { window[k] = v; }); }
  _S.drawImage(_P.canvas, 0, 0, W / SMALL, H / SMALL);
  return { img: _S.getImageData(0, 0, W / SMALL, H / SMALL), lt, d };
};
const autoCache = {};
// 返回字幕块中心在画面高度上的比例；x0、x1 是字幕块的左右边，bh 是块高
const autoY = (i, s, id, want, x0, x1, bh) => {
  const key = [i, id, want || '', Math.round(x0), Math.round(bh)].join('|');
  if (autoCache[key] !== undefined) return autoCache[key];
  const sh = TIMELINE.find(q => q.id === id), a = Math.max(s.from, sh.from) + plan(s).delay + plan(s).tin, b = Math.min(s.to, sh.to) - plan(s).out - .02;
  const lo = Math.min(a, b), hi = Math.max(a, b), n = clamp(Math.ceil((hi - lo) / .25) + 1, 3, 9);   // 这一镜里字清楚显示的这一段，每隔约 0.25 秒试画一帧（最少 3 帧、最多 9 帧）
  const moments = Array.from({ length: n }, (_, k) => lo + (hi - lo) * k / (n - 1));
  const yTop = H * SAFE.上 + PAD, yBot = H * SAFE.下 - PAD, cand = SLOTS.map(n => ({ n, top: yTop + SLOT_AT[n] * Math.max(0, yBot - yTop - bh) })), sum = {}, worst = {};
  for (const ti of moments) {
    const P = probe(id, ti, want), regs = regionsAt(id, P.lt, { W, H, d: P.d, p: P.d ? clamp(P.lt / P.d) : 0, lt: P.lt, 机: SHOTS[id].机 });
    const base = areaStats(P.img, 0, yTop, W, yBot - yTop).中位 ** (1 / 3);
    for (const c of cand) {
      const box = [x0, c.top, x1, c.top + bh], q = areaStats(P.img, x0, c.top, x1 - x0, bh);
      const B = SAFE.按钮列, btn = B && x1 > W * B[0] + 1 && box[3] > H * B[1] && box[1] < H * B[2] ? 50 : 0;   // 字块伸进右侧按钮列的高度：不行
      const v = q.乱 + 1.5 * Math.abs(q.中位 ** (1 / 3) - base) + 20 * overlap(box, regs).ratio + btn;   // 压到主体：一点点也比任何底色差异都重
      sum[c.n] = (sum[c.n] || 0) + v; worst[c.n] = Math.max(worst[c.n] || 0, v);
    }
  }
  let best = null;   // 平均压得少，最坏的一刻也别太糟；主体扫过整个安全区时没有哪里全程都空，只能挑压得最少的（检查会提醒）
  for (const c of cand) { const sc = sum[c.n] / moments.length + .5 * worst[c.n]; if (!best || sc < best.sc - 1e-6) best = { sc, top: c.top }; }
  return autoCache[key] = (best.top + bh / 2) / H;
};

window.drawSubs = (c, t, id, lt, x, want) => {
  const i = activeSub(t); if (i < 0) return;
  const raw = (SHOTS[id] || {}).字幕, auto = raw === '自动' || !!(raw && typeof raw === 'object' && raw.自动);
  const s = SUBS[i], st = style(), o = Object.assign({ x: L.字幕.x, y: L.字幕.y, 对齐: 'center' }, typeof raw === 'function' ? raw(lt, x) : raw && typeof raw === 'object' ? raw : {});
  const [base, wt] = KIND[s.种类] || KIND.普通, col = o.色 || (s.种类 === '心里话' ? st.心里话 : st.字);
  const P = plan(s), T = P.T, tl = t - s.from - P.delay, a = clamp(tl / P.tin), e = 1 - (1 - a) ** 3, ou = clamp((s.to - t) / P.out), outA = T.smoothOut ? ou * ou * (3 - 2 * ou) : ou, alpha = e * outA, 稳 = a >= 1 && t <= s.to - P.out;
  if (tl < 0) return;   // 句间留白：前一条刚退，这一条还没出来
  c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.textBaseline = 'middle'; c.letterSpacing = `${st.字距 || 0}px`;   // 字距算进 measureText，排版和居中都照常
  // 一行一行排：字号按最宽的一行缩，不小于最小字号（竖屏 52、横屏 46；引文本来就小，不缩）
  let size = o.字号 || base;
  const lines = s.行.map(l => ({ src: l, quote: s.种类 === '引文' && l.startsWith('——') }));
  const fontOf = (ln, r, sz) => P.sign && ln.quote ? `italic 400 ${Math.round(sz * .42)}px Song` : `${r.em ? Math.min(900, wt + 200) : wt} ${ln.quote ? Math.round(sz * .8) : sz}px Song`;
  const widthOf = (ln, sz) => runs(ln.src, st.强调).reduce((w, r) => (c.font = fontOf(ln, r, sz), w + c.measureText(r.t).width), 0);
  while (size > Math.min(MINSZ, base) && Math.max(...lines.map(l => widthOf(l, size))) > MAXW) size -= 2;
  const lh = size * 1.45, blockH = lh * lines.length, cx = o.x * W, bw = Math.max(...lines.map(l => widthOf(l, size)));
  subShadow(c, st, col, size);   // 贴着字的阴影，跟着字的透明度一起淡入淡出
  if (auto) { const ax0 = o.对齐 === 'left' ? cx : o.对齐 === 'right' ? cx - bw : cx - bw / 2; o.y = autoY(i, s, id, want, ax0, ax0 + bw, blockH); }
  const top = o.y * H - blockH / 2;   // 出场的上移按小块各自算（普通处理就是整块一起上移，和以前一样）
  let bx0 = W, bx1 = 0;
  lines.forEach((ln, k) => {
    const w = widthOf(ln, size);
    ln.px = o.对齐 === 'left' ? cx : o.对齐 === 'right' ? cx - w : cx - w / 2; ln.y = top + lh * (k + .5);
    bx0 = Math.min(bx0, ln.px); bx1 = Math.max(bx1, ln.px + w);
  });
  const box = [bx0, top, bx1, top + blockH];
  const rec = { 种类: '字幕', 名: `卡 ${s.卡}`, 字: SUB_PLAIN(s), box, 稳, y: o.y * H };
  const cover = overlap(box, regionsAt(id, lt, x)).hit; if (cover.length) rec.压主体 = cover;   // 压到镜头报告的主体：检查提醒
  if (window.__MEASURE && 稳) rec.对比 = contrast(c, box, col);
  // 画：整块一起出来（普通，和以前一样），或者按小块各演各的（意群、逐字、重读、揭示）
  const unitE = u => { const au = clamp((tl - u * P.stag) / T.in); return T.blur ? au * au * (3 - 2 * au) : 1 - (1 - au) ** 3; };
  if (T.wipe) {   // 揭示：从左往右擦出来
    const aw = clamp(tl / T.in), ew = aw < .5 ? 4 * aw ** 3 : 1 - (-2 * aw + 2) ** 3 / 2;
    c.beginPath(); c.rect(bx0 - 24, top - size, (bx1 - bx0 + 48) * ew, blockH + size * 2); c.clip();
  }
  lines.forEach((ln, k) => {
    let px = ln.px, ti = 0;
    runs(ln.src, st.强调).forEach(r => {
      c.font = fontOf(ln, r, size); c.fillStyle = r.em ? r.col : col;
      if (P.sign && ln.quote) {   // 署名：主句出齐后淡入，偏暗，字距更开
        const su = clamp((tl - P.main - .25) / .6), se = su * su * (3 - 2 * su); c.save(); c.letterSpacing = `${(st.字距 || 0) + 4}px`; c.globalAlpha = se * outA * .62;
        c.fillText(r.t, px, ln.y + (1 - se) * 4); px += c.measureText(r.t).width; c.restore(); return; }
      if (P.simple) { c.globalAlpha = alpha; c.fillText(r.t, px, ln.y + (1 - e) * RISE); px += c.measureText(r.t).width; return; }
      for (const tk of tokenize(r.t)) {
        const w = c.measureText(tk).width, ue = unitE(P.u[k][ti++]);
        let al = ue, dy = (1 - ue) * P.rise, sc = 1;
        if (T.wipe) { al = 1; dy = 0; }
        else if (r.em && P.acc) {   // 重读：强调词晚一拍单独出来，不冲过头
          const ee = 1 - (1 - clamp((tl - T.in - T.accent.delay) / T.accent.dur)) ** 3; al = ee; dy = (1 - ee) * RISE * .5; sc = .9 + .1 * ee;
        }
        c.globalAlpha = al * outA;
        if (c.globalAlpha > .003) {
          if (T.blur) c.filter = ue < 1 ? `blur(${((1 - ue) * T.blur).toFixed(2)}px)` : 'none';   // 浮现：由虚变清
          if (sc === 1) c.fillText(tk, px, ln.y + dy);
          else { c.save(); c.translate(px + w / 2, ln.y + dy); c.scale(sc, sc); c.textAlign = 'center'; c.fillText(tk, 0, 0); c.restore(); }
        }
        px += w;
      }
    });
  });
  c.filter = 'none'; c.restore();
  __TEXTS.push(rec);
};

// 画里的字：按镜头当前的变换画（跟着摄像机和所在的层走），并把它在屏幕上的位置记下来
const screenBox = (c, x0, y0, x1, y1) => {
  const m = c.getTransform(), P = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]].map(([x, y]) => [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f]);
  return [Math.min(...P.map(p => p[0])), Math.min(...P.map(p => p[1])), Math.max(...P.map(p => p[0])), Math.max(...P.map(p => p[1]))];
};
window.TEXT = {
  // TEXT.说(c, '但这些都是', x, y, { 字号, 色, 对齐, 淡, 名 })：字进世界时，句子的其余部分。字体、字重、字距、阴影都和字幕一样，默认用普通字幕的字号
  说(c, 字, x, y, o = {}) {
    const st = style(), [sz, wt] = KIND.普通, 号 = o.字号 || sz, 色 = o.色 || st.字;
    c.save(); if (o.淡 !== undefined) c.globalAlpha *= o.淡; c.letterSpacing = `${st.字距 || 0}px`; subShadow(c, st, 色, 号);
    TEXT.draw(c, 字, x, y, { 字号: 号, 字重: wt, 色, 对齐: o.对齐, 种类: '关键字', 名: o.名 });
    c.restore();
  },
  // TEXT.draw(c, '知行合一', x, y, { 字号: 160, 字重: 900, 色: '#..', 对齐: 'center', 种类: '关键字'|'画里', 名 })
  draw(c, 字, x, y, o = {}) {
    const sz = o.字号 || 58, al = o.对齐 || 'center';
    c.save(); c.font = `${o.字重 || 600} ${sz}px Song`; c.textAlign = al; c.textBaseline = 'middle'; c.fillStyle = o.色 || style().字;
    const w = c.measureText(字).width, x0 = al === 'left' ? x : al === 'right' ? x - w : x - w / 2;
    const box = screenBox(c, x0, y - sz * .6, x0 + w, y + sz * .6);
    const rec = { 种类: o.种类 || '画里', 名: o.名 || 字, 字, box, 稳: c.globalAlpha >= .95 };
    if (window.__MEASURE && rec.稳) rec.对比 = contrast(c, box, c.fillStyle);
    c.fillText(字, x, y); c.restore();
    __TEXTS.push(rec);
  },
  // 自己画的字（字变形状、笔刷写的字）画完以后登记：box = [x0, y0, x1, y1]，按镜头当前的变换换算到屏幕上。不量对比度。
  mark(c, 字, box, o = {}) {
    __TEXTS.push({ 种类: o.种类 || '关键字', 名: o.名 || 字, 字, box: screenBox(c, ...box), 稳: o.稳 !== undefined ? o.稳 : c.globalAlpha >= .95 });
  },
};

// 字幕里有没有字体缺的字（页面准备好以后调一次）：缺字时浏览器会悄悄换成系统字体，所以算页面报错
window.checkSubGlyphs = () => SUBS.forEach(s => { const miss = [...new Set(SUB_PLAIN(s))].filter(ch => !/\s/.test(ch) && !MG.hasGlyph('Song-600', ch));
  if (miss.length) console.error(`卡 ${s.卡} 的字幕里有宋体没有的字「${miss.join('')}」，会被换成系统字体：换个说法前先问用户`); });
})();
