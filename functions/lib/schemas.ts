import { z } from "zod";
import type {
  ErrorReportRequest,
  ExportStatRequest,
  FeedbackRequest,
  VoteRequest,
  WaitlistRemoveRequest,
  WaitlistRequest,
} from "../../shared/api-types";

const CONTROL_CHARS = /[\u0000-\u001F\u007F]/;
const CONTROL_CHARS_EXCEPT_NEWLINES = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

function cleanString(max: number, field: string, allowNewlines = false) {
  return z
    .string()
    .trim()
    .max(max, `${field} is too long`)
    .refine(
      (value) => !(allowNewlines ? CONTROL_CHARS_EXCEPT_NEWLINES : CONTROL_CHARS).test(value),
      `${field} contains invalid control characters`,
    );
}

const emailSchema = cleanString(254, "email")
  .toLowerCase()
  .email("email must be valid");

const contactSchema = cleanString(254, "contact")
  .toLowerCase()
  .email("contact must be valid");

// A missing or malformed token becomes "", which verifyTurnstile rejects, so the client gets
// 403 TURNSTILE_FAILED (per the contract) instead of a 400 validation error.
const turnstileTokenSchema = z.string().trim().catch("");

const feedbackCategorySchema = z.preprocess(
  trimIfString,
  z.enum(["bug", "idea", "other"]),
);

const pipelineStageSchema = z.preprocess(
  trimIfString,
  z.enum([
    "load",
    "demux",
    "transcribe",
    "pick",
    "reframe",
    "captions",
    "encode",
    "download",
    "other",
  ]),
);

export const clientMetaSchema = z.object({
  appVersion: cleanString(20, "appVersion").optional(),
  browser: cleanString(100, "browser").optional(),
  os: cleanString(50, "os").optional(),
  webgpu: z.boolean().optional(),
  crossOriginIsolated: z.boolean().optional(),
});

export const waitlistSchema = z.object({
  email: emailSchema,
  consent: z.literal(true),
  source: cleanString(50, "source").optional(),
  turnstileToken: turnstileTokenSchema,
}) satisfies z.ZodType<WaitlistRequest>;

export const waitlistRemoveSchema = z.object({
  email: emailSchema,
  turnstileToken: turnstileTokenSchema,
}) satisfies z.ZodType<WaitlistRemoveRequest>;

export const feedbackSchema = z.object({
  category: feedbackCategorySchema,
  message: cleanString(2000, "message", true).min(5, "message is too short"),
  contact: contactSchema.optional(),
  meta: clientMetaSchema.optional(),
  turnstileToken: turnstileTokenSchema,
}) satisfies z.ZodType<FeedbackRequest>;

export const voteSchema = z.object({
  voterId: z
    .string()
    .trim()
    .toLowerCase()
    .regex(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      "voterId must be a UUID v4",
    ),
  turnstileToken: turnstileTokenSchema,
}) satisfies z.ZodType<VoteRequest>;

export const exportStatSchema = z.object({
  clips: z.number().int("clips must be an integer").min(1, "clips is too small").max(20, "clips is too large"),
  sourceMinutes: z
    .number()
    .finite("sourceMinutes must be finite")
    .min(0, "sourceMinutes is too small")
    .max(600, "sourceMinutes is too large")
    .transform((value) => Math.round(value * 10) / 10),
  turnstileToken: turnstileTokenSchema,
}) satisfies z.ZodType<ExportStatRequest>;

export const errorReportSchema = z.object({
  stage: pipelineStageSchema,
  errorName: cleanString(100, "errorName"),
  message: cleanString(Number.MAX_SAFE_INTEGER, "message", true).transform((value) => value.slice(0, 500)),
  meta: clientMetaSchema.optional(),
  turnstileToken: turnstileTokenSchema,
}) satisfies z.ZodType<ErrorReportRequest>;

export function isFeatureId(value: string): boolean {
  return /^[a-z0-9-]{1,50}$/.test(value);
}

function trimIfString(value: unknown): unknown {
  return typeof value === "string" ? value.trim() : value;
}
