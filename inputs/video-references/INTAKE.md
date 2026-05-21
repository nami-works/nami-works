# Video reference intake — `/video-director` IP teardown

Drop references here so we can extract the shot grammar that powers the skill. Without this, the skill is a Sora wrapper.

## What to drop in this folder

- **5 to 15 references total**, mixed across the three lanes below.
- **Winners** (the 3x-growth case + competitor benchmarks you respect).
- **2 to 3 anti-examples** (videos that look fine but underperformed, or generic product-spinning clichés). Knowing what NOT to do is as valuable as knowing what to do.

## How to add each reference

For every video, do BOTH:

1. **File or link**
   - Local: drop the `.mp4` / `.mov` in this folder named `ref-<NN>-<short-slug>.mp4` (e.g. `ref-01-fragrance-mist-hero.mp4`).
   - Remote: add the URL to the table below. YouTube/Vimeo/TikTok/Meta Ad Library links all fine.

2. **Row in the table below** with the metadata I need to do a structured teardown.

## Reference table

| # | File / URL | Lane | Brand | Length | Why it worked (or didn't) | Known metric |
|---|---|---|---|---|---|---|
| 01 | `ref-01-...` | sensorial | GE Beauty | 15s | Macro pour + light bloom, drove 3x ROAS on cold MX traffic | ROAS 3.1, CTR 2.4% |
| 02 | _example row, replace_ | direct-response | _competitor_ | 9s | _hook in 1s, captions sell benefit, weak end card_ | _CTR 1.8%_ |
| ... | | | | | | |

**Lane values:** `sensorial` · `direct-response` · `hybrid`
**Length:** seconds, e.g. `6s`, `15s`, `30s`.

## What I do once you've populated this

For each reference I'll produce a teardown card in `docs/video-director-ip.md` covering:

- **Beat sheet** (timecoded: 0-1.5s hook, 1.5-6s payoff, 6-12s reinforcement, 12-15s CTA, etc.)
- **Shot vocabulary used** (e.g. `macro pour`, `surface tension reveal`, `light bloom`, `mist puff`)
- **Transitions** (match-cut on motion, sound-led smash, mask wipe)
- **Sound design pairings** (visual beat → audio texture)
- **Framing rules** (aspect, headroom, product position, depth of field)
- **Copy density** (none / minimal / heavy captions)
- **Lane fit** and which prompts/models would best reproduce each shot

The aggregated patterns across all references become the encoded IP doc, which is the skill's actual moat.

## Status

- [ ] References dropped
- [ ] Table populated
- [ ] Teardown session run
- [ ] `docs/video-director-ip.md` draft written
- [ ] IP doc approved
- [ ] Skill code begins
