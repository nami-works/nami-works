/**
 * Production Reasoner — wraps Anthropic Messages API.
 *
 * This is the ONLY route-optimization module that imports `@anthropic-ai/sdk`.
 * Everything else takes a `Reasoner` via dependency injection. Tests use
 * the mock reasoner exported by `__tests__/reasoner-mock.ts`.
 *
 * Model selection:
 *   - "haiku"  → claude-haiku-4-5-20251001 (fast, $0.25/MTok input)
 *   - "sonnet" → claude-sonnet-4-6        (heavier reasoning, $3/MTok input)
 *
 * Env vars required:
 *   - ANTHROPIC_API_KEY (must be set; missing key returns api_failure)
 */

import Anthropic from "@anthropic-ai/sdk";
import {
  parseStrictJson,
  type Reasoner,
  type ReasonerInput,
  type ReasonerOutput,
} from "./spatial-reasoner.server";

const HAIKU_MODEL = "claude-haiku-4-5-20251001";
const SONNET_MODEL = "claude-sonnet-4-6";

function modelId(model: "haiku" | "sonnet"): string {
  return model === "haiku" ? HAIKU_MODEL : SONNET_MODEL;
}

/**
 * Build a Reasoner bound to an Anthropic SDK client. The returned function
 * is what gets passed to `reasonAboutCandidates({ ..., reasoner })`.
 *
 * If `apiKey` is omitted, the SDK reads `ANTHROPIC_API_KEY` from the
 * environment.
 */
export function buildAnthropicReasoner(opts: {
  apiKey?: string;
  /** Override timeout per call (ms). Default 60s. */
  timeoutMs?: number;
  /** Optional response_format hint for JSON (off by default; the prompt is strict enough). */
}): Reasoner {
  const client = new Anthropic({
    apiKey: opts.apiKey,
    timeout: opts.timeoutMs ?? 60_000,
  });

  return async (input: ReasonerInput): Promise<ReasonerOutput> => {
    const userContent: Anthropic.MessageParam["content"] = [];

    // Image first, then text — Anthropic recommends this ordering for
    // vision-aware prompts.
    if (input.pngBase64) {
      userContent.push({
        type: "image",
        source: {
          type: "base64",
          media_type: "image/png",
          data: input.pngBase64,
        },
      });
    } else if (input.pngUrl) {
      userContent.push({
        type: "image",
        source: { type: "url", url: input.pngUrl },
      });
    }
    userContent.push({ type: "text", text: input.userMessage });

    try {
      const response = await client.messages.create({
        model: modelId(input.model),
        max_tokens: 2_048,
        system: input.systemPrompt,
        messages: [{ role: "user", content: userContent }],
      });

      const textBlocks = response.content.filter(
        (b): b is Anthropic.TextBlock => b.type === "text",
      );
      const rawText = textBlocks.map((b) => b.text).join("\n");

      const parsed = parseStrictJson(rawText);
      if (!parsed.ok) {
        return {
          ok: false,
          reason:
            parsed.reason === "unparseable_sentinel"
              ? "unparseable_sentinel"
              : parsed.reason,
          rawText,
          errorDetail: parsed.reason !== "unparseable_sentinel" ? parsed.detail : undefined,
        };
      }

      // Inject `promptVersion` server-side — it's metadata for replay/audit
      // and not something the LLM should be responsible for emitting. The
      // v1 prompt schema doesn't list it, so requiring it pre-injection
      // breaks every call.
      return {
        ok: true,
        rawText,
        parsed: { ...parsed.value, promptVersion: input.promptVersion },
        tokensUsed: {
          input: response.usage?.input_tokens ?? 0,
          output: response.usage?.output_tokens ?? 0,
        },
        modelActual: response.model,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const isTimeout = /timeout|timed out/i.test(message);
      return {
        ok: false,
        reason: isTimeout ? "timeout" : "api_failure",
        errorDetail: message,
      };
    }
  };
}
