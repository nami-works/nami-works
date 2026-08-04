# /video-director — GE Beauty creative tooling

Autonomous video-creative director skill for GE Beauty. Takes a Shopify product, reasons through the brand's locked constitution, generates Meta-ready ad packages with one approval gate.

## Quick orientation

**Read first:** [HANDOVER.md](HANDOVER.md) — full brain-transfer from the originating session. Status, decisions, lessons learned, next steps.

**Pipeline:**

```
   Product GID (Shopify)
        │
        ▼
   ┌────────────────────────────────────────┐
   │ The 5-step in-session brain            │
   │   1. Ingest (Shopify metafields)        │
   │   2. Benefit → Moment mapping (LLM)     │
   │   3. Narrative sequencer (LLM)          │
   │   4. Shot synthesizer (LLM)             │
   │   5. Ad copy generator (LLM)            │
   └─────┬──────────────────────────────────┘
         │
         ▼
   BUDGET GATE (Lucas approves estimated $)
         │
         ▼
   ┌────────────────────────────────────────┐
   │ Render + assemble pipeline             │
   │   6. Dispatch shots to fal.ai (parallel)│
   │   7. Auto-review (1-5 rubric)           │
   │   8. ffmpeg assemble (concat + audio +  │
   │      captions + closing card)           │
   │   9. Drop folder + README               │
   └─────┬──────────────────────────────────┘
         │
         ▼
   state/<concept>/output/ ── 3 packages ──> traffic specialist uploads to Meta
   (base + variant A + variant B)
```

## Status

- **Phases 0-4 done:** constitution, metafield map, fal wrapper, state schema, brain protocol
- **Phase 4 validated:** end-to-end on `primer-cachos-definidos-v1` — 3 shots rendered, reviewed PASS, state at `ALL_PASS`
- **Phase 6-9 pending:** ffmpeg assembler, variants, drop folder
- **Spent:** $3.42 of $20 cap (this concept) / $5.46 across all session work

## What's in this directory

| Path | Purpose |
|---|---|
| [HANDOVER.md](HANDOVER.md) | Full brain transfer from the originating session — READ FIRST |
| [docs/ip.md](docs/ip.md) | The constitution. Persona, brand grammar, shot archetypes, prompt anti-patterns. Every reasoning step reads this. |
| [docs/metafield-map.md](docs/metafield-map.md) | Shopify metafield discovery — which fields carry the benefits + paired images |
| [docs/state-schema.md](docs/state-schema.md) | state.json shape and lifecycle invariants |
| [docs/concepts.md](docs/concepts.md) | v2 per-product concept doc — 14 hero SKUs |
| [docs/prototype-pluma.md](docs/prototype-pluma.md) | Parked: leave-in pluma prototype storyboard |
| [docs/prototype-primers.md](docs/prototype-primers.md) | Parked: primers resistance prototype storyboard |
| [scripts/fal_wrapper.py](scripts/fal_wrapper.py) | Thin wrapper around fal-client SDK |
| [scripts/state.py](scripts/state.py) | state.json helpers with file-lock discipline + validation |
| [scripts/bake_off.py](scripts/bake_off.py) | Reusable model bake-off runner |
| [state/primer-cachos-definidos-v1/](state/primer-cachos-definidos-v1/) | First product run — state.json + 3 rendered MP4s |

Plus, elsewhere in nami-works:

- **Skill:** `.claude/skills/video-director/SKILL.md` (the in-session protocol)
- **Brand assets:** `gebeauty/.brand-assets/Logo/` (Google Drive sync)
- **Brandbook:** `gebeauty/brandbook/_manualGEbeauty_final.pdf` (43 pages)

## Quick commands

```bash
# Verify env loads (FAL_KEY must be set in nami-works/.env)
python -c "from dotenv import load_dotenv; load_dotenv(); import os; assert os.environ.get('FAL_KEY')"

# Read the previous run's state
python -c "
import sys; sys.path.insert(0, 'gebeauty/video-director/scripts')
from state import read_state
s = read_state('primer-cachos-definidos-v1')
print(f'{s[\"concept_id\"]}: {s[\"state\"]}, {len(s[\"shots\"])} shots, spent ${s[\"budget\"][\"spent_usd\"]}')
"

# Smoke-test the state helpers
python gebeauty/video-director/scripts/state.py
```

## Invoke the skill

```
/video-director status --concept-id primer-cachos-definidos-v1
/video-director start --product-gid gid://shopify/Product/<id> --concept-id <slug>
```

## What's next

Phase 6 (ffmpeg assembler) is the unlock. See HANDOVER.md → "Next steps in priority order".

## Brand non-negotiables

- Faceless + hair-out (AI-gen rule)
- Marcela persona voice (smart-friend, lowercase, no em-dashes)
- Tagline locked: `no seu tempo, do seu jeito.`
- Calm body + kinetic hook moment
- Invisible field via behavior only (no `field`/`bubble`/`dome`/`shield` nouns)
- 9-color palette from brandbook page 14
- 2 captions per video maximum (hook + offer)

When in doubt, [docs/ip.md](docs/ip.md) wins.
