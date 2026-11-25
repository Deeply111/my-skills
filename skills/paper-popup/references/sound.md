# 声音设计

换模板、换题材都按这几步做。

1. **定调**：画面里的东西是什么做的、在什么空间里？声音就用那种材质、那种空间。一条片以一种主音色为底，听起来像同一个世界。
2. **列动作**：这个世界里会反复发生的几类动作（出现、离开、落地、画出来、移动、强调……），一般 5–8 类。
3. **配声音**：每类动作配一种声音，写成一张表：动作 → 听起来像什么 → 对准哪一帧 → 多响。另挑一个最重的声音，留给全片最重的一刻。
4. **找素材、统一加工**：每种准备几个变体；切到起音、统一响度、套同一个空间，听起来像在同一个地方录的。
5. **挂到动作上**：时刻跟着动作和字走（本模板：`data/sfx_cues.js` 里用 `W("c02","早")` 加上动作到位的偏移），对准碰到的那一帧；写完跑 `scripts/bake_sfx.mjs` 写进页面。
6. **混音**：人声 > 音效 > 配乐，最后过母带（`scripts/master.py`）。
7. **听**：闭眼只听一遍，再对着画面看一遍，再用手机外放听一遍；哪里怪改哪里。没经人耳听过的新声音，交片时请用户听。

## 素材从哪找

| 资源 | 说明 |
|---|---|
| [Freesound](https://freesound.org) | 最全的实录库，搜英文关键词 |
| [Pixabay 音效](https://pixabay.com/sound-effects/) | 免费，质量整齐 |
| [Mixkit](https://mixkit.co/free-sound-effects/) | 免费，偏界面和转场 |
| [Zapsplat](https://www.zapsplat.com) | 量大，注册后下载 |
| [BBC Sound Effects](https://sound-effects.bbcrewind.co.uk) | 三万多条实录，环境和物件声很好 |
| [Sonniss GDC 合集](https://sonniss.com/gameaudiogdc) | 每年免费放出的大包，专业录音 |
| [Kenney](https://kenney.nl/assets/category:Audio) | 小巧的界面、游戏音 |
| [爱给网](https://www.aigei.com/sound/) | 中文搜索，国内常用音效 |
| YouTube 音频库 | 音效和配乐，YouTube 工作室里下载 |

## 配乐

- 默认用「若如初见」（`scripts/new_episode.py` 里的 `DEFAULT_MUSIC`）；用户指定了别的曲子就用 `--music`，不要配乐写 `--music none`。
- 同一条口播分几段做时，音乐从口播的同一时刻开始（默认），各段接起来音乐是连续的。
- 不做卡点。配乐压在人声下面当底（模板里音量 0.12），听着抢人声就再压低。

