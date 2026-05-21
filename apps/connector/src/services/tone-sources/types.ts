// Source-of-truth vocabulary for the tone-of-voice pipeline. The pipeline
// converges every connected upstream (Shopify blog, Meta IG/FB, Monday.com,
// manual uploads/URLs) into BrandToneSource rows tagged with one of these
// `sourceType` values, then runs Claude inference to produce
// BrandToneHypothesis rows in the categories below.

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
