#!/usr/bin/env python3
"""用 Codex CLI 的内置 image_gen 出一张手绘风封面；没有 Codex 时用 --dry-run 打印提示词和上传顺序。

用法：
  python3 scripts/gen_cover.py --prompt prompt_3x4.md --ratio 3:4 \
      --style examples/style-A_人左下_流程图.png --style examples/style-B_人右下_截图.png \
      --person person.jpg --out /abs/path/主题_封面_v1_3x4.png

  # 没有 Codex：只打印提示词 + 图片上传顺序，拿去别的生图工具用
  python3 scripts/gen_cover.py --dry-run ...（参数同上）

附件顺序固定：先 --style，再 --person，再 --shot。提示词里的「图 1/图 2/图 3…」按这个顺序写。
"""
import argparse, os, shutil, subprocess, sys, tempfile

SIZES = {"3:4": (1086, 1448), "4:3": (1448, 1086), "16:9": (1920, 1080)}


def fit_exact(path, size):
    try:
        from PIL import Image
    except ImportError:
        print("  （没装 Pillow，跳过尺寸校正：pip install pillow）")
        return False
    im = Image.open(path).convert("RGB")
    if im.size == size:
        return False
    tw, th = size
    scale = max(tw / im.width, th / im.height)
    im = im.resize((round(im.width * scale), round(im.height * scale)), Image.LANCZOS)
    left, top = (im.width - tw) // 2, (im.height - th) // 2
    im.crop((left, top, left + tw, top + th)).save(path)
    return True


def main():
    ap = argparse.ArgumentParser(description="手绘风口播封面出图")
    ap.add_argument("--prompt", required=True, help="提示词文件（按 prompt-template.md 组装好的）")
    ap.add_argument("--ratio", required=True, choices=SIZES.keys())
    ap.add_argument("--style", action="append", default=[], help="风格参考图，传 2 张")
    ap.add_argument("--person", required=True, help="出镜人物照")
    ap.add_argument("--shot", action="append", default=[], help="可选：真实产品截图")
    ap.add_argument("--out", required=True, help="输出 PNG 的路径")
    ap.add_argument("--dry-run", action="store_true", help="不出图，只打印提示词和上传顺序")
    ap.add_argument("--timeout", type=int, default=900)
    a = ap.parse_args()

    out = os.path.abspath(a.out)
    images = [os.path.abspath(p) for p in a.style + [a.person] + a.shot]
    for p in images:
        if not os.path.exists(p):
            sys.exit(f"❌ 找不到附件：{p}")
    w, h = SIZES[a.ratio]
    body = open(a.prompt, encoding="utf-8").read()

    if a.dry_run:
        roles = (["风格参考"] * len(a.style)) + ["人物照"] + (["截图"] * len(a.shot))
        print("=== 按这个顺序上传图片 ===")
        for i, (p, r) in enumerate(zip(images, roles), 1):
            print(f"图 {i}（{r}）：{p}")
        print(f"\n=== 然后粘贴下面的提示词（目标 {a.ratio}，{w}×{h}）===\n")
        print(f"目标尺寸：{a.ratio}，{w}×{h}。\n\n{body}")
        return

    if os.path.exists(out):
        sys.exit(f"❌ {out} 已存在。不覆盖旧版本，换个版本号（_v2）再跑。")
    if not shutil.which("codex"):
        sys.exit("❌ 没找到 codex 命令。加 --dry-run 拿提示词，去别的生图工具里出图。")

    head = (
        "请用你的内置图片生成工具（image_gen）生成一张图。"
        f"生成后把图片文件复制到这个绝对路径：{out}。不要做别的事，不要修改任何其他文件。\n"
        f"目标尺寸：{a.ratio}，{w}×{h}。\n\n"
    )
    os.makedirs(os.path.dirname(out), exist_ok=True)

    cmd = ["codex", "exec", "--skip-git-repo-check", "-s", "workspace-write",
           "-C", os.path.dirname(out)]
    for p in images:
        cmd += ["-i", p]
    cmd += ["-"]

    log = tempfile.NamedTemporaryFile("w", suffix=".log", delete=False, prefix="gen_cover_")
    print(f"→ Codex 出图中（{a.ratio}，附件 {len(images)} 张），日志：{log.name}", flush=True)
    try:
        subprocess.run(cmd, input=head + body, text=True, stdout=log, stderr=subprocess.STDOUT,
                       timeout=a.timeout, check=False)
    except subprocess.TimeoutExpired:
        sys.exit(f"❌ 超时 {a.timeout}s，看日志：{log.name}")

    if not os.path.exists(out):
        sys.exit(f"❌ Codex 没有把图写到 {out}。看日志：{log.name}\n"
                 "   图可能还在 ~/.codex/generated_images/ 里，按时间找最新一张。")
    if fit_exact(out, (w, h)):
        print(f"  已居中裁切到 {w}×{h}")
    print(f"✅ {out}")


if __name__ == "__main__":
    main()
