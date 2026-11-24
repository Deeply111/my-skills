#!/usr/bin/env python3
"""抽配色。三元组（bg / ink / pop）整体校验，不是只看两个撞色。

用法：
  # 审计整个色卡库（改完 palettes.json 必跑）
  python3 pick_palette.py --audit

  # 为一期封面抽 4 组（按人物衣服顺色过滤，避开近期用过的）
  python3 pick_palette.py --wardrobe 灰绿

  # 全走高级派 / 全走重击派
  python3 pick_palette.py --wardrobe 灰绿 --family 高级派

  # 换一批（不满意时重跑，会避开刚给过的）
  python3 pick_palette.py --wardrobe 灰绿 --reroll

  # 确认某期最终用了哪组，写进历史避免下期撞脸
  python3 pick_palette.py --commit navy-amber --slug 20260827_视频动效
"""
import argparse, colorsys, json, os, random, sys
from datetime import datetime

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "references", "palettes.json")
HISTORY = os.path.join(HERE, "..", "references", "used.json")

# —— 硬性门槛 ——
# 阈值不是拍脑袋定的：取自 5 张实战验证过的封面的实测下界（见 references/palette.md）。
# 关键决定：用 CIE Lab ΔE 感知色差，不用 WCAG 亮度对比度。
# 因为「米白底上的巨幅亮黄毛刷字」亮度差很小、彩度差极大，WCAG 会误判为不可读，
# 但它恰恰是点击率最好的封面之一。封面标题是巨字，靠的是彩度撞击而非亮度对比。
DE_INK_BG_MIN = 55      # 主色必须从纸底上跳出来（实战下界 59.0）
DE_POP_BG_MIN = 52      # 撞色必须从纸底上跳出来（实战下界 58.7）
DE_INK_POP_MIN = 55     # 主色与撞色必须互相分得开（实战下界 62.1）
POP_SAT_MIN = 0.55      # 「饱和度不能太低」：实战下界 0.66，留一点余量
INK_L_MAX = 45          # 主色要够深，才压得住大面积（实战上界 L*=41.0）
L_GAP_MIN = 12          # 撞色要比主色亮，明度差不够会糊成一团（实战下界 14.8）


def hex2rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))


def _srgb2lin(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def lab(h):
    """sRGB -> CIE L*a*b*（D65）"""
    r, g, b = (_srgb2lin(c) for c in hex2rgb(h))
    X = r * 0.4124 + g * 0.3576 + b * 0.1805
    Y = r * 0.2126 + g * 0.7152 + b * 0.0722
    Z = r * 0.0193 + g * 0.1192 + b * 0.9505
    Xn, Yn, Zn = 0.95047, 1.0, 1.08883

    def f(t):
        return t ** (1 / 3) if t > 0.008856 else 7.787 * t + 16 / 116

    fx, fy, fz = f(X / Xn), f(Y / Yn), f(Z / Zn)
    return (116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz))


def delta_e(a, b):
    """CIE76 感知色差。40+ 明显不同，55+ 强烈区分。"""
    return sum((x - y) ** 2 for x, y in zip(lab(a), lab(b))) ** 0.5


def saturation(h):
    r, g, b = hex2rgb(h)
    return colorsys.rgb_to_hls(r, g, b)[2]


