import type { Env } from "./env";

const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

interface TurnstileResponse {
  success?: boolean;
}

export async function verifyTurnstile(
  token: string,
  request: Request,
  env: Env,
): Promise<boolean> {
  if (!token || !env.TURNSTILE_SECRET_KEY) {
    return false;
  }

  const form = new URLSearchParams({
    secret: env.TURNSTILE_SECRET_KEY,
    response: token,
  });
  const remoteIp = request.headers.get("CF-Connecting-IP");
  if (remoteIp) {
    form.set("remoteip", remoteIp);
  }

  try {
    const response = await fetch(TURNSTILE_VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form,
    });

    if (!response.ok) {
      return false;
    }

    const result = (await response.json()) as TurnstileResponse;
    return result.success === true;
  } catch {
    return false;
  }
}
