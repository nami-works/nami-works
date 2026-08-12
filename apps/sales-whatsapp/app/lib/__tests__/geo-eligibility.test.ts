import { describe, expect, it } from "vitest";
import { distanceKm, expansionBand, isEntregaLocalEligible } from "../geo-eligibility.js";
import { LOCATIONS } from "../locations.js";

describe("distanceKm", () => {
  it("returns ~0 for the same point", () => {
    expect(distanceKm(-8.117, -34.901, -8.117, -34.901)).toBeCloseTo(0, 3);
  });

  it("matches a known real-world distance (RioSul to Shops Jardins, ~360km)", () => {
    const riosul = LOCATIONS.riosul;
    const jardins = LOCATIONS["shops-jardins"];
    const km = distanceKm(riosul.lat, riosul.lng, jardins.lat, jardins.lng);
    expect(km).toBeGreaterThan(330);
    expect(km).toBeLessThan(370);
  });
});

describe("isEntregaLocalEligible", () => {
  const location = LOCATIONS["shopping-recife"];

  it("is eligible for a customer at the exact location", () => {
    expect(isEntregaLocalEligible(location.lat, location.lng, location)).toBe(true);
  });

  it("is eligible just inside the 20km radius", () => {
    // ~0.15 degrees latitude is roughly 16.6km at this latitude
    expect(isEntregaLocalEligible(location.lat + 0.15, location.lng, location)).toBe(true);
  });

  it("is not eligible well outside the radius (RioMar Recife, ~2km away, still counts as separate)", () => {
    const riomar = LOCATIONS["riomar-recife"];
    // Confirms two nearby-but-distinct Recife locations don't bleed into
    // each other's pool just because they're close — each rep's pool is
    // scoped to their OWN location's radius, not "any location within 20km".
    expect(isEntregaLocalEligible(riomar.lat, riomar.lng, LOCATIONS["shops-jardins"])).toBe(false);
  });
});

describe("expansionBand", () => {
  const location = LOCATIONS.riosul;

  it("classifies a nearby customer as entrega_local", () => {
    expect(expansionBand(location.lat, location.lng, location)).toBe("entrega_local");
  });

  it("classifies São Paulo (from RioSul) as vizinhas or estado, not entrega_local", () => {
    const sp = LOCATIONS["shops-jardins"];
    const band = expansionBand(sp.lat, sp.lng, location);
    expect(band).not.toBe("entrega_local");
  });

  it("classifies a far-away point (e.g. Manaus, ~2600km from RioSul) as nacional", () => {
    const manausLat = -3.119;
    const manausLng = -60.0217;
    expect(expansionBand(manausLat, manausLng, location)).toBe("nacional");
  });
});
