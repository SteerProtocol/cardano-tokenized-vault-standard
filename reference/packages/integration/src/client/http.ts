/** Fetch exactly once and bound the complete body, including error responses and chunked transfers. */
import { QUERY_BUDGET, QUERY_VERSION, QueryError } from "../query/index.js";
import { fields, literal, text } from "../query/schema.js";

const failure = fields({
  apiVersion: literal(QUERY_VERSION),
  error: fields({
    code: literal(
      "INVALID_REQUEST",
      "INVALID_RESPONSE",
      "READER_NOT_READY",
      "OUTSIDE_SCOPE",
      "HISTORY_INCOMPLETE",
      "NOT_FOUND",
      "STALE_BASIS",
      "UNSUPPORTED_CONSTRUCTION",
      "QUERY_LIMIT",
      "NETWORK_MISMATCH",
      "INTERNAL_ERROR",
    ),
    message: text,
  }),
});

async function readJson(response: Response): Promise<unknown> {
  if (response.headers.get("content-type")?.split(";")[0]?.trim() !== "application/json")
    throw new QueryError("INVALID_RESPONSE", "response is not JSON", 502);

  const reader = response.body?.getReader();

  if (!reader) throw new QueryError("INVALID_RESPONSE", "response body is missing", 502);

  const chunks: Uint8Array[] = [];
  let size = 0;

  try {
    for (;;) {
      const next = await reader.read();

      if (next.done) break;

      size += next.value.byteLength;

      if (size > QUERY_BUDGET.responseBytes)
        throw new QueryError("QUERY_LIMIT", "response exceeds budget", 413);

      chunks.push(next.value);
    }

    const bytes = new Uint8Array(size);
    let offset = 0;

    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }

    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch (error) {
    await reader.cancel().catch(() => {});

    if (
      error instanceof QueryError ||
      (error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name))
    )
      throw error;

    throw new QueryError("INVALID_RESPONSE", "invalid JSON response", 502);
  } finally {
    reader.releaseLock();
  }
}

export async function queryFetch(
  fetcher: typeof fetch,
  url: URL,
  options: RequestInit,
): Promise<unknown> {
  const response = await fetcher(url, options);
  const value = await readJson(response);

  if (response.ok) return value;

  let parsed: ReturnType<typeof failure.decode>;

  try {
    parsed = failure.decode(value);
  } catch {
    throw new QueryError("INVALID_RESPONSE", "invalid query error response", 502);
  }

  throw new QueryError(parsed.error.code, parsed.error.message, response.status);
}
