# my-skills

个人常用 AI Agent Skills 收藏与备份仓库，采用标准 `skills/<skill-name>/SKILL.md` 目录结构，兼容 Antigravity、Claude Code、Codex 等支持 `SKILL.md` 的工具。

## 已收录 Skills

| Skill | 简介 | 来源 |
| --- | --- | --- |
| [`motion-explainer`](skills/motion-explainer/SKILL.md) | 用代码（`skia-canvas` + Python 合成配乐）制作 30–60 秒动效短片，默认竖版 9:16、支持横版 16:9，有/无口播皆可。 | [jeszhou/motion-explainer](https://github.com/jeszhou/motion-explainer) |
| [`hand-drawn-cover`](skills/hand-drawn-cover/SKILL.md) | 手绘风口播视频封面：暖米纸底 + 排线马克笔大标题 + 白边虚线真人抠图 + 手绘流程图/截图，支持 3:4、4:3、16:9 三尺寸。 | [jeszhou/hand-drawn-cover](https://github.com/jeszhou/hand-drawn-cover) |
| [`paper-popup`](skills/paper-popup/SKILL.md) | 纸面立体书：米白纸面上的 2D + 2.5D 横屏口播动画（HyperFrames + CSS 3D），概念做成从纸上翻起的纸片，镜头在俯视平面和立体场景间切换；先写逐句动作表再写代码；主持人只用照片/圆贴纸、不抠像。 | 本地 `template/paper` |
| [`concept-short`](skills/concept-short/SKILL.md) | 把成长类文案做成 2D + Three.js 3D 动画短片（横屏 1920×1080 为主、竖屏为辅，含画面卡 → 样张 → 前 20 秒 → 成片完整工作流与素材库）。 | 本地 `skill-v4` |
| [`openfilm`](skills/openfilm/SKILL.md) | OpenFilm 入口：把视频做成网页（film.html），用 Studio 编辑和渲染 MP4；运行 `npx -y openfilm@latest` 获取完整说明。 | [openfilm/openfilm](https://github.com/openfilm/openfilm) |
| [`beat-cut`](skills/beat-cut/SKILL.md) | OpenFilm 踩点/卡点剪辑：测音乐节拍、规划镜头，在节拍上切换、推镜和抖动。 | [WEBGRS/openfilm-beat-cut](https://github.com/WEBGRS/openfilm-beat-cut) |
| [`replicate`](skills/replicate/SKILL.md) | OpenFilm 复刻视频：照参考视频逐镜头做同款，只换指定内容。 | [openfilm/skill-replicate](https://github.com/openfilm/skill-replicate) |
| [`explainer-shorts`](skills/explainer-shorts/SKILL.md) | OpenFilm 科普讲解短片规范示例（1–3 分钟横屏）。 | [WEBGRS/openfilm-skill-template](https://github.com/WEBGRS/openfilm-skill-template) |
| [`my-video-spec`](skills/my-video-spec/SKILL.md) | OpenFilm 视频规范空白模板（待填写）。 | [WEBGRS/openfilm-skill-template](https://github.com/WEBGRS/openfilm-skill-template) |
| [`my-series`](skills/my-series/SKILL.md) | OpenFilm 系列片模板，含片头、片尾、字幕（待填写）。 | [WEBGRS/openfilm-skill-template](https://github.com/WEBGRS/openfilm-skill-template) |

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