def audit_one(p):
    """返回 (是否通过, [问题列表], 指标 dict)"""
    bg, ink, pop = p["bg"], p["ink"], p["pop"]
    m = {
        "de_ink_bg": round(delta_e(ink, bg), 1),
        "de_pop_bg": round(delta_e(pop, bg), 1),
        "de_ink_pop": round(delta_e(ink, pop), 1),
        "pop_sat": round(saturation(pop), 2),
        "L_ink": round(lab(ink)[0], 1),
        "L_pop": round(lab(pop)[0], 1),
    }
    m["L_gap"] = round(m["L_pop"] - m["L_ink"], 1)
    bad = []
    if m["de_ink_bg"] < DE_INK_BG_MIN:
        bad.append(f"主色对底色色差 {m['de_ink_bg']} < {DE_INK_BG_MIN}（标题从纸底上跳不出来）")
    if m["de_pop_bg"] < DE_POP_BG_MIN:
        bad.append(f"撞色对底色色差 {m['de_pop_bg']} < {DE_POP_BG_MIN}（钩子词在缩略图上糊掉）")
    if m["de_ink_pop"] < DE_INK_POP_MIN:
        bad.append(f"主色与撞色色差 {m['de_ink_pop']} < {DE_INK_POP_MIN}（撞不起来，像同一个色）")
    if m["pop_sat"] < POP_SAT_MIN:
        bad.append(f"撞色饱和度 {m['pop_sat']} < {POP_SAT_MIN}（太灰，亮得不够）")
    if m["L_ink"] > INK_L_MAX:
        bad.append(f"主色明度 L*={m['L_ink']} > {INK_L_MAX}（不够深，压不住大面积文字）")
    if m["L_gap"] < L_GAP_MIN:
        bad.append(f"撞色比主色只亮 {m['L_gap']}（< {L_GAP_MIN}，两色会糊成一团）")
    if p.get("ink2") and delta_e(p["ink2"], bg) < DE_INK_BG_MIN:
        bad.append(f"INK2 对底色色差 {round(delta_e(p['ink2'], bg), 1)} 偏低")
    return (not bad), bad, m


def load():
    with open(DATA, encoding="utf-8") as f:
        return json.load(f)


def load_history():
    if not os.path.exists(HISTORY):
        return []
    with open(HISTORY, encoding="utf-8") as f:
        return json.load(f).get("used", [])


def cmd_audit():
    data = load()
    fails = 0
    for p in data["palettes"]:
        ok, bad, m = audit_one(p)
        mark = "✅" if ok else "❌"
        print(f"{mark} {p['id']:<24} {p['name']:<18} [{p['family']}] "
              f"ΔE ink/bg={m['de_ink_bg']:>5}  pop/bg={m['de_pop_bg']:>5}  "
              f"ink/pop={m['de_ink_pop']:>5}  popS={m['pop_sat']:.2f}  ΔL={m['L_gap']:>5}")
        for b in bad:
            print(f"     └─ {b}")
        fails += 0 if ok else 1
    print(f"\n共 {len(data['palettes'])} 组，{fails} 组不合格。")
    return 1 if fails else 0


DIVERSITY_MIN = 22   # 同一批 4 版之间，主色或撞色至少要差这么多，否则看起来是同一版


def too_similar(cand, chosen):
    """4 版之间必须互相看得出差别：主色和撞色都接近就判为重复。"""
    for c in chosen:
        if delta_e(cand["ink"], c["ink"]) < DIVERSITY_MIN and delta_e(cand["pop"], c["pop"]) < DIVERSITY_MIN:
            return True
    return False


def take_diverse(pool, n, chosen=None):
    """贪心挑 n 组，跳过与已选过于接近的。"""
    out = list(chosen or [])
    base = len(out)
    for p in pool:
        if len(out) - base >= n:
            break
        if not too_similar(p, out):
            out.append(p)
    return out[base:]


