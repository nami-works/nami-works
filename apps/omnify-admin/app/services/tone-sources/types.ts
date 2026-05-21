export type ToneSourceType =
  | "shopify_blog"
  | "meta_ig"
  | "meta_fb"
  | "monday"
  | "manual_upload"
  | "manual_url";

export type ToneHypothesisCategory =
  | "voice"
  | "vocabulary"
  | "do"
  | "dont"
  | "register"
  | "structure";

export type ToneHypothesisStatus =
  | "pending_review"
  | "accepted"
  | "rejected"
  | "superseded";

export type ToneSourceConnectionStatus =
  | "connected"
  | "disconnected"
  | "not_configured"
  | "error";

export type ToneEvidenceItem = {
  sourceType: ToneSourceType;
  sourceId: string;
  snippet: string;
};
