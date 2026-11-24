"""音乐地图：分析配乐原速版，标出节拍、强拍、换段、情绪起落（准备工作，只做一次）。

用法：uv run --no-project --python 3.12 --with librosa --with matplotlib --with "numba==0.67.*" python music_map.py [--src 音乐/原速.mp3]
      numba 钉在 0.67：Windows 智能应用控制会拦 0.68 的 DLL
输出（都在 音乐/）：
  音乐地图.json   节拍、强拍、换段、情绪曲线；0.9、0.8 倍速版的时间 = 原速时间 / 速度
  波形图.png      响度、亮度曲线上标出换段和强拍，验证和排时间用
  校验.mp3        配乐叠咔哒声：强拍高音、普通拍低音、换段处一声钟，给人耳复核用
"""
import argparse, json
from pathlib import Path
import numpy as np
import librosa

MUSIC = Path(__file__).resolve().parent.parent / '音乐'
ap = argparse.ArgumentParser()
ap.add_argument('--src', default=str(MUSIC / '原速.mp3'))
a = ap.parse_args()

y, sr = librosa.load(a.src, sr=22050, mono=True)
dur = len(y) / sr
hop = 512

# ---------- 节拍 ----------
onset = librosa.onset.onset_strength(y=y, sr=sr, hop_length=hop)
tempo, beat_f = librosa.beat.beat_track(onset_envelope=onset, sr=sr, hop_length=hop)
beats = librosa.frames_to_time(beat_f, sr=sr, hop_length=hop)
bpm = float(np.atleast_1d(tempo)[0])

# ---------- 强拍：四拍一小节，哪个相位上低频和起音最重 ----------
S = np.abs(librosa.stft(y, hop_length=hop))
freqs = librosa.fft_frequencies(sr=sr)
low = S[freqs < 150].sum(0)
low = low / (low.max() + 1e-9)
on = onset / (onset.max() + 1e-9)
acc = np.array([low[f] + on[f] for f in beat_f])
phase_score = [acc[p::4].mean() for p in range(4)]
ph = int(np.argmax(phase_score))
downbeats = beats[ph::4]

# ---------- 乐句和换段：以 4 小节为一句；相邻两句在响度、亮度、音色、和声上变化大的地方就是换段 ----------
bpm = 60 / float(np.mean(np.diff(beats)))   # 用平均拍距算：拍点落在帧格上，单个拍距会在两个值之间跳
t_s = librosa.frames_to_time(np.arange(S.shape[1]), sr=sr, hop_length=hop)
rms_s = librosa.feature.rms(S=S)[0]; cen_s = librosa.feature.spectral_centroid(S=S, sr=sr)[0]
mfcc = librosa.feature.mfcc(y=y, sr=sr, hop_length=hop, n_mfcc=13)
chroma = librosa.feature.chroma_cqt(y=y, sr=sr, hop_length=hop)
phr = np.r_[downbeats[::4], dur]   # 乐句起点
F = []
for s0, s1 in zip(phr[:-1], phr[1:]):
    m_ = (t_s >= s0) & (t_s < s1)
    F.append((20 * np.log10(rms_s[m_].mean() + 1e-9), cen_s[m_].mean(), mfcc[:, m_[:mfcc.shape[1]]].mean(1), chroma[:, m_[:chroma.shape[1]]].mean(1)))
z = lambda v: (v - v.mean()) / (v.std() + 1e-9)
cosd = lambda u, v: 1 - u @ v / (np.linalg.norm(u) * np.linalg.norm(v) + 1e-9)
dL = np.array([abs(F[i][0] - F[i - 1][0]) for i in range(1, len(F))])
dB = np.array([abs(F[i][1] - F[i - 1][1]) / max(F[i][1], F[i - 1][1]) for i in range(1, len(F))])
dT = np.array([cosd(F[i][2], F[i - 1][2]) for i in range(1, len(F))])
dC = np.array([cosd(F[i][3], F[i - 1][3]) for i in range(1, len(F))])
score = z(dL) + z(dB) + z(dT) + z(dC)
# 换段：综合变化大，或者响度差 3 dB 以上，或者亮度变了三成以上；第一句里的小变化不算
bounds = [float(phr[i]) for i in range(1, len(F)) if (score[i - 1] > 1.5 or dL[i - 1] > 3 or dB[i - 1] > .3) and phr[i] > 10]
phrases = [round(float(v), 2) for v in phr[:-1]]