def cmd_pick(args):
    data = load()
    pool = data["palettes"]

    if args.family:
        pool = [p for p in pool if p["family"] == args.family]

    # 顺色过滤：衣服色在 wardrobe 里的优先；一个都不匹配就退回全池并说明
    matched = [p for p in pool if args.wardrobe and args.wardrobe in p["wardrobe"]]
    note = ""
    if args.wardrobe and not matched:
        note = f"⚠️  没有色卡标注顺色「{args.wardrobe}」，已退回全池——请人工确认人物衣服不会和 INK/POP 打架。"
        matched = pool
    elif args.wardrobe:
        note = f"顺色过滤「{args.wardrobe}」：{len(matched)}/{len(pool)} 组通过。"
    else:
        matched = pool

    # 只保留审计通过的
    matched = [p for p in matched if audit_one(p)[0]]

    # 避开最近 4 期用过的
    recent = set(load_history()[-4:])
    fresh = [p for p in matched if p["id"] not in recent]
    if len(fresh) >= args.n:
        matched = fresh
    elif recent:
        note += f"\n⚠️  可选组不足，已允许复用近期色卡（近 4 期用过：{', '.join(recent) or '无'}）。"

    rng = random.Random(args.seed) if args.seed is not None else random.Random()
    rng.shuffle(matched)

    picks = []
    if not args.family:
        # 默认 3 组重击派 + 1 组高级派，让用户同时看到两种可能
        punch = [p for p in matched if p["family"] == "重击派"]
        fine = [p for p in matched if p["family"] == "高级派"]
        picks += take_diverse(punch, 3, picks)
        picks += take_diverse(fine, 1, picks)
    else:
        picks += take_diverse(matched, args.n, picks)

    # 还没凑够就放宽差异化要求，但优先从没选过的里补
    if len(picks) < args.n:
        rest = [p for p in matched if p not in picks]
        picks += rest[:args.n - len(picks)]
        note_extra = "\n⚠️  可选色卡不足，最后几版的差异度已放宽。"
    else:
        note_extra = ""
    picks = picks[:args.n]

    note = (note + note_extra).strip()
    out = {"note": note, "picks": picks}
    if args.json:
        print(json.dumps(out, ensure_ascii=False, indent=2))
        return 0

    if note:
        print(note + "\n")
    for i, p in enumerate(picks, 1):
        _, _, m = audit_one(p)
        ink2 = f"  INK2 {p['ink2']}" if p.get("ink2") else ""
        assist = f"  assist {p['assist']}" if p.get("assist") else ""
        print(f"【第 {i} 版】{p['name']}  [{p['family']}]  id={p['id']}")
        print(f"   BG {p['bg']}   INK {p['ink']}{ink2}   POP {p['pop']}{assist}")
        print(f"   顺色衣服：{'、'.join(p['wardrobe'])}")
        print(f"   适合：{p['mood']}")
        print(f"   色差 ink/bg={m['de_ink_bg']}  pop/bg={m['de_pop_bg']}  ink/pop={m['de_ink_pop']}  撞色饱和 {m['pop_sat']}\n")
    return 0


def cmd_commit(pid, slug):
    data = load()
    if pid not in {p["id"] for p in data["palettes"]}:
        print(f"❌ 没有这个色卡 id：{pid}", file=sys.stderr)
        return 1
    used = load_history()
    used.append(pid)
    rec = {"used": used, "log": []}
    if os.path.exists(HISTORY):
        with open(HISTORY, encoding="utf-8") as f:
            rec["log"] = json.load(f).get("log", [])
    rec["log"].append({"date": datetime.now().strftime("%Y-%m-%d"), "slug": slug, "palette": pid})
    with open(HISTORY, "w", encoding="utf-8") as f:
        json.dump(rec, f, ensure_ascii=False, indent=2)
    print(f"✅ 已记录：{slug} 用了 {pid}。下 4 期会避开它。")
    return 0


def main():
    ap = argparse.ArgumentParser(description="手绘封面配色抽选器")
    ap.add_argument("--audit", action="store_true", help="审计整个色卡库")
    ap.add_argument("--wardrobe", help="人物衣服主色，如 灰绿 / 藕紫 / 米白")
    ap.add_argument("--family", choices=["重击派", "高级派"], help="只抽某一派")
    ap.add_argument("-n", type=int, default=4, help="抽几组，默认 4")
    ap.add_argument("--seed", type=int, help="固定随机种子（复现用）")
    ap.add_argument("--reroll", action="store_true", help="换一批（等价于不给 seed）")
    ap.add_argument("--json", action="store_true", help="输出 JSON")
    ap.add_argument("--commit", help="记录本期最终用了哪组色卡（传 id）")
    ap.add_argument("--slug", default="", help="配合 --commit，本期标识")
    a = ap.parse_args()

    if a.audit:
        return cmd_audit()
    if a.commit:
        return cmd_commit(a.commit, a.slug)
    return cmd_pick(a)


if __name__ == "__main__":
    sys.exit(main())
