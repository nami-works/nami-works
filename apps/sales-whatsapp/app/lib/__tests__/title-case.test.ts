import { describe, expect, it } from "vitest";
import { titleCase } from "../title-case.js";

describe("titleCase", () => {
  it("title-cases an all-caps name", () => {
    expect(titleCase("MARIA CLARA SILVA")).toBe("Maria Clara Silva");
  });

  it("title-cases an all-lowercase name", () => {
    expect(titleCase("joão pedro")).toBe("João Pedro");
  });

  it("keeps PT-BR particles lowercase except as the first word", () => {
    expect(titleCase("maria de souza dos santos")).toBe("Maria de Souza dos Santos");
  });

  it("capitalizes a particle if it's the first word", () => {
    expect(titleCase("da silva")).toBe("Da Silva");
  });

  it("collapses extra whitespace", () => {
    expect(titleCase("  ana   paula  ")).toBe("Ana Paula");
  });
});
