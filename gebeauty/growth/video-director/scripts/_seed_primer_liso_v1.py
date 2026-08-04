"""One-shot: populate primer-liso-intacto-v1 state.json with doctrine fields.

Mirrors the primer-cachos v8 dossier with primer-liso adjustments:
  - Material: opaque TEAL plastic (not coral)
  - Volume: 150mL = ~17cm tall (not 250mL/20cm)
  - Benefit framing: humidity-shield + alignment durability (not curl-define)
"""

from __future__ import annotations
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from state import update_state, append_event, utcnow_iso  # noqa: E402

CONCEPT_ID = "primer-liso-intacto-v1"
LIBRARY_ID = 1877692
LIBRARY_IDENTIFIER = "BC5N0oQRmD"

GROUNDING = (
    "(1) Soft natural CONTACT SHADOW beneath the bottle, matching the scene's dominant light angle. "
    "(2) Subtle SPECULAR REFLECTION of the bottle's base on the surface beneath it. "
    "(3) The bottle is LIT BY THE SCENE — warm key on one side, cool fill on the other, NOT lit by an external studio light. "
    "(4) Casual PLACEMENT — slightly off-center, slightly angled, as if just placed without thinking. "
    "(5) The bottle's smooth matte teal surface CATCHES REFLECTIONS from the scene around it."
)

def proportion(surface_clause: str, comparison: str) -> str:
    return (
        "The bottle is a 150ml haircare bottle, approximately 17 cm tall. "
        + surface_clause + " "
        + "The bottle occupies the LOWER 25 percent of vertical frame; the surface fills the bottom strip with empty space around the bottle. "
        + "Compare scale: the bottle should look like " + comparison + " — present and deliberately placed, not the surface's purpose."
    )

# ─── Shot 1: morning bathroom blowdry, premium dryer signifier ───
SHOT1 = {
    "scene_description": (
        "stands perfectly upright on a clean cream-colored marble bathroom vanity counter, "
        "slightly off-center to the LEFT of frame center, casually placed. Behind the bottle, "
        "a large round vanity mirror catches soft daylight from a window upper-left. "
        "Light wood cabinetry below, white subway tile backsplash. A folded warm-cream linen "
        "hand towel rests slightly rumpled at frame-left-edge."
    ),
    "proportion_directive": proportion(
        "The marble vanity counter is approximately 80 cm wide — about 5× the bottle's height in width. "
        "The round mirror is approximately 80 cm in diameter.",
        "a coffee mug on a vanity"
    ),
    "realistic_grounding": GROUNDING,
    "partial_signifier": (
        "From the RIGHT EDGE of the frame, a premium professional hair dryer — brushed-metal "
        "salon-grade body and modern minimalist industrial design — is PARTIALLY VISIBLE, with "
        "approximately 30 percent of the dryer's body and nozzle entering the frame from the right. "
        "The nozzle is pointed slightly toward the bottle/mirror area. The dryer is sleek, polished, "
        "premium salon-grade. The dryer catches the warm vanity light on its body. NO HEAT-MIRAGE "
        "EFFECT — the dryer's presence alone signifies the heat."
    ),
    "lighting_description": (
        "Soft warm 3000K key light from upper-left through window. Cool 5500K daylight fill from "
        "camera-right. Warm key on left shoulder, cooler ambient on right. Clean elliptical shadow "
        "falling rightward at 4 o'clock."
    ),
    "negatives": (
        "No heat-mirage, no wavy distortion, no refracted-air effect, no steam, no mist, no fog, "
        "no condensation on the mirror, no water droplets, no hands, no hair, no face, no people, "
        "no second bottle, no text other than on the bottle, no logo other than 'ge', no flames, "
        "no fire, no orange tint"
    ),
    "motion_pattern": "A",
    "motion_direction": (
        "Hold the frame as a calm 6-second still witness. The premium hair dryer at the right edge "
        "stays COMPLETELY MOTIONLESS in its partial-frame position. The only motion in the entire "
        "frame is a barely-perceptible drift of warm ambient light across the bottle's left shoulder, "
        "and a faint suggestion of warm air at the dryer's nozzle."
    ),
    "audio_direction": (
        "LOUD CONTINUOUS HIGH-INTENSITY industrial salon BLOW-DRYER HUM AT MAXIMUM POWER, "
        "dominant in the mix, sustained throughout, no voice, no music, no other sounds"
    ),
    "scene_brief_for_motion": (
        "on the cream marble bathroom vanity counter, with a premium brushed-metal hair dryer "
        "partially visible at the right edge pointing toward the bottle area"
    ),
    "motion_negatives": (
        "no hair dryer in motion (it stays static in partial-frame position), no steam, no fog, "
        "no rotation of the bottle, no environment changes"
    ),
}

