import { z } from "zod";
import { validationError } from "./responses";

interface ParsedBody<T> {
  data: T;
}

interface FailedBody {
  response: Response;
}

export async function parseJsonBody<Schema extends z.ZodType>(
  request: Request,
  schema: Schema,
): Promise<ParsedBody<z.output<Schema>> | FailedBody> {
  let value: unknown;

  try {
    value = await request.json();
  } catch {
    return {
      response: validationError("Request body must be valid JSON.", {
        body: "must be valid JSON",
      }),
    };
  }

  const parsed = schema.safeParse(value);
  if (parsed.success) {
    return { data: parsed.data };
  }

  const fields: Record<string, string> = {};
  for (const issue of parsed.error.issues) {
    const field = issue.path.length > 0 ? issue.path.map(String).join(".") : "body";
    if (fields[field]) {
      continue;
    }

    fields[field] = humanizeIssue(issue);
  }

  return {
    response: validationError("Request validation failed.", fields),
  };
}

function humanizeIssue(issue: z.core.$ZodIssue): string {
  if (issue.code === "invalid_type") {
    return issue.input === undefined ? "is required" : "has an invalid type";
  }

  if (issue.code === "too_small") {
    return "is too short";
  }

  if (issue.code === "too_big") {
    return "is too long";
  }

  if (issue.code === "invalid_format") {
    return "has an invalid format";
  }

  return issue.message;
}
