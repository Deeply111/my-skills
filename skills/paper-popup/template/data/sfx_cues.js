// 音效：[声音, 时刻, {vol, dur}]。时刻 = 画里东西到位、落地、碰上的那一帧；W("c02","早") = 这个字开口的时刻。
// 改完跑 scripts/bake_sfx.mjs 写进 index.html（HyperFrames 只认写在页面里、带 id 的 <audio>）。
// 声音：fold 翻起 / flop 倒下 / press 印上 / tap 落下 / draw 画线 / rustle 镜头甩过 / tick 小方块 / thump 最重的一下（一次）
window.SFX_CUES = (W) => {
  return [
    // ["fold", W("c01", "缺") + 0.3],
  ];
};