# ---------- 情绪：响度和亮度，每 0.5 秒一格，平滑 2 秒 ----------
rms = librosa.feature.rms(y=y, hop_length=hop)[0]
cent = librosa.feature.spectral_centroid(y=y, sr=sr, hop_length=hop)[0]
t_f = librosa.frames_to_time(np.arange(len(rms)), sr=sr, hop_length=hop)
grid = np.arange(0, dur, .5)
def curve(v):
    v = np.interp(grid, t_f, v); k = 4
    v = np.convolve(np.pad(v, k, mode='edge'), np.ones(2 * k + 1) / (2 * k + 1), 'valid')
    return (v - v.min()) / (np.ptp(v) + 1e-9)
loud, bright = curve(rms), curve(cent)

edges = [0.0] + bounds + [dur]
top = max(f[0] for f in F)
secs = []
for s0, s1 in zip(edges[:-1], edges[1:]):
    idx = [i for i in range(len(F)) if s0 - .1 <= phr[i] < s1 - .1]
    dbs_ = [F[i][0] for i in idx]; Lr = float(np.mean(dbs_) - top)
    level = '满' if Lr > -1.5 else ('中' if Lr > -5 else '安静')
    move = '推高' if dbs_[-1] - dbs_[0] > 1.5 else ('回落' if dbs_[0] - dbs_[-1] > 1.5 else '平')
    tone = '亮' if np.mean([F[i][1] for i in idx]) > 1800 else '暗'
    secs.append({'起': round(s0, 2), '止': round(s1, 2), '小节数': int(round((s1 - s0) / (240 / bpm))), '响度dB': round(Lr, 1), '程度': level, '走向': move, '音色': tone})
# 重拍点：从不满的段落进入「满」的那一下，适合放揭晓和最重的切换
hits = [secs[i]['起'] for i in range(1, len(secs)) if secs[i]['程度'] == '满' and secs[i - 1]['程度'] != '满']

out = {
    '配乐': Path(a.src).name, '时长': round(dur, 2), 'BPM': round(bpm, 1), '每拍秒': round(60 / bpm, 4),
    '倍速换算': '0.9、0.8 倍速版的任何时间点 = 原速时间 / 速度',
    '节拍': [round(float(b), 3) for b in beats],
    '强拍': [round(float(b), 3) for b in downbeats],
    '换段': [round(b, 2) for b in bounds],
    '段落': secs,
    '乐句': phrases,
    '重拍点': hits,
    '响度曲线': [round(float(v), 3) for v in loud], '亮度曲线': [round(float(v), 3) for v in bright], '曲线间隔秒': .5,
}
(MUSIC / '音乐地图.json').write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding='utf-8')

# ---------- 校验：拍子对不对齐（起音强度在拍点上的峰 vs 拍间） ----------
off = int(round(60 / bpm / 2 * sr / hop))
on_b = on[beat_f].mean(); on_mid = on[np.clip(beat_f + off, 0, len(on) - 1)].mean()
print(f'BPM {bpm:.1f}；强拍相位 {ph}（四个相位得分 {", ".join(f"{s:.2f}" for s in phase_score)}）')
print(f'起音强度：拍点上 {on_b:.3f}，拍与拍中间 {on_mid:.3f}，比值 {on_b / (on_mid + 1e-9):.2f}（大于 1.3 说明拍子落在起音上）')
print('换段：' + '、'.join(f'{b:.1f}' for b in bounds))
for s in secs: print(f"  {s['起']:6.1f}–{s['止']:6.1f}  {s['小节数']:2d} 小节  {s['程度']}  {s['走向']}  {s['音色']}")
print('重拍点：' + '、'.join(f'{h:.1f}' for h in hits))

