/**
 * JSON helpers for Prisma writes.
 *
 * Prisma's `InputJsonValue` type requires nested JsonValue (recursive) rather
 * than `unknown`. Our canonicalized payloads are `Record<string, unknown>` so
 * we cast at the write boundary. `null` is replaced with `undefined` so Prisma
 * keeps the column null rather than rejecting.
 */
import type { Prisma } from "@prisma/client";

export type JsonRecord = Record<string, unknown>;

export function toJsonInput(
  value: unknown,
): Prisma.InputJsonValue | undefined {
  if (value == null) return undefined;
  return value as Prisma.InputJsonValue;
}

export function toJsonArrayInput(
  value: unknown[] | null | undefined,
): Prisma.InputJsonValue | undefined {
  if (!value) return undefined;
  return value as unknown as Prisma.InputJsonValue;
}
