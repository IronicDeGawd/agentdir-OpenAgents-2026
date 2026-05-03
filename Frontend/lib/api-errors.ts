import "server-only";

// Stable, non-revealing error strings returned to clients. Full detail is
// logged server-side keyed by the request id.

export type ApiErrorCode =
  | "BAD_INPUT"
  | "ENS_INVALID"
  | "ENS_NOT_FOUND"
  | "ENS_LOOKUP_FAILED"
  | "STORAGE_UNAVAILABLE"
  | "DIRECTORY_FAILED"
  | "REP_FAILED"
  | "INTERNAL";

const MESSAGES: Record<ApiErrorCode, string> = {
  BAD_INPUT: "Invalid request",
  ENS_INVALID: "Invalid ENS name",
  ENS_NOT_FOUND: "ENS name not found",
  ENS_LOOKUP_FAILED: "ENS lookup failed",
  STORAGE_UNAVAILABLE: "Storage unavailable",
  DIRECTORY_FAILED: "Directory query failed",
  REP_FAILED: "Reputation lookup failed",
  INTERNAL: "Internal error",
};

export function newRequestId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export interface ApiErrorBody {
  error: string;
  code: ApiErrorCode;
  requestId: string;
}

export function apiError(
  code: ApiErrorCode,
  err: unknown,
  context: string,
): { body: ApiErrorBody; status: number } {
  const requestId = newRequestId();
  const status =
    code === "BAD_INPUT" || code === "ENS_INVALID"
      ? 400
      : code === "ENS_NOT_FOUND"
        ? 404
        : 502;
  console.error(
    `[api:${context}] requestId=${requestId} code=${code}`,
    err instanceof Error ? err.stack ?? err.message : err,
  );
  return {
    body: { error: MESSAGES[code], code, requestId },
    status,
  };
}