# ---------- 波形图 ----------
import matplotlib; matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib import font_manager
font_manager.fontManager.addfont('C:/Windows/Fonts/simhei.ttf'); plt.rcParams['font.family'] = 'SimHei'
fig, ax = plt.subplots(2, 1, figsize=(18, 7), gridspec_kw={'height_ratios': [1, 2]}, sharex=True)
tt = np.arange(len(y)) / sr
ax[0].plot(tt[::50], y[::50], color='#7a8aa0', lw=.4); ax[0].set_yticks([]); ax[0].set_title('波形（原速）', loc='left')
ax[1].plot(grid, loud, color='#3a6fb0', lw=2, label='响度'); ax[1].plot(grid, bright, color='#c9902a', lw=1.2, alpha=.7, label='亮度')
for b in downbeats: ax[1].axvline(b, color='#999', lw=.3, alpha=.5)
colors = {'安静': '#dfe8f3', '中': '#f3ecd9', '满': '#f6d5c2'}
for s in secs:
    ax[1].axvspan(s['起'], s['止'], color=colors[s['程度']], alpha=.6, zorder=0)
    ax[1].text((s['起'] + s['止']) / 2, 1.03, f"{s['程度']}·{s['走向']}·{s['音色']}", ha='center', fontsize=10)
for b in bounds:
    for x_ in ax: x_.axvline(b, color='#c0392b', lw=1.5)
    ax[1].text(b, -.1, f'{b:.1f}', color='#c0392b', ha='center', fontsize=9)
for h in hits: ax[1].axvline(h, color='#8e44ad', ls='--', lw=1.5); ax[1].text(h, .95, ' 重拍点', color='#8e44ad')
for p_ in phrases: ax[0].axvline(p_, color='#c8a050', lw=.8, alpha=.8)
ax[1].set_ylim(-.15, 1.1); ax[1].set_xlim(0, dur); ax[1].legend(loc='lower right'); ax[1].set_xlabel('秒（原速）')
ax[1].set_xticks(np.arange(0, dur, 10))
fig.suptitle(f'若如初见 · 音乐地图　BPM {bpm:.1f}　红线＝换段，金线（上）＝乐句，灰线＝强拍，紫虚线＝重拍点，底色＝段落强弱', x=.01, ha='left')
fig.tight_layout(); fig.savefig(MUSIC / '波形图.png', dpi=110)

# ---------- 校验音频：配乐叠咔哒 ----------
y2, sr2 = librosa.load(a.src, sr=44100, mono=True)
def tick(f, d=.04, amp=.35):
    n = int(d * sr2); t = np.arange(n) / sr2; return amp * np.sin(2 * np.pi * f * t) * np.exp(-t * 60)
mix = y2 * .7
dbs = set(np.round(downbeats, 3))
for b in beats:
    k = tick(1800 if round(float(b), 3) in dbs else 1000); i = int(b * sr2); mix[i:i + len(k)] += k[:len(mix) - i]
for b in bounds:
    n = int(1.2 * sr2); t = np.arange(n) / sr2; k = .5 * np.sin(2 * np.pi * 660 * t) * np.exp(-t * 3); i = int(b * sr2); mix[i:i + n] += k[:len(mix) - i]
import soundfile as sf, subprocess, tempfile, os
tmp = os.path.join(tempfile.gettempdir(), 'music_map_check.wav'); sf.write(tmp, np.clip(mix, -1, 1), sr2)
subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', tmp, '-b:a', '192k', str(MUSIC / '校验.mp3')]); os.remove(tmp)
print('写好：音乐地图.json、波形图.png、校验.mp3')
