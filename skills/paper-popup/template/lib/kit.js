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
    return { mk, lines, bgBlock, bgCard, fgCard, fgFlat, tag, print, arrow, drawIn, dropIn, word, presenterIn, presenterOut, popUp, foldDown, fadeIn, printFlat, standUp, block, actor, captions, stand, flat, side };
  }
  return { use };
})();
