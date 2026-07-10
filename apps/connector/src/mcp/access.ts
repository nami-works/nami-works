import type { AccessLevel, ConnectorSystem } from "@prisma/client-connector";
import type { ToolCatalogEntry } from "./tool-catalog.js";

// A principal's effective access = the union of all their assigned roles' grants.
// `systems` holds the highest granted level per system (omitted = no access).
export type EffectiveAccess = {
  isOwner: boolean;
  systems: Partial<Record<ConnectorSystem, AccessLevel>>;
};

const RANK: Record<AccessLevel, number> = { none: 0, read: 1, readwrite: 2 };

// Minimal shape we need off an AccessRole (isOwner + the grants JSON map).
export type RoleGrants = {
  isOwner: boolean;
  grants: unknown; // JSON: { "<ConnectorSystem>": "read" | "readwrite" }
};

export function computeEffectiveAccess(roles: RoleGrants[]): EffectiveAccess {
  let isOwner = false;
  const systems: Partial<Record<ConnectorSystem, AccessLevel>> = {};
  for (const role of roles) {
    if (role.isOwner) isOwner = true;
    if (!role.grants || typeof role.grants !== "object") continue;
    for (const [sys, level] of Object.entries(role.grants as Record<string, unknown>)) {
      if (level !== "read" && level !== "readwrite") continue;
      const key = sys as ConnectorSystem;
      const current = systems[key];
      if (!current || RANK[level] > RANK[current]) systems[key] = level;
    }
  }
  return { isOwner, systems };
}

// Whether a principal with `access` may see + call a tool with `entry`.
// Owners get everything; alwaysAvailable tools (e.g. feedback) are never gated;
// otherwise the granted level for the tool's system must meet the tool's need
// (write tools require readwrite; read tools accept read or readwrite).
export function canUseTool(access: EffectiveAccess, entry: ToolCatalogEntry): boolean {
  if (entry.alwaysAvailable) return true;
  if (access.isOwner) return true;
  const level = access.systems[entry.system];
  if (!level) return false;
  return entry.write ? level === "readwrite" : level === "read" || level === "readwrite";
}
