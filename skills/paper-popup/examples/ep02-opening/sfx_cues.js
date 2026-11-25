// Sound cues: [sound, time, {vol, dur}]. Time = the frame where the thing lands. W(id, 字) = when that character is spoken.
// Baked into index.html as <audio> tags by tools/bake_sfx.mjs (HyperFrames only reads audio written in the HTML).
window.SFX_CUES = (W) => {
  const J1 = 3.55, tSun = W("c02", "早"), tGym = W("c02", "运"), tBook = W("c02", "读");
  const tBase = W("c03", "基"), tStop = W("c04", "步"), tSame = W("c04", "不");
  return [
    ["tap", 0.18], ["press", 0.37], ["tap", 0.63, { vol: .22 }],            // books land, title printed
    ["tick", 0.9],                                                           // the square lands on the tower
    ["fold", 1.35],                                                          // title stands up
    ["draw", W("c01", "缺") - 0.05, { dur: .45, vol: .18 }],                 // dashed arrow drawn
    ["draw", W("c01", "输"), { dur: .25, vol: .14 }],                        // orange tries to fill it
    ["rustle", 2.95],                                                        // jump + camera sweep
    ["tick", J1, { vol: .34 }],                                              // lands on the next spread
    ["fold", tSun + .06], ["fold", tGym + .14, { vol: .25 }], ["fold", tBook + .27, { vol: .21 }],
    ["draw", W("c03", "内") - .15, { dur: .6, vol: .18 }],                  // the ring is drawn
    ["flop", 7.63, { vol: .14 }],                                            // the three things fall back
    ["press", W("c03", "循") + .25, { vol: .26 }],                           // 内部循环 printed
    ["fold", tBase - .06, { vol: .26 }], ["fold", tBase + .51, { vol: .22 }],// first fence up, last one closes
    ["fold", 10.26, { vol: .28 }],                                           // the door
    ["thump", tStop],                                                        // 止步: the one heavy hit
    ["tick", tSame + .4, { vol: .24 }],                                      // hops on the spot, lands where it was
  ];
};
