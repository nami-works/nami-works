# Phase 3 — state.json schema

**Purpose:** every video the system produces gets a `state.json` file that tracks the full lifecycle from brief to delivered package. The state file is the source of truth — every component (brain, router, fal client, poller, reviewer, assembler) reads from and writes to it. The polling cron, the auto-review loop, and the human (Lucas) all coordinate through this one file. If the session crashes mid-render, the state file lets us resume from any checkpoint without losing work.

**Location:** `inputs/video-prototypes/<concept>/state.json`. One file per video concept (a concept can produce multiple variants — see §variants below — but they share one state file).

**Format:** JSON, human-readable, git-trackable. Always pretty-printed (4-space indent) so diffs are reviewable.

---

## Top-level shape

```json
{
  "schema_version": 1,
  "concept_id": "primers-resistance-cachos",
  "concept_label": "primers resistance (cachos definidos)",
  "created_at": "2026-05-24T14:32:00Z",
  "updated_at": "2026-05-24T14:48:22Z",
  "state": "RENDERING",
  "product": { ... },
  "brief": { ... },
  "constitution_refs": { ... },
  "benefits": [ ... ],
  "benefit_images": [ ... ],
  "moments": [ ... ],
  "narrative_arc": [ ... ],
  "shots": [ ... ],
  "ad_copy": { ... },
  "variants": [ ... ],
  "budget": { ... },
  "assembly": { ... },
  "delivery": { ... },
  "events": [ ... ]
}
```

### `state` (the top-level state machine)

| Value | Meaning | Next gate |
|---|---|---|
| `DRAFT` | Concept selected, brief not yet defined | brief schema-validates → STORYBOARD |
| `BRIEF_LOCKED` | Brief approved, brain hasn't run | brain runs → STORYBOARD |
| `STORYBOARD` | Brain has emitted shots[]+copy, awaiting budget approval | **MANDATORY budget gate** → QUEUED |
| `QUEUED` | Shots dispatched to fal.ai queue | poll loop progresses each shot |
| `RENDERING` | At least one shot still running, none failed irrecoverably | each shot completes → AUTO_REVIEW |
| `AUTO_REVIEW` | All shots downloaded, reviewer scoring in progress | each shot scored → PASS or REGEN_QUEUED |
| `REGEN_QUEUED` | At least one shot failed review, regen pending | new render → AUTO_REVIEW |
| `ALL_PASS` | All shots passed review | trigger assembler → ASSEMBLED |
| `ASSEMBLED` | Final MP4 + copy + thumbnail + .srt produced | trigger delivery → DELIVERED |
| `DELIVERED` | Package dropped in `output/` folder, ready for traffic specialist | terminal |
| `FAILED` | A shot exceeded `max_attempts` or unrecoverable error | terminal; human picks up |

---

## Sub-objects

### `product`

Loaded at Step 1 (Ingest) from Shopify. Cached so subsequent runs don't re-query.

```json
{
  "gid": "gid://shopify/Product/9668674879808",
  "handle": "primer-cachos-definidos",
  "title": "primer cachos definidos",
  "description": "cachos definidos por até 24h ...",
  "price_brl": "149.00",
  "dosagem": "250mL",
  "tipo_de_cabelo": ["Cacheados", "Finos", "Lisos", "Equilibrados"],
  "necessidade": ["Com frizz", "Sem volume"],
  "finalizacao": ["Cachos definidos", "Ondas naturais", "Babyliss duradouro"],
  "hero_image": "https://cdn.shopify.com/.../freepik__reframe...png",
  "accent_color": "#ffd48d",
  "accent_token": "yellow-sun"
}
```

`accent_color` and `accent_token` are looked up from the per-product mapping in [IP doc §5](video-director-ip.md).

### `brief`

