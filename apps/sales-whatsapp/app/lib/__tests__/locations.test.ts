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

  it("returns all 4 locations for the owner/ops grant", () => {
    const locations = locationsForRep("lucas@gebeauty.com.br");
    expect(locations.map((l) => l.key).sort()).toEqual(
      ["riomar-recife", "riosul", "shopping-recife", "shops-jardins"].sort(),
    );
  });

  it("returns an empty array for an unlisted email", () => {
    expect(locationsForRep("nobody@gebeauty.com.br")).toEqual([]);
  });
});
