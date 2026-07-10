# Flower · Lighter — live STATUS (handoff across /compact, 2026-06-15)

Full motion plan: `MOTION-PLAN.md` (5-clip end-to-end). Latest full concat v2 rendered but REJECTED by Lucas → 3 keyframe fixes in flight, THEN full clip regen.

## LOCKED — 3 still regens (Lucas picked 2026-06-15)
1. **01_APP-START** — 2 fingers + pump touching → **`Te9wWAJVNR`** (locked)
2. **05_EXP-lighter-END** — no smoke, lighter off → **`WMygzztcXe`** (locked)
3. **06_EXP-lighter-BEAT2** — flame off, lighter at right → **`SOQhlzHUb8`** (locked)

## RE-RENDER DONE — awaiting Lucas review of `flower-lighter_FULL-ASMR.mp4` (37.3s)
Clip creation IDs (all 1080p/9:16/24fps, withSoundEffects):
- clip1 12s `ubpcsIkQLD` (01-new → 02 `VdNIybUMMU`)
- clip2 4s `SOQmBQ8Ub8` (REUSED, 02 → 03, unchanged)
- clip3 10s `9RrqDR3NYZ` (03 `cDPB7q70eP` → 05-new `WMygzztcXe`)
- clip4 5s `KjIe7dNkqp` (05-new → 06-new `SOQhlzHUb8`)
- clip5 6s `YVOghoCWeC` (06-new → clip5end `3GsKLpKREY`)
Local clips in `clips/REGEN-clip{1..5}*.mp4`; concat → `clips/flower-lighter_FULL-ASMR.mp4` + `_VALIDATION/`.
**Credit note:** parallel video_generate reserves credits per-job; firing >1 big clip at once trips instant-fail on the floor. SERIALIZE big clips (one at a time); auto-top-up (+10k) refills between.

## Revised keyframe flow (re-render all 5 clips after the 3 fixes land)
- **clip1** (01-new → 02 `VdNIybUMMU`) 12s: pump 3× + **5–7 fingertip strokes** across right bloom.
- **clip2** (02 → 03 `cDPB7q70eP`) 4s: finger exits right. (prior render OK: `SOQmBQ8Ub8`)
- **clip3** (03 → 05-new) ~7s: lighter enters off → clicks → ignites → burns LEFT → turns OFF; smoke ceases by END. (prior `cDPgx6w0eP` used old 05)
- **clip4** (05-new → 06-new) ~4s: lighter (off) slides LEFT→RIGHT, no smoke.
- **clip5** (06-new → clip5END `3GsKLpKREY` = flame sweeps right, right pristine, no smoke) 6s: lighter REIGNITES at right, flame sweeps across, RIGHT stays pristine (dual-keyframe pins no-change).

## Concat (imageio_ffmpeg, 5-way, 1080x1920/24fps) → `clips/flower-lighter_FULL-ASMR.mp4` + copy to `_VALIDATION/`.

## Engines / budget
- Magnific Seedance `bytedance-seedance-pro-2.0`, withSoundEffects, loud ASMR. ~4,264 cr / 6s clip. **Auto-top-up ON.**
- Krea OUT (402) — Magnific-only for now. Krea client: `gebeauty/scripts/_krea.py`.

## After flower-lighter is approved
Roll same end-to-end treatment to: **flower dryer**, **flower flat-iron**, then **ribbon** ×3 (lighter/dryer/flat-iron) + **ribbon application**. All exposure STARTs+ENDs already locked in each `_shared-exposure/<agg>/<ver>/seeds/` with `_MOTION-NOTE.txt` (equal-exposure + aggressor-physics). Flower application clips already rendered (both engines). Closing cards + copy = later (Lucas: application+exposure only for now).
