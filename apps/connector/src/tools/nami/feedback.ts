import { z } from "zod";
import { Prisma } from "@prisma/client-connector";
import { prisma } from "../../db/prisma.js";
import { registerToolDefinition } from "../../mcp/registry.js";
import type { ToolContext, ToolResult } from "../../mcp/types.js";

/**
 * Operator feedback capture. Writes a row to the Feedback table; NAMI Works
 * admins review via `npm run feedback-review`.
 *
 * Designed for use FROM WITHIN claude.ai conversations. The connector's
 * serverInfo instructions advertise the tool so operators learn the magic
 * word ("feedback: ...") without needing onboarding training.
 *
 * Categories are an enum so we can group/filter the review backlog. The
 * relatedTool field lets operators point at a specific tool that misbehaved
 * — useful for triage but optional (a lot of feedback is "the brand voice
 * feels off in general", not tool-specific).
 *
 * Gracefully handles a missing Feedback table (deployment happened before
 * migration applied) — returns a friendly error rather than a Prisma stack.
 */

const FEEDBACK_CATEGORIES = [
  "voice_drift",
  "tool_bug",
  "missing_capability",
  "copy_quality",
  "other",
] as const;

export async function namiFeedbackHandler(
  args: {
    message: string;
    category?: (typeof FEEDBACK_CATEGORIES)[number] | undefined;
    relatedTool?: string | undefined;
  },
  ctx: ToolContext,
): Promise<ToolResult> {
  const category = args.category ?? "other";
  const message = args.message.trim();

  if (message.length < 5) {
    return {
      content: [
        {
          type: "text",
          text: "Feedback message is too short (minimum 5 chars). Give NAMI Works enough context to act on it.",
        },
      ],
      isError: true,
    };
  }

  try {
    const row = await prisma.feedback.create({
      data: {
        tenantId: ctx.tenant.id,
        category,
        message,
        ...(args.relatedTool ? { relatedTool: args.relatedTool } : {}),
        ...(ctx.tenant.principalId ? { principalId: ctx.tenant.principalId } : {}),
        ...(ctx.tenant.actorLabel ? { principalLabel: ctx.tenant.actorLabel } : {}),
      },
      select: { id: true, createdAt: true },
    });

    ctx.logger.info(
      {
        feedbackId: row.id,
        category,
        relatedTool: args.relatedTool ?? null,
        tenant: ctx.tenant.slug,
        messagePreview: message.slice(0, 120),
      },
      `feedback captured (${category})`,
    );

    return {
      content: [
        {
          type: "text",
          text:
            `✓ Feedback registered for ${ctx.tenant.slug} (id: ${row.id}, category: ${category}). ` +
            `NAMI Works reviews the queue weekly. ` +
            `If this is urgent, also ping lucas@nami.works directly.`,
        },
      ],
    };
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2021"
    ) {
      return {
        content: [
          {
            type: "text",
            text:
              "Feedback system is registered in the gateway but the underlying table doesn't exist on this environment yet. " +
              "Your message wasn't lost — it's been logged. Please ping lucas@nami.works directly with the same message until the migration lands.",
          },
        ],
        isError: true,
      };
    }
    throw err;
  }
}

registerToolDefinition({
  name: "nami_feedback",
  description:
    "Submit feedback to NAMI Works about anything that feels off — drifting brand voice, a tool returning the wrong thing, a missing capability, a draft that came out poorly, or general product friction. Routes to the NAMI Works review queue. Use this whenever you notice something the system should learn from.",
  inputSchema: {
    message: z
      .string()
      .min(5)
      .describe(
        "What's wrong, what's missing, or what you wish worked differently. Be specific — quote the bad output if relevant. Min 5 chars.",
      ),
    category: z
      .enum(FEEDBACK_CATEGORIES)
      .optional()
      .describe(
        "Optional bucket. 'voice_drift' = brand voice rules feel outdated. 'tool_bug' = a tool returned wrong data. 'missing_capability' = wish there was a tool for X. 'copy_quality' = a draft was off. Defaults to 'other'.",
      ),
    relatedTool: z
      .string()
      .optional()
      .describe(
        "Optional name of the tool the feedback is about (e.g. 'brand_tone_current'). Helps NAMI Works triage by surface.",
      ),
  },
  handler: namiFeedbackHandler,
});
