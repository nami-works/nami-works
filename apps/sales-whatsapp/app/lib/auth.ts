// Resolves the real logged-in Shopify staff member's email from an
// authenticated admin session, and checks it against the hardcoded grant
// table. This is the mechanism confirmed against Shopify's own docs
// 2026-08-12: the session token's `sub` claim is the staff user's real
// Shopify ID (only true because useOnlineTokens: true in shopify.server.ts
// — an offline/shop-level token would NOT carry per-user identity), and
// `session.onlineAccessInfo.associated_user.email` is that same identity
// already resolved by the Shopify SDK — no separate /users/{id}.json call
// needed at request time, since the SDK's OAuth response already includes
// the associated user's email for online tokens.
import type { Session } from "@shopify/shopify-app-react-router/server";
import { locationsForRep, type Location } from "./locations.js";

export class UnauthorizedLocationError extends Error {
  constructor(email: string) {
    super(`${email} has no location grant`);
    this.name = "UnauthorizedLocationError";
  }
}

export function repEmailFromSession(session: Session): string {
  const email = session.onlineAccessInfo?.associated_user?.email;
  if (!email) {
    // Should be unreachable given useOnlineTokens: true, but fail loudly
    // rather than silently granting/denying access on a null identity.
    throw new UnauthorizedLocationError("(no associated user on session)");
  }
  return email.toLowerCase();
}

export function grantedLocationsForSession(session: Session): Location[] {
  const email = repEmailFromSession(session);
  const locations = locationsForRep(email);
  if (locations.length === 0) {
    throw new UnauthorizedLocationError(email);
  }
  return locations;
}
