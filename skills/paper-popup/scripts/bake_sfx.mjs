// node $SKILL/scripts/bake_sfx.mjs index.html data/caps.js data/sfx_cues.js  (run again whenever cues or captions change)
// Turns the cue list into <audio> tags between <!-- sfx:begin --> and <!-- sfx:end --> in the page.
import fs from "node:fs"; import vm from "node:vm";
const [page, capsFile, cuesFile] = process.argv.slice(2);
const ctx = { window: {} }; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(capsFile, "utf8"), ctx); vm.runInContext(fs.readFileSync(cuesFile, "utf8"), ctx);
const CAPS = ctx.window.CAPS;
const W = (id, ch, n = 1) => { const c = CAPS.find((x) => x.id === id); if (!c) throw Error(`no caption ${id}`);
  const h = c.u.filter((x) => x[0][0] === ch)[n - 1]; if (!h) throw Error(`no 「${ch}」 in ${id}`); return h[1]; };
// sound: [variants, default volume, default length]
const SET = { fold: [4, .30, .3], flop: [3, .16, .3], press: [2, .30, .38], tap: [4, .30, .2], draw: [2, .20, 1.1],
              rustle: [2, .22, .7], tick: [3, .28, .22], thump: [1, .50, .7] };
const used = {};
const cues = ctx.window.SFX_CUES(W).sort((a, b) => a[1] - b[1]);
const tags = cues.map(([name, t, o = {}], i) => {
  const [n, vol, len] = SET[name]; used[name] = (used[name] || 0) % n + 1;
  // the renderer only finds <audio> that has an id; without one it is silent
  return `  <audio id="sfx-${String(i + 1).padStart(2, "0")}-${name}" src="assets/sfx/${name}_${used[name]}.wav" data-start="${Math.max(0, t).toFixed(3)}" data-duration="${(o.dur || len).toFixed(3)}" data-track-index="${6 + (i % 6)}" data-volume="${o.vol || vol}"></audio>`;
});
for (let i = 1; i < cues.length; i++) if (cues[i][1] - cues[i - 1][1] < 0.15) console.log(`! ${cues[i - 1][0]}@${cues[i - 1][1].toFixed(2)} and ${cues[i][0]}@${cues[i][1].toFixed(2)} are closer than 0.15 s`);
let s = fs.readFileSync(page, "utf8");
const re = /<!-- sfx:begin -->[\s\S]*?<!-- sfx:end -->/;
if (!re.test(s)) throw Error("page has no <!-- sfx:begin --> … <!-- sfx:end --> block");
s = s.replace(re, `<!-- sfx:begin -->\n${tags.join("\n")}\n  <!-- sfx:end -->`);
fs.writeFileSync(page, s);
console.log(`baked ${tags.length} sounds into ${page}`);
