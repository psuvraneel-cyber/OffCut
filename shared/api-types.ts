export type ApiErrorCode =
  | "VALIDATION_ERROR"   // 400: bad or missing fields
  | "TURNSTILE_FAILED"   // 403: bot check failed or missing
  | "FORBIDDEN_ORIGIN"   // 403: Origin not in ALLOWED_ORIGINS
  | "NOT_FOUND"          // 404
  | "METHOD_NOT_ALLOWED" // 405: response includes an Allow header
  | "CONFLICT"           // 409
  | "PAYLOAD_TOO_LARGE"  // 413
  | "RATE_LIMITED"       // 429
  | "INTERNAL";          // 500

export interface ApiError {
  ok: false;
  error: { code: ApiErrorCode; message: string; fields?: Record<string, string> };
}

export type ApiResult<T> = ({ ok: true } & T) | ApiError;

// GET /api/health
export interface HealthResponse { version: string; time: string }

// POST /api/waitlist
export interface WaitlistRequest {
  email: string;               // trimmed, lowercased, max 254 chars, valid email
  consent: true;               // must be literally true
  source?: string;             // optional, max 50 chars, e.g. "instagram", "hero"
  turnstileToken: string;
}
export interface WaitlistResponse { alreadyJoined: boolean }

// POST /api/waitlist/remove
export interface WaitlistRemoveRequest { email: string; turnstileToken: string }
export type WaitlistRemoveResponse = Record<string, never>; // always { ok: true }

// POST /api/feedback
export type FeedbackCategory = "bug" | "idea" | "other";
export interface FeedbackRequest {
  category: FeedbackCategory;
  message: string;             // 5..2000 chars after trimming
  contact?: string;            // optional email, max 254
  meta?: ClientMeta;
  turnstileToken: string;
}
export interface FeedbackResponse { id: number }

// GET /api/features
export type FeatureStatus = "idea" | "planned" | "building" | "shipped";
export interface Feature {
  id: string;                  // slug, e.g. "hindi-captions"
  title: string;
  description: string;
  status: FeatureStatus;
  votes: number;
}
export interface FeaturesResponse { features: Feature[] } // sorted: status order, then votes desc

// POST /api/features/:id/vote   (vote)
// DELETE /api/features/:id/vote (remove vote)
export interface VoteRequest {
  voterId: string;             // random UUID v4 the browser generates and keeps in localStorage
  turnstileToken: string;
}
export interface VoteResponse { featureId: string; votes: number; voted: boolean }

// GET /api/stats
export interface StatsResponse {
  clipsExported: number;
  minutesProcessed: number;
  updatedAt: string;           // ISO 8601
}

// POST /api/stats/export
export interface ExportStatRequest {
  clips: number;               // integer 1..20
  sourceMinutes: number;       // number 0..600, rounded to 1 decimal on save
  turnstileToken: string;
}
export type ExportStatResponse = Record<string, never>;

// POST /api/errors  (opt-in, anonymous crash reports)
export type PipelineStage =
  | "load" | "demux" | "transcribe" | "pick" | "reframe" | "captions" | "encode" | "download" | "other";
export interface ErrorReportRequest {
  stage: PipelineStage;
  errorName: string;           // max 100 chars
  message: string;             // max 500 chars, truncate instead of rejecting
  meta?: ClientMeta;
  turnstileToken: string;
}
export type ErrorReportResponse = Record<string, never>;

export interface ClientMeta {
  appVersion?: string;         // max 20 chars
  browser?: string;            // max 100 chars, e.g. "Chrome 155"
  os?: string;                 // max 50 chars
  webgpu?: boolean;
  crossOriginIsolated?: boolean;
}
