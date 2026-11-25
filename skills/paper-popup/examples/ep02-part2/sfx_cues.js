// Sound cues: [sound, time, {vol, dur}]. Time = the frame where the thing lands. Baked by tools/bake_sfx.mjs.
window.SFX_CUES = (W) => {
  const tWall = W("c04", "不"), tOut = W("c04", "外"), tTest = W("c04", "考"), tGood = W("c05", "良");
  const tTurn = W("c06", "而"), tOutp = W("c06", "向"), tHard = W("c06", "难");
  return [
    ["fold", 0.3, { vol: .24 }],                                   // the book opens
    ["draw", W("c01", "分") - 0.05, { dur: .45, vol: .16 }],       // arrow out of the book
    ["fold", W("c01", "感") + 0.28],                              // empty card stands up
    ["rustle", 2.5, { vol: .18 }],                                 // jump + camera follows
    ["tick", 2.9],                                                 // lands at the screen
    ["draw", W("c02", "编") + 0.12, { dur: .45, vol: .1 }],                // code lines type in
    ["draw", W("c02", "做") - 0.05, { dur: .45, vol: .16 }],       // arrow out of the screen
    ["fold", W("c02", "软") + 0.28],                              // empty box stands up
    ["tick", 5.25, { vol: .3 }],                                   // big jump onto the cushion
    ["press", W("c03", "向") + 0.6, { vol: .24 }],                  // 向内输入 printed
    ["fold", tWall + 0.17, { vol: .26 }], ["fold", tWall + 0.62, { vol: .2 }],   // walls rise
    ["fold", tOut + 0.12, { vol: .18 }],                           // exam sheets stand up outside
    ["tap", tTest + 0.2], ["tap", tTest + 0.37, { vol: .22 }],     // they hit the walls and bounce off
    ["tick", W("c05", "自") + 0.1, { vol: .18 }],                  // the square puffs up
    ["press", tGood + 0.25, { vol: .28 }],                         // 良好 stamp
    ["rustle", tTurn + 0.08, { vol: .2 }],                          // swing out to the right
    ["tap", tOutp + 0.14, { vol: .26 }],                           // first step lands
    ["tick", tTurn + 0.62],                                        // the square lands outside the wall
    ["thump", tHard + 0.17],                                       // 难: the one heavy hit
    ["tick", 11.81, { vol: .24 }],                                 // hops onto the first step
    ["flop", 12.32, { vol: .2 }],                                  // slides back down
  ];
};
