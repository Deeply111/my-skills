// kit.js —— 纸面立体书的常用动作。场景代码只写"什么东西、什么时候、怎么动"，这些手法统一从这里取。
// 用法（index.html 里，Stage3D.install 之后）：
//   const K = Kit.use(tl);
//   K.popUp(el, t)            立体书：纸片从纸面翻起来（rotationX 0 → 90），翻起前隐藏
//   K.foldDown(el, t)         倒回纸面并隐藏（离场）
//   K.fadeIn(el, t)           影子、平铺件淡入
//   K.printFlat(el, t)        平铺在纸面上、从上往下看读得正（2D 段落里的字；rotationX 180）
//   K.standUp(el, t)          从"印在纸上"翻成立着（配合 2D → 2.5D 的镜头下压）
//   K.block(parent, x, z, w, d, h, frontBg)   纸盒（正面 + 顶面 + 右侧面），底边前沿中心在 (x,z)
//   K.actor(el, inner, shadow, x, z)          角色（小方块等）：返回 {at, hop, squash}
//   K.captions(caps, keys, endT)              底部字幕：逐字由灰变黑，关键词变强调色
//   K.word(id, ch, n)                         取"第 id 句里第 n 次出现的字 ch"开口的时刻（秒）
// 画面层次和字（都放在 #page 里，靠离镜头的远近分层）：
//   K.mk(cls, html)                           在纸面上建一个元素
//   K.bgBlock(x, z, w, d, h) / K.bgCard(x, z, w, h, yaw)    背景：浅色、细线、低对比
//   K.fgCard(x, z, w, h, yaw) / K.fgFlat(x, z, w, d, lift, rot)   前景：暗、虚、靠边；lift > 0 = 悬在纸面上方（俯视时的前景）
//   K.tag(text, x, z, w, h, {acc, yaw, lift}) 立着的字牌（之后用 popUp 翻起）
//   K.print(text, x, z, w, h)                 印在纸面上的字（之后用 printFlat 印出）
//   K.arrow(x0, x1, z) + K.drawIn(el, t)      纸面上的虚线箭头，从起点画出来
//   K.dropIn(g, t)                            纸盒从上方落下（不在 3D 组上加透明度，免得被拍扁）
// 剪辑层（屏幕层，不跟镜头；少用，只用在段落切换和最重的一句）：
//   K.punch(t, hold, amt)        重音轻推：整个画面快速推近一点，停一下，再缓缓回来
//   K.shade(t)                   一道纸影从左到右扫过（像一只手从纸面上方掠过），给段落切换一口气
//   K.lineRelay(t, y)            一笔墨线从左画到右再收走，带着视线去下一处
//   K.stripWipe(t) / stripIn / stripOut   三条纸条错开滑过、盖满再揭开；被盖住的那一刻可以硬切（两段片子的接缝也用它）
//   K.fillIn(el, t)              字先只有轮廓，再从左到右填实（用在印出的字、字牌上，配合 printFlat / popUp）
window.Kit = (() => {
  function use(tl) {
    const { stand, flat, side } = Stage3D;
    const CAPS = window.CAPS || [];
    const word = (id, ch, n = 1) => {
      const c = CAPS.find((x) => x.id === id);
      if (!c) throw Error(`字幕里没有 ${id}`);
      const hit = c.u.filter((x) => x[0][0] === ch)[n - 1];
      if (!hit) throw Error(`${id} 里找不到第 ${n} 个「${ch}」`);
      return hit[1];
    };
    const popUp = (el, t, d = 0.5) => {
      tl.fromTo(el, { rotationX: 0 }, { rotationX: 90, duration: d, ease: "back.out(1.6)" }, t);
      tl.fromTo(el, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.08 }, t);
    };
    const foldDown = (el, t, d = 0.35) => {
      tl.to(el, { rotationX: 0, duration: d, ease: "power2.in" }, t);
      tl.to(el, { autoAlpha: 0, duration: 0.05 }, t + d);
    };
    // Presenter frames live in the flat HUD layer: a soft fade + 14px rise, nothing flashier.
    const presenterIn = (el, t) => tl.fromTo(el, { autoAlpha: 0, y: 14 }, { autoAlpha: 1, y: 0, duration: 0.4, ease: "power2.out" }, t);
    const presenterOut = (el, t) => tl.to(el, { autoAlpha: 0, duration: 0.25, ease: "power1.in" }, t);
    const fadeIn = (el, t, d = 0.4) => tl.fromTo(el, { autoAlpha: 0 }, { autoAlpha: 1, duration: d }, t);
    const printFlat = (el, t, d = 0.35) =>
      tl.fromTo(el, { rotationX: 180, autoAlpha: 0, scale: 1.25 }, { rotationX: 180, autoAlpha: 1, scale: 1, duration: d, ease: "power3.in" }, t);
    const standUp = (el, t, d = 0.7) => tl.to(el, { rotationX: 90, duration: d, ease: "back.out(1.3)" }, t);
    function block(parent, x, z, w, d, h, frontBg = "linear-gradient(#fefdf9,#ece6da)") {
      const g = document.createElement("div"); g.className = "g3"; parent.appendChild(g);
      const f = document.createElement("div"); f.className = "front"; f.style.background = frontBg; g.appendChild(f); stand(f, x, z, w, h);
      const tp = document.createElement("div"); tp.className = "top"; g.appendChild(tp); flat(tp, x, z - d / 2, w, d); gsap.set(tp, { z: -h });
      const sd = document.createElement("div"); sd.className = "sideF"; g.appendChild(sd); side(sd, x + w / 2, z, z - d, h);
      return g;
    }
    // An actor stands at (x,z) on the floor; at(X,Z) converts a floor point to its offsets; hop() jumps it there.
    function actor(el, inner, shadow, x, z, w = 72, h = 72) {
      stand(el, x, z, w, h); flat(shadow, x, z, w * 1.5, w * 1.25);
      gsap.set(inner, { transformOrigin: "50% 100%" });
      const at = (X, Z) => ({ x: X - x, y: -(Z - z) });
      const squash = (t, sy = 0.75, sx = 1.15) => {
        tl.to(inner, { scaleY: sy, scaleX: sx, duration: 0.08 }, t);
        tl.to(inner, { scaleY: 1, scaleX: 1, duration: 0.3, ease: "elastic.out(1,0.45)" }, t + 0.08);
      };
      // jump to floor point (X,Z); lift = arc height; landH = height of what it lands on (a step's top)
      const hop = (t, X, Z, lift = 130, d = 0.36, landH = 0) => {
        const p = at(X, Z);
        tl.to(inner, { scaleY: 0.75, scaleX: 1.15, duration: 0.09, ease: "power2.in" }, t - 0.09);
        tl.to([el, shadow], { x: p.x, y: p.y, duration: d, ease: "none" }, t);
        tl.to(el, { z: -(lift + landH), duration: d / 2, ease: "power2.out" }, t);
        tl.to(inner, { scaleY: 1.1, scaleX: 0.92, duration: d / 2 }, t);
        tl.to(el, { z: -landH, duration: d / 2, ease: "power2.in" }, t + d / 2);
        squash(t + d, 0.8, 1.15);
      };
      return { at, hop, squash };
    }
    function captions(keys = {}, endT, acc = "#E8430F", ink = "#141414") {
      const box = document.getElementById("caps");
      // Line-end ，。、；： are dropped; mid-line ones become a space; ？！ stay (they carry tone).
      const SOFT = /[，。、；：,.;:…—]+/g;
      const tidy = (s, last) => (last ? s.replace(SOFT, "") : s.replace(SOFT, " "));
      CAPS.forEach((c, ci) => {
        const el = document.createElement("div"); el.className = "cap"; box.appendChild(el);
        el.innerHTML = c.u.map((u, i) => `<span class="c">${tidy(u[0], i === c.u.length - 1)}</span>`).join("");
        const next = CAPS[ci + 1], key = keys[c.id] || "";
        const prevEnd = ci ? CAPS[ci - 1].t1 : -1, gap = c.t0 - prevEnd < 0.3 ? 0.16 : 0;   // a breath between back-to-back lines
        tl.fromTo(el, { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.18, ease: "power3.out" }, Math.max(0, c.t0 - 0.12 + gap));
        tl.to(el, { opacity: 0, duration: 0.12 }, next ? next.t0 - 0.14 : endT);
        [...el.children].forEach((s, i) => tl.to(s, { color: key.includes(c.u[i][0][0]) ? acc : ink, duration: 0.08 }, c.u[i][1]));
      });
    }
    const PG = document.getElementById("page");
    const mk = (cls, html = "") => { const el = document.createElement("div"); el.className = cls; el.innerHTML = html; PG.appendChild(el); return el; };
    const lines = (n, top = 26, gap = 22) => Array.from({ length: n }, (_, i) => `<i style="top:${top + i * gap}px"></i>`).join("");
    const bgBlock = (x, z, w, d, h) => {
      const g = block(PG, x, z, w, d, h, "linear-gradient(#f8f6f0,#ece7dc)");
      g.querySelectorAll("div").forEach((e) => { e.style.borderColor = "rgba(20,20,20,.16)"; e.style.borderWidth = "3px"; });
      g.querySelector(".sideF").style.background = "#e8e3d8"; return g;
    };
    const bgCard = (x, z, w, h, yaw = 0) => { const el = mk("bgc", lines(Math.max(2, Math.floor(h / 40)))); stand(el, x, z, w, h, { yaw }); return el; };
    const fgCard = (x, z, w, h, yaw = 0) => { const el = mk("fgc"); stand(el, x, z, w, h, { yaw }); return el; };
    const fgFlat = (x, z, w, d, lift = 0, rot = 0) => { const el = mk("fgf", lines(3, 30, 34)); flat(el, x, z, w, d); gsap.set(el, { z: -lift, rotation: rot }); return el; };
    const tag = (text, x, z, w, h, o = {}) => { const el = mk(o.acc ? "tag acc" : "tag", text); stand(el, x, z, w, h, { yaw: o.yaw || 0 }); if (o.lift) gsap.set(el, { z: -o.lift }); return el; };
    const print = (text, x, z, w, h) => { const el = mk("print", text); flat(el, x, z, w, h); gsap.set(el, { autoAlpha: 0 }); return el; };
    const arrow = (x0, x1, z) => {
      const w = x1 - x0, el = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      el.setAttribute("viewBox", `0 0 ${w} 140`); el.style.overflow = "visible";
      el.innerHTML = `<path d="M10 70 H${w - 90} M${w - 130} 20 L${w - 40} 70 L${w - 130} 120" fill="none" stroke="#141414" stroke-opacity=".55" stroke-width="10" stroke-dasharray="26 18" stroke-linecap="round" stroke-linejoin="round"/>`;
      PG.appendChild(el); flat(el, (x0 + x1) / 2, z, w, 140); gsap.set(el, { autoAlpha: 0 }); return el;
    };
    const drawIn = (el, t, d = 0.45) => tl.fromTo(el, { scaleX: 0, autoAlpha: 0, transformOrigin: "0% 50%" }, { scaleX: 1, autoAlpha: 1, duration: d, ease: "power2.out" }, t);
    const dropIn = (g, t, from = 700, d = 0.38) => {
      gsap.set(g.children, { autoAlpha: 0 }); tl.set(g.children, { autoAlpha: 1 }, t);
      tl.fromTo(g, { z: -from }, { z: 0, duration: d, ease: "bounce.out" }, t);
    };
    // ---- cut layer: lives on the screen, not in the 3D scene ----
    const ROOT = document.getElementById("root"), VIEW = document.getElementById("view");
    const hud = (css, html = "") => { const el = document.createElement("div"); el.style.cssText = "position:absolute;pointer-events:none;" + css; el.innerHTML = html; ROOT.appendChild(el); gsap.set(el, { autoAlpha: 0 }); return el; };
    const punch = (t, hold = 0.5, amt = 0.05) => {
      gsap.set(VIEW, { transformOrigin: "50% 46%" });
      tl.fromTo(VIEW, { scale: 1 }, { scale: 1 + amt, duration: 0.22, ease: "power3.out", immediateRender: false }, t);
      tl.fromTo(VIEW, { scale: 1 + amt }, { scale: 1, duration: 0.65, ease: "power2.inOut", immediateRender: false }, t + 0.22 + hold);
    };
    const shade = (t, d = 0.55) => {
      const el = hud("left:-1150px;top:0;width:1150px;height:1080px;z-index:6;background:linear-gradient(90deg,rgba(60,40,20,0),rgba(60,40,20,.3) 40%,rgba(60,40,20,.3) 60%,rgba(60,40,20,0))");
      tl.set(el, { autoAlpha: 1 }, t);
      tl.fromTo(el, { x: 0 }, { x: 3070, duration: d, ease: "power1.inOut", immediateRender: false }, t);
      tl.set(el, { autoAlpha: 0 }, t + d);
    };
    const lineRelay = (t, y = 880, color = "#141414") => {
      const el = hud(`left:0;top:${y - 40}px;width:1920px;height:80px;z-index:6`,
        `<svg viewBox="0 0 1920 80" width="1920" height="80" style="overflow:visible"><path d="M-20 44 C 500 30, 1200 52, 1840 40 M1790 10 L1860 40 L1790 70" fill="none" stroke="${color}" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/></svg>`);
      tl.set(el, { autoAlpha: 1 }, t);
      tl.fromTo(el, { scaleX: 0, transformOrigin: "0% 50%" }, { scaleX: 1, duration: 0.35, ease: "power3.out", immediateRender: false }, t);
      tl.fromTo(el, { scaleX: 1, transformOrigin: "100% 50%" }, { scaleX: 0, duration: 0.35, ease: "power3.in", immediateRender: false }, t + 0.55);
      tl.set(el, { autoAlpha: 0 }, t + 0.9);
    };
    let strips = null;
    const mkStrips = () => strips || (strips = [0, 1, 2].map((i) => hud(`left:-40px;top:${i * 360 - 6}px;width:2000px;height:372px;z-index:19;background:linear-gradient(#f6f2ea,#ece6d9);border-top:5px solid #141414;border-bottom:5px solid #141414;box-shadow:0 18px 30px rgba(60,40,20,.25);transform:rotate(${[-1, 0.6, -0.5][i]}deg)`)));
    const stripIn = (t, d = 0.38) => mkStrips().forEach((el, i) => {
      tl.set(el, { autoAlpha: 1 }, t + i * 0.07);
      tl.fromTo(el, { x: 2000 }, { x: 0, duration: d, ease: "power3.out", immediateRender: false }, t + i * 0.07);
    });
    const stripOut = (t, d = 0.38) => mkStrips().forEach((el, i) => {
      if (t <= 0) gsap.set(el, { autoAlpha: 1, x: 0 }); else tl.set(el, { autoAlpha: 1, x: 0 }, t);
      tl.to(el, { x: -2040, duration: d, ease: "power3.in" }, t + i * 0.07);
      tl.set(el, { autoAlpha: 0 }, t + i * 0.07 + d);
    });
    const stripWipe = (t) => { stripIn(t); stripOut(t + 0.6); return t + 0.52; };   // returns the moment the screen is fully covered
    const fillIn = (el, t, d = 0.45, stroke = 3) => {
      const html = el.innerHTML;
      el.innerHTML = `<span style="position:relative;display:inline-block"><span style="-webkit-text-fill-color:transparent;-webkit-text-stroke:${stroke}px currentColor">${html}</span><span class="k-fill" style="position:absolute;left:0;top:0;white-space:nowrap">${html}</span></span>`;
      tl.fromTo(el.querySelector(".k-fill"), { clipPath: "inset(-10% 100% -10% 0)" }, { clipPath: "inset(-10% 0% -10% 0)", duration: d, ease: "power2.inOut" }, t);
    };
    return { punch, shade, lineRelay, stripIn, stripOut, stripWipe, fillIn, mk, lines, bgBlock, bgCard, fgCard, fgFlat, tag, print, arrow, drawIn, dropIn, word, presenterIn, presenterOut, popUp, foldDown, fadeIn, printFlat, standUp, block, actor, captions, stand, flat, side };
  }
  return { use };
})();
