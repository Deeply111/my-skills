# 出片流程（Windows，命令都在本期目录外跑也行）

依赖：Node 22+（`npx hyperframes@0.9.6`）、Python 3.10+（`faster-whisper`、`opencc-python-reimplemented`、`numpy`）、ffmpeg 在 PATH 里。有 NVIDIA 显卡时 faster-whisper 走 CUDA（要 cuBLAS 12 + cuDNN 9：`pip install --user nvidia-cublas-cu12 "nvidia-cudnn-cu12>=9,<10"`，再把它们的 `bin` 加进 PATH）。`SKILL` 指这个 skill 的目录。

## 1. 建一期

```powershell
python $SKILL\scripts\new_episode.py --out D:\...\ep03 --video D:\...\1.mp4 --from 0 --to 13 --title "本期标题"
```

截出 `assets/talk.mp4`（无声画面，给照片/贴纸）、`voice.wav`、`music.wav`，模板的片长已填好。配乐默认「若如初见」，从口播的同一时刻开始，几段接起来是连续的；用户指定曲子时加 `--music <文件>`，不要配乐加 `--music none`。

## 2. 字幕（逐字时间）

逐字稿一行一条字幕，写他实际说的：

```powershell
python $SKILL\scripts\make_caps.py --video D:\...\1.mp4 --script ep03\script.txt --from 0 --to 13 --out ep03\data\caps.js
```

看输出的"对上 N%"。低于八成先改稿子再跑。

## 3. 动作表

填 `ep03\action-table.md`（见 `references/action-table.md`）。自查五条都过了再往下。

## 4. 写场景

在 `index.html` 里按动作表一行一行写，每段注释写行号。时刻一律 `K.word("c02","早")`。

## 4b. 音效

在 `data/sfx_cues.js` 里写每一声（声音、时刻、音量），时刻用 `W("c02","早")` 加上动作到位的偏移。写完：

```powershell
node $SKILL\scriptsake_sfx.mjs ep03\index.html ep03\data\caps.js ep03\data\sfx_cues.js
```

它把 `<audio>` 写进页面（HyperFrames 只认写在页面里、带 id 的音频），并提示挨得太近的两声。改了字幕或音效就再跑一次。

## 5. 看帧（不出片）

```powershell
cd ep03; npx --yes hyperframes@0.9.6 snapshot --at 0.5,1.9,3.2,...
```

产物在 `.hyperframes\artifacts\snapshots\<id>\contact-sheet-*.jpg`。每行动作表至少一帧；切换 2D/2.5D 的前后各一帧。逐张看：字有没有被挡、东西有没有露在画外、平铺的字是不是反的。

## 6. 出片

```powershell
npx --yes hyperframes@0.9.6 lint      # 有 ✗ 先修：比如 audio 没 id 会没声音
npx --yes hyperframes@0.9.6 render --fps 30 -o renders\v1.mp4
python $SKILL\scripts\master.py renders\v1.mp4 D:\...\成片.mp4
```

30fps 够用（60fps 时间翻倍）。浏览器已经用显卡画 3D，慢在逐帧截图：13 秒约 1–2 分钟。
