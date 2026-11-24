# hand-drawn-cover

手绘风口播视频封面 skill（适用于 Claude Code / Codex 等支持 skill 的 AI 工具）。

输入口播稿 + 出镜人物照 → 出标题给你选 → 设计手绘流程图 → AI 生图出 3:4 封面，再补 4:3、16:9。
风格：暖米纸底 + 排线马克笔大标题 + 白边虚线描边的真人抠图 + 手绘流程图或截图。

| 构图 A：人左下 + 流程图 | 构图 B：人右下 + 截图 |
|---|---|
| ![A](examples/style-A_人左下_流程图.png) | ![B](examples/style-B_人右下_截图.png) |

## 安装

```bash
git clone https://github.com/jeszhou/hand-drawn-cover ~/.claude/skills/hand-drawn-cover
```

然后对 AI 说「做封面」「手绘风封面」即可触发。详细流程见 [SKILL.md](SKILL.md)。

## 依赖

- 出图：Codex CLI 内置 image_gen；没有的话用 `--dry-run` 打印提示词，拿去 ChatGPT / 即梦 / Nano Banana 等手动生成
- Python 3，可选 Pillow（尺寸校正）