# ─── Shot 2: afternoon cafe + rain, grounded ───
SHOT2 = {
    "scene_description": (
        "is CASUALLY SET DOWN on a small round dark-wood bistro cafe table, slightly off-center "
        "near the table edge, as if just placed without thinking. The cafe table is pulled up "
        "directly in front of a full-height window. Beyond the window: wet São Paulo street at 4 PM, "
        "blurred bokeh of slow traffic — red taillights, white headlights, wet asphalt. A small "
        "white ceramic saucer rests at frame-edge."
    ),
    "proportion_directive": proportion(
        "The round bistro table is approximately 75 cm tall and 60 cm in diameter — about 4× the "
        "bottle's height in diameter. The window behind is full-height approximately 200 cm tall.",
        "a glass of water on a side table"
    ),
    "realistic_grounding": GROUNDING,
    "kinetic_still_effect": (
        "On the OUTSIDE surface of the window directly behind the bottle, heavy São Paulo rain "
        "visibly streams down in DENSE CONTINUOUS VERTICAL STREAKS at peak compression. Fat droplets "
        "impact and break across the glass. Frozen instant of peak rain — hundreds of droplets "
        "visible at different fall stages. Rain stays OUTSIDE the window — does NOT enter the cafe. "
        "Bottle remains completely dry."
    ),
    "lighting_description": (
        "Warm 2700K pendant interior from camera-left off-frame. Cool 6500K diffused storm light "
        "from behind through window. Warm key on left, cool silhouette ambient on right. Soft long "
        "shadow rightward across dark wood."
    ),
    "negatives": (
        "No rain inside the cafe, no water droplets on the bottle, no condensation on the bottle, "
        "no steam, no people, no faces, no hair, no hands, no coffee cup in frame, no phone, "
        "no text other than on the bottle, no logo other than 'ge', no fire"
    ),
    "motion_pattern": "A",
    "motion_direction": (
        "Hold the frame as a calm 6-second still witness. The only motion in the entire frame is "
        "the rain on the OUTSIDE surface of the window behind the bottle, which continues streaming "
        "down in continuous vertical streaks with occasional fat droplets impacting and breaking "
        "across the glass, and the slow soft drift of out-of-focus headlight and taillight bokeh "
        "in the wet city beyond. The bottle does not move. The table does not move. The contact "
        "shadow stays steady."
    ),
    "audio_direction": (
        "heavy rain on glass with droplet impacts, wet-tire hiss from the street outside, soft "
        "distant cafe murmur, low warm ambient pad"
    ),
    "scene_brief_for_motion": (
        "on a small round dark-wood bistro cafe table by a full-height window streaming with "
        "heavy São Paulo rain, with blurred city bokeh beyond"
    ),
    "motion_negatives": (
        "no rain inside the cafe, no condensation on the bottle, no coffee cup motion"
    ),
}

