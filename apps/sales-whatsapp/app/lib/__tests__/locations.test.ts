import { describe, expect, it } from "vitest";
import { locationsForRep } from "../locations.js";

describe("locationsForRep", () => {
  it("returns a single location for a rep granted one", () => {
    const locations = locationsForRep("geb002@gebeauty.com.br");
    expect(locations.map((l) => l.key)).toEqual(["shopping-recife"]);
  });

  it("is case-insensitive on email", () => {
    const locations = locationsForRep("GEB002@GEBEAUTY.COM.BR");
    expect(locations.map((l) => l.key)).toEqual(["shopping-recife"]);
  });

  it("returns all 4 locations for a non-geb00 email (owner/ops and everyone else)", () => {
    const locations = locationsForRep("lucas@gebeauty.com.br");
    expect(locations.map((l) => l.key).sort()).toEqual(
      ["riomar-recife", "riosul", "shopping-recife", "shops-jardins"].sort(),
    );
  });

  it("returns all 4 locations for any other unlisted, non-geb00 email", () => {
    const locations = locationsForRep("nobody@gebeauty.com.br");
    expect(locations.map((l) => l.key).sort()).toEqual(
      ["riomar-recife", "riosul", "shopping-recife", "shops-jardins"].sort(),
    );
  });

  it("returns an empty array for a geb00-pattern email with no specific grant", () => {
    expect(locationsForRep("geb009@gebeauty.com.br")).toEqual([]);
  });
});
