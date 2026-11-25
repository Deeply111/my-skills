// stage3d.js —— 纸面编辑部的 3D 舞台：纸面平铺成地板，东西都是平面纸片、立在地板上（立体书），相机在空间里绕、俯、推。
// 全是时间的纯函数（关键帧插值），由一条时钟补间驱动，任意跳帧画面一样。
//
// 世界坐标：x 向右，y 向下（地板在 y = FLOOR），z 朝向观众（越远越负）。
//   相机 {x,y,z}：画面中心对准的世界点；rx 俯仰（负 = 往下看），ry 水平绕（度），s 推拉。
// 摆东西（在 #page 里，#page 就是地板）：
//   Stage3D.stand(el, x, z, w, h, {yaw})   立着的纸片：底边中心落在地板 (x,z)，yaw 绕竖轴转
//   Stage3D.flat(el, x, z, w, d)           平躺在地板上的纸片（影子、印在纸上的字）
//   Stage3D.side(el, x, zNear, zFar, h)    沿纵深立着的纸片（盒子、台阶的侧面）
//   立着的纸片用 GSAP：rotationX 0 → 90 = 从纸面上弹起来（立体书）；z 负 = 离开地面往上；x/y = 沿地板挪（y 负 = 往远处）
window.Stage3D = (() => {
  const FLOOR = 800, PX = 1500, PZ = 1200;   // #page 左上角 = 世界 (-PX, FLOOR, PZ)
  const C = (x) => Math.max(0, Math.min(1, x));
  const EASE = {
    io: (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2),
    out: (x) => 1 - Math.pow(1 - x, 3),
    in: (x) => x * x * x,
    lin: (x) => x,
    hold: () => 0,
  };
  function fill(keys, base) { let prev = { ...base }; return keys.map(([t, p, e]) => { prev = { ...prev, ...p }; return [t, { ...prev }, e]; }); }
  function track(keys, t) {
    if (t <= keys[0][0]) return { ...keys[0][1] };
    for (let i = 1; i < keys.length; i++) {
      const [t1, p1, e] = keys[i];
      if (t < t1) {
        const [t0, p0] = keys[i - 1], k = EASE[e || "io"](C((t - t0) / (t1 - t0))), o = {};
        for (const key in p1) o[key] = p0[key] + (p1[key] - p0[key]) * k;
        return o;
      }
    }
    return { ...keys[keys.length - 1][1] };
  }
  const u = (x) => x + PX, v = (z) => PZ - z;
  function stand(el, x, z, w, h, o = {}) {
    Object.assign(el.style, { position: "absolute", left: u(x) - w / 2 + "px", top: v(z) - h + "px", width: w + "px", height: h + "px", transformOrigin: "50% 100%", transformStyle: "preserve-3d" });
    gsap.set(el, { rotationX: o.flat ? 0 : 90, rotationZ: o.yaw || 0 });
  }
  function flat(el, x, z, w, d) {
    Object.assign(el.style, { position: "absolute", left: u(x) - w / 2 + "px", top: v(z) - d / 2 + "px", width: w + "px", height: d + "px" });
  }
  function side(el, x, zNear, zFar, h) {
    Object.assign(el.style, { position: "absolute", left: u(x) + "px", top: v(zNear) - h + "px", width: zNear - zFar + "px", height: h + "px", transformOrigin: "0% 100%" });
    gsap.set(el, { rotationZ: 90, rotationX: 90 });
  }

  function install(tl, o) {
    const cam = fill(o.cam, { x: 960, y: 600, z: -300, rx: -20, ry: 0, s: 1 });
    const W = document.getElementById("world");
    const shake = o.shake || [];
    const hand = (t) => ({ x: Math.sin(t * 0.9) * 3 + Math.sin(t * 2.3 + 1) * 1.2, y: Math.cos(t * 0.7) * 2.5, rx: Math.sin(t * 0.45) * 0.35, ry: Math.sin(t * 0.6 + 2) * 0.5 });
    const kick = (t) => {
      let x = 0, y = 0;
      for (const [t0, a, d = 0.35] of shake) { const k = (t - t0) / d; if (k >= 0 && k < 1) { const f = a * (1 - k) * (1 - k); x += Math.sin(k * 40) * f; y += Math.cos(k * 33) * f * 0.7; } }
      return { x, y };
    };
    function apply(t) {
      const c = track(cam, t), h = hand(t), q = kick(t);
      W.style.transform = `translate(960px,540px) rotateX(${(c.rx + h.rx).toFixed(3)}deg) rotateY(${(c.ry + h.ry).toFixed(3)}deg) scale3d(${c.s.toFixed(4)},${c.s.toFixed(4)},${c.s.toFixed(4)}) translate3d(${(-(c.x + h.x + q.x)).toFixed(2)}px,${(-(c.y + h.y + q.y)).toFixed(2)}px,${(-c.z).toFixed(2)}px)`;
    }
    const clock = { t: 0 };
    tl.fromTo(clock, { t: 0 }, { t: o.duration, duration: o.duration, ease: "none", onUpdate: () => apply(clock.t) }, 0);
    apply(0);
  }
  return { install, stand, flat, side, FLOOR };
})();
