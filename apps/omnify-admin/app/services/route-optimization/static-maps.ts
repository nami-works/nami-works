/**
 * Google Static Maps URL builder + PNG fetcher for the spatial reasoner.
 *
 * The reasoner needs a map image of the candidates to do its spatial
 * reasoning. We build the same URL shape `handleRenderRoutes` already
 * uses for the CLI render-routes command (one `markers=` parameter per
 * point so each marker gets its own label).
 *
 * Pure URL builder + a thin fetch wrapper. Tests use the URL builder
 * only; production also calls fetchPngAsBase64 to attach the PNG to the
 * Anthropic message.
 */

import type { Candidate, CandidateOrderInput, Coordinate } from "./types";

const ROUTE_MARKER_COLORS = [
  "0xEF4444", // red
  "0x3B82F6", // blue
  "0x10B981", // green
  "0xF59E0B", // amber
  "0x8B5CF6", // violet
  "0xEC4899", // pink
];

const STOP_LABELS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

export function buildStaticMapUrl(args: {
  pickupCoordinates: Coordinate;
  candidate: Candidate;
  orders: CandidateOrderInput[];
  apiKey: string;
  size?: string;
  scale?: 1 | 2;
}): string {
  const { pickupCoordinates, candidate, orders, apiKey } = args;
  const size = args.size ?? "640x640";
  const scale = args.scale ?? 2;

  const params: string[] = [
    `size=${size}`,
    `scale=${scale}`,
    "maptype=roadmap",
    `markers=color:black|label:P|size:mid|${pickupCoordinates.latitude},${pickupCoordinates.longitude}`,
  ];

  const orderByName = new Map(orders.map((o) => [o.name, o]));

  for (const slot of candidate.clustering) {
    const color = ROUTE_MARKER_COLORS[slot.slot % ROUTE_MARKER_COLORS.length]!;
    slot.orderIds.forEach((name, i) => {
      const o = orderByName.get(name);
      if (!o) return;
      const label = STOP_LABELS[i % STOP_LABELS.length] ?? "X";
      params.push(
        `markers=color:${color}|label:${label}|size:small|${o.coordinates.latitude},${o.coordinates.longitude}`,
      );
    });
  }

  params.push(`key=${encodeURIComponent(apiKey)}`);
  return `https://maps.googleapis.com/maps/api/staticmap?${params.join("&")}`;
}

/** Fetch a Static Maps URL and return base64-encoded PNG bytes. */
export async function fetchPngAsBase64(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Static Maps fetch failed: ${res.status} ${res.statusText}`);
  }
  const arrayBuf = await res.arrayBuffer();
  return Buffer.from(arrayBuf).toString("base64");
}
