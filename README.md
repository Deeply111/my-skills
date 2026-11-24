# my-skills

个人常用 AI Agent Skills 收藏与备份仓库，采用标准 `skills/<skill-name>/SKILL.md` 目录结构，兼容 Antigravity、Claude Code、Codex 等支持 `SKILL.md` 的工具。

## 已收录 Skills

| Skill | 简介 | 来源 |
| --- | --- | --- |
| [`motion-explainer`](skills/motion-explainer/SKILL.md) | 用代码（`skia-canvas` + Python 合成配乐）制作 30–60 秒动效短片，默认竖版 9:16、支持横版 16:9，有/无口播皆可。 | [jeszhou/motion-explainer](https://github.com/jeszhou/motion-explainer) |
| [`hand-drawn-cover`](skills/hand-drawn-cover/SKILL.md) | 手绘风口播视频封面：暖米纸底 + 排线马克笔大标题 + 白边虚线真人抠图 + 手绘流程图/截图，支持 3:4、4:3、16:9 三尺寸。 | [jeszhou/hand-drawn-cover](https://github.com/jeszhou/hand-drawn-cover) |
| [`concept-short`](skills/concept-short/SKILL.md) | 把成长类文案做成 2D + Three.js 3D 动画短片（横屏 1920×1080 为主、竖屏为辅，含画面卡 → 样张 → 前 20 秒 → 成片完整工作流与素材库）。 | 本地 `skill-v4` |

## 快速安装 / 同步到本机

### Windows (PowerShell)
```powershell
git clone https://github.com/Deeply111/my-skills.git
cd my-skills
.\install.ps1
```
默认会将 `skills/` 下的全部 skill 同步到 `~\.gemini\config\skills\`；也可以指定目标目录：
```powershell
.\install.ps1 -Target "$HOME\.claude\skills"
```

### macOS / Linux
```bash
git clone https://github.com/Deeply111/my-skills.git
cp -R my-skills/skills/* ~/.gemini/config/skills/
```

## 后续新增 Skill
把新 skill 文件夹放进 `skills/<skill-name>/`（包含 `SKILL.md`），然后提交推送即可：
```bash
git add .
git commit -m "feat: add <skill-name>"
git push
```
