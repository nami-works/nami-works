import { describe, expect, it } from "vitest";
import { confirmationPreview } from "./confirm.js";

describe("confirmationPreview", () => {
  it("builds a preview block with the summary + confirm instruction", () => {
    const result = confirmationPreview({
      summary: "Will set price of variant 123 from R$ 100 to R$ 80.",
      actionLabel: "update price",
    });
    expect(result.content[0]?.type).toBe("text");
    const text = result.content[0]?.text ?? "";
    expect(text).toContain("Preview (no changes made yet)");
    expect(text).toContain("Will set price of variant 123 from R$ 100 to R$ 80.");
    expect(text).toContain("confirm: true");
    expect(text).toContain("update price");
    expect(result.isError).toBeUndefined();
  });

  it("never includes an em dash in the rendered copy", () => {
    const result = confirmationPreview({
      summary: "test",
      actionLabel: "label",
    });
    const text = result.content[0]?.text ?? "";
    expect(text).not.toContain("—");
  });
});
