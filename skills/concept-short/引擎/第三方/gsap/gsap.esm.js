// 给 ES 模块用的 gsap：页面已经用普通脚本加载了 gsap.min.js（window.gsap），这里转出来（three-story-controls 要 import gsap）
export default window.gsap;
export const gsap = window.gsap;