# ─── Shot 3: evening apartment, empty zone for keys land (Pattern B) ───
SHOT3 = {
    "scene_description": (
        "stands casually upright on a warm-gray concrete kitchen island corner, slightly off-center "
        "in the right portion of frame. A tan leather tote bag handle just enters frame at the LEFT "
        "edge. The kitchen is a modern Brazilian apartment — light wood cabinetry back wall, "
        "concrete island base, comfortable sofa visible in soft focus background. Through a "
        "floor-to-ceiling window beyond — the São Paulo skyline at golden hour, mixed-height "
        "buildings in soft amber and violet bokeh."
    ),
    "proportion_directive": proportion(
        "The kitchen island is approximately 90 cm tall and 120 cm wide — about 7× the bottle's "
        "height in width.",
        "a coffee mug on a kitchen counter"
    ),
    "realistic_grounding": GROUNDING,
    "kinetic_still_effect": (
        "CRITICAL — EMPTY LANDING ZONE: The concrete counter surface to the right of the bottle is "
        "COMPLETELY EMPTY, CLEAN, AND UNOBSTRUCTED — NO keys, NO objects, NO clutter. Roughly "
        "25cm × 20cm of clear concrete surface. (Keys will fly in via motion synthesis.) Kinetic "
        "background: at the UPPER-RIGHT corner, soft warm golden lens-flare beams enter at peak "
        "intensity, painting a warm wash across the concrete counter. Faint dust motes in the beam. "
        "Light is purely golden warm — no orange tint, no fire, no visible sun disc."
    ),
    "lighting_description": (
        "Warm 2400K pendant above the island. Golden-hour wash from window behind. Teal plastic "
        "reads deeper and richer against the warm tones."
    ),
    "negatives": (
        "NO KEYS in this still (they arrive in motion). No paper bag, no shopping bag, no "
        "groceries, no food, no plates, no wine, no cups, no phone, no laptop, no mail, no second "
        "bottle, no people, no faces, no hair, no hands, no visible sun disc, no aura, no halo, "
        "no fire"
    ),
    "motion_pattern": "B",
    "motion_direction": (
        "Between frame 1 (empty concrete counter beside bottle) and frame N (keys settled on "
        "counter), the ONLY thing that happens is a ring of HOUSE KEYS WITH A SMALL TAN LEATHER "
        "FOB enters the scene with NATURAL PROJECTILE PHYSICS. At approximately 1.5 seconds, the "
        "keys appear at the UPPER-LEFT edge of frame, having been tossed from off-frame. The keys "
        "travel through the air in a REALISTIC PARABOLIC ARC — initial forward momentum carries "
        "them diagonally down-and-right, gravity progressively pulls them down with proper "
        "acceleration, they reach apex around 2 seconds, then descend toward the counter. At "
        "approximately 2.5 seconds the keys IMPACT the counter beside the bottle with REALISTIC "
        "PHYSICS — a small natural bounce of 3-5 cm with reduced energy on the second contact, "
        "then a brief skid forward of 5 cm carrying their remaining inertia, then they settle "
        "motionless. The motion MUST OBEY real-world physics (gravity 9.8 m/s², proper momentum, "
        "energy loss on impact, friction slows the skid). The keys are NOT floating, NOT "
        "levitating. The bottle does not react, does not move. The tote does not move. After "
        "settle around 3.5 seconds, the rest of the shot holds calm with subtle drift of the "
        "golden lens flare."
    ),
    "audio_direction": (
        "1.5 seconds of warm quiet home ambient with distant city hush, then a soft swish of keys "
        "flying through air for 0.5 seconds, then a SHARP metallic clink and soft thud as the "
        "keys impact the concrete counter at 2.5 seconds, then a brief second softer metallic "
        "chime as they bounce, then quiet settle, then continued warm ambient pad with distant "
        "city hush for the remainder. No music, no voice."
    ),
    "scene_brief_for_motion": (
        "on the warm-gray concrete kitchen island corner with a tan tote handle visible at left "
        "edge, São Paulo skyline through the window beyond at golden hour, sofa visible behind "
        "in soft focus"
    ),
    "motion_negatives": (
        "no food, no groceries, no paper bag, no phone, no second bottle"
    ),
}

PER_SHOT = {
    "01-morning-styling": SHOT1,
    "02-afternoon-rain": SHOT2,
    "03-evening-arrival": SHOT3,
}


def main():
    def mutator(s):
        s["product"]["magnific_library_id"] = LIBRARY_ID
        s["product"]["magnific_library_identifier"] = LIBRARY_IDENTIFIER
        for shot in s["shots"]:
            sid = shot["shot_id"]
            shot.update(PER_SHOT[sid])
        append_event(s, actor="brain", event="doctrine_fields_populated",
                     library_id=LIBRARY_ID)
        return s

    s = update_state(CONCEPT_ID, mutator)
    print("All 3 shots populated.")
    print(f"  library_id: {s['product']['magnific_library_id']}")
    print(f"  material:   {s['product']['material_phrase'][:60]}...")
    for sh in s["shots"]:
        sid = sh["shot_id"]
        pat = sh.get("motion_pattern", "?")
        sig_type = "kinetic" if sh.get("kinetic_still_effect") else "signifier"
        print(f"  {sid}: pattern {pat}, {sig_type}")


if __name__ == "__main__":
    main()