The input contract from `/growth-hacker` (or from Lucas's direct invocation). Validated against schema before the brain runs.

```json
{
  "audience": "Marcela persona (default)",
  "platform": "meta-reels",
  "aspect_target": "9:16",
  "length_seconds": 15,
  "lane": "sensorial",
  "hero_intent": "demonstrate 230°C heat protection + 24h frizz control through Marcela's day",
  "variant_mode": "1+2",
  "render_budget_cap_usd": 10.00,
  "review_strictness": "high"
}
```

### `constitution_refs`

Pointers to the docs the brain reads as system context. Recorded for audit — if the IP doc changed between runs, the state file shows which version was used.

```json
{
  "ip_doc": "docs/video-director-ip.md",
  "ip_doc_hash": "sha256:abc...",
  "metafield_map": "docs/video-director-metafield-map.md"
}
```

### `benefits[]`, `benefit_images[]`, `finalidade`, `caracteristicas[]`

Direct output of Step 1 (Ingest), per [metafield map](video-director-metafield-map.md).

```json
"benefits": [
  "definição leve e natural",
  "controla o frizz e blinda por até 24h",
  "brilho e hidratação sem rigidez"
],
"benefit_images": [
  "https://cdn.shopify.com/.../mediaimage_41610642358592.png",
  "https://cdn.shopify.com/.../mediaimage_41611065852224.png",
  "https://cdn.shopify.com/.../mediaimage_41611063296320.png"
],
"finalidade": "cachos definidos, macios e sem pesar os fios",
"caracteristicas": [
  "definição leve e natural, com movimento",
  "controla o frizz e blinda da umidade por até 24h",
  "adiciona brilho e hidrata sem rigidez"
]
```

### `moments[]`

Output of Step 2 (Benefit → Moment Mapper). One entry per benefit.

```json
[
  {
    "benefit_index": 0,
    "benefit": "definição leve e natural",
    "moment": "morning bathroom styling",
    "sensory_anchor": "fingers running through fresh curls",
    "audio": "bathroom ambience + soft pump-spray sound",
    "archetype": "deflection demonstration",
    "time_of_day": "morning"
  },
  { "...": "..." }
]
```

### `narrative_arc[]`

Output of Step 3 (Narrative Sequencer). Ordered shot list with arc metadata.

```json
[
  {
    "shot_id": "01-morning-styling",
    "position": 1,
    "time_of_day": "morning",
    "intent": "demonstrate heat protection during morning styling",
    "archetype": "deflection demonstration",
    "lighting": "cool morning, soft from upper-left",
    "audio_primary": "blow-dryer hum",
    "audio_ambient": "bathroom tile ambience",
    "audio_sting": "soft piano stab at 0:01",
    "duration_seconds": 4
  },
  { "...": "..." }
]
```

### `shots[]`

Output of Step 4 (Shot Synthesizer) + lifecycle state per shot. **This is the most-written section** of the state file.

```json
[
  {
    "shot_id": "01-morning-styling",
    "model": "fal-ai/veo3/image-to-video",
    "model_label": "veo-3",
    "seed_image_url": "https://cdn.shopify.com/.../freepik...png",
    "seed_image_local": "inputs/video-prototypes/primers-resistance-cachos/seeds/primer-cachos-definidos.jpg",
    "prompt": "The product remains perfectly static in the center of frame...",
    "extra_args": { "duration": "4s" },
    "caption_hook": "protegido.",
    "audio_layers": {
      "asmr": "blow-dryer hum + bathroom tile ambience",
      "ambient": "soft warm pad at -18 dB",
      "sting": "single soft piano note at 0:01"
    },
    "status": "PASS",
    "attempts": 1,
    "max_attempts": 3,
    "fal_request_id": "abc123-...",
    "rendered_at": "2026-05-24T14:42:10Z",
    "rendered_mp4_path": "inputs/video-prototypes/primers-resistance-cachos/clips/01-morning-styling.mp4",
    "rendered_aspect": "16:9",
    "rendered_duration_s": 6.0,
    "rendered_resolution": "1280x720",
    "rendered_size_mb": 1.1,
    "render_cost_usd": 0.60,
    "review": {
      "scored_at": "2026-05-24T14:43:00Z",
      "score_hook": 4,
      "score_sensorial": 5,
      "score_brand_match": 5,
      "verdict": "PASS",
      "reason": "Clean dryer rendering, no flames or fire, product undisturbed, neutral lighting throughout."
    },
    "history": [
      { "timestamp": "...", "event": "submitted", "details": "fal_request_id=abc123..." },
      { "timestamp": "...", "event": "completed", "details": "downloaded 1.1 MB" },
      { "timestamp": "...", "event": "reviewed", "details": "PASS score=14/15" }
    ]
  }
]
```

#### Shot `status` values

| Value | Meaning |
|---|---|
| `PENDING` | Brain has written the shot but not dispatched yet |
| `QUEUED` | Submitted to fal.ai, awaiting fal queue |
| `RENDERING` | fal is actively rendering |
| `DOWNLOADING` | Render complete, downloading MP4 |
| `AUTO_REVIEW` | MP4 on disk, reviewer running |
| `PASS` | Review passed, shot accepted |
| `REGEN_QUEUED` | Review failed, prompt mutated, re-submitting |
| `ERROR` | Unrecoverable error (slug invalid, API down, attempts exceeded) |

### `ad_copy`

Output of Step 5 (Ad Copy Generator).

```json
{
  "primary_text": "Seu cabelo, do seu jeito, do começo ao fim do dia.",
  "headline": "24h sem frizz, sem peso.",
  "link_description": "Conheça primer cachos.",
  "cta_button": "Comprar agora",
  "caption_offer": "24h sem frizz.",
  "caption_tagline": "no seu tempo, do seu jeito."
}
```

### `variants[]`

When `variant_mode` is `1+2`, the brain produces three packages. The `variants` array tracks them. Each variant has its own `shots[]` slice (usually only the first shot or the ad copy differs).

```json
[
  {
    "variant_id": "base",
    "variant_kind": "base",
    "shots": [ ... ],
    "ad_copy": { ... }
  },
  {
    "variant_id": "variant-a",
    "variant_kind": "hook-variation",
    "differs_from_base": ["shots[0]"],
    "shots": [ ... ],
    "ad_copy": { ... }
  },
  {
    "variant_id": "variant-b",
    "variant_kind": "copy-variation",
    "differs_from_base": ["ad_copy"],
    "shots": "REUSE",
    "ad_copy": { ... }
  }
]
```

When `shots: "REUSE"` the variant shares the base's rendered MP4s; only the ad copy differs.

### `budget`

```json
{
  "cap_usd": 10.00,
  "estimated_usd": 4.20,
  "spent_usd": 2.84,
  "by_shot": {
    "01-morning-styling": 0.60,
    "02-midday-sun": 0.50,
    "03-afternoon-rain": 0.50,
    "04-evening-arrival": 0.50,
    "01-morning-styling-regen-1": 0.74
  },
  "approved_at": "2026-05-24T14:35:00Z",
  "approved_by": "lucas"
}
```

### `assembly`

```json
{
  "ran_at": "2026-05-24T14:55:00Z",
  "ffmpeg_log": "scripts/video/.assembly-logs/primers-resistance-cachos-2026-05-24.log",
  "captions_burned": true,
  "audio_mixed": true,
  "output_aspect_conformed": "9:16",
  "tagline_card_appended": true,
  "ge_seal_animated": false
}
```

### `delivery`

```json
{
  "delivered_at": "2026-05-24T14:56:00Z",
  "package_dir": "inputs/video-prototypes/primers-resistance-cachos/output/",
  "files": {
    "base/creative.mp4": "1.6 MB",
    "base/thumbnail.jpg": "180 KB",
    "base/captions.srt": "1.2 KB",
    "base/copy.txt": "0.5 KB",
    "variant-a/creative.mp4": "1.6 MB",
    "variant-a/thumbnail.jpg": "180 KB",
    "variant-a/captions.srt": "1.2 KB",
    "variant-a/copy.txt": "0.5 KB",
    "variant-b/creative.mp4": "1.6 MB (symlink to base)",
    "variant-b/thumbnail.jpg": "180 KB",
    "variant-b/captions.srt": "1.2 KB",
    "variant-b/copy.txt": "0.5 KB",
    "README.md": "2.0 KB"
  },
  "notified": false
}
```

### `events[]`

Append-only audit log. Every state transition + every script invocation adds an entry. Lets us reconstruct exactly what happened, in order, when debugging a failed video.

```json
[
  { "ts": "2026-05-24T14:32:00Z", "actor": "brain", "event": "state_init",        "from": null,            "to": "DRAFT" },
  { "ts": "2026-05-24T14:33:01Z", "actor": "brain", "event": "ingest_complete",   "from": "DRAFT",         "to": "STORYBOARD" },
  { "ts": "2026-05-24T14:35:00Z", "actor": "human", "event": "budget_approved",   "from": "STORYBOARD",    "to": "QUEUED" },
  { "ts": "2026-05-24T14:35:10Z", "actor": "fal_client", "event": "shot_submitted", "shot_id": "01-morning-styling", "fal_request_id": "abc123..." },
  { "ts": "2026-05-24T14:42:10Z", "actor": "poller", "event": "shot_downloaded", "shot_id": "01-morning-styling", "size_mb": 1.1 },
  { "ts": "2026-05-24T14:43:00Z", "actor": "reviewer", "event": "shot_passed",    "shot_id": "01-morning-styling", "score": "14/15" },
  { "ts": "2026-05-24T14:55:00Z", "actor": "assembler", "event": "package_built", "from": "ALL_PASS",      "to": "DELIVERED" }
]
```

---

## State transitions — the rules

Hard rules the helpers enforce:

1. **State only moves forward**, except `REGEN_QUEUED → RENDERING → AUTO_REVIEW → PASS or REGEN_QUEUED` loop.
2. **Shots inside a parent state must be consistent**: state `ALL_PASS` requires every shot status is `PASS`. State `RENDERING` requires at least one shot is `QUEUED` or `RENDERING`.
3. **Budget gate is mandatory**: state cannot reach `QUEUED` without `budget.approved_at` populated.
4. **Cost rollup is automatic**: every render write updates `budget.spent_usd = sum(budget.by_shot.values())`.
5. **`updated_at` rewrites on every write**.
6. **`events[]` is append-only**: never overwrite or reorder.

---

## Concurrency

Multiple components (poller, reviewer, brain) may want to write to state.json at the same time. To keep it safe:

- All writes go through a single helper function `update_state(concept_id, mutator_fn)`.
- The helper takes a file lock on `state.json.lock` for the duration of the read-modify-write.
- The mutator function receives the current state dict, returns the new state dict.
- Lock timeout: 30 seconds (if held longer, something is wrong).

In Python:

```python
from filelock import FileLock

def update_state(concept_id, mutator):
    path = Path(f"inputs/video-prototypes/{concept_id}/state.json")
    lock = FileLock(str(path) + ".lock", timeout=30)
    with lock:
        state = json.loads(path.read_text(encoding="utf-8"))
        new_state = mutator(state)
        new_state["updated_at"] = utcnow_iso()
        path.write_text(json.dumps(new_state, indent=2, ensure_ascii=False), encoding="utf-8")
```

`filelock` is a small Python lib; install via `pip install filelock`.

---

## Validation

Before any state write, the helper validates that:

1. Required top-level fields exist (`concept_id`, `state`, `events`).
2. `state` is one of the allowed enum values.
3. If `state == QUEUED` or beyond, `shots[]` is non-empty.
4. If `state == ALL_PASS` or beyond, every shot has `status == PASS`.
5. If `state == DELIVERED`, `delivery.delivered_at` is populated.

Validation failures raise a clear exception; the helper does NOT silently fix.

---

## Example: a fresh state.json at DRAFT

The brain initializes a new state file with just the minimum to track the concept. Everything else gets filled in as the lifecycle progresses.

```json
{
  "schema_version": 1,
  "concept_id": "primers-resistance-cachos",
  "concept_label": "primers resistance (cachos definidos)",
  "created_at": "2026-05-24T14:32:00Z",
  "updated_at": "2026-05-24T14:32:00Z",
  "state": "DRAFT",
  "events": [
    { "ts": "2026-05-24T14:32:00Z", "actor": "brain", "event": "state_init", "from": null, "to": "DRAFT" }
  ]
}
```

After Step 1 (Ingest) it'll have `product`, `benefits`, `benefit_images`, `finalidade`, `caracteristicas` populated and `state == BRIEF_LOCKED`. After Step 4 (Shot Synth) it'll have `shots[]` populated and `state == STORYBOARD`. And so on.
