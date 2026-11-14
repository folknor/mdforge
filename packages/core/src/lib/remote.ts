/**
 * Every remote request core makes (Iconify icons, Google Fonts CSS and font
 * files) goes through here. The rule: one deadline per request, started before
 * the request and covering connect, headers and the whole body, so an
 * unresponsive or trickling server cannot hold up a conversion. Node's fetch
 * only has inactivity timeouts of its own, which a slow body resets.
 *
 * Failure is a value naming why, never an exception; callers turn it into a
 * warning.
 */

/** Per-request deadline in milliseconds. */
export const REMOTE_TIMEOUT_MS = 15_000;

export type RemoteOptions = {
  /** Fetch implementation (tests inject one). */
  fetch?: typeof fetch;
  headers?: Record<string, string>;
  /** Deadline for the whole request; defaults to REMOTE_TIMEOUT_MS. */
  timeoutMs?: number;
};

export type RemoteFailure =
  | { kind: "timeout"; ms: number }
  | { kind: "http"; status: number; statusText: string }
  | { kind: "network"; message: string };

export type RemoteResult<T> = { ok: true; value: T } | { ok: false; failure: RemoteFailure };

export function describeFailure(failure: RemoteFailure): string {
  switch (failure.kind) {
    case "timeout":
      return `no complete response within ${failure.ms / 1000} s`;
    case "http":
      return `HTTP ${failure.status}${failure.statusText ? ` ${failure.statusText}` : ""}`;
    case "network":
      return failure.message;
  }
}

async function request<T>(
  url: string | URL,
  options: RemoteOptions,
  read: (response: Response) => Promise<T>,
): Promise<RemoteResult<T>> {
  const ms = options.timeoutMs ?? REMOTE_TIMEOUT_MS;
  const fetchImpl = options.fetch ?? fetch;
  const controller = new AbortController();
  const signal = controller.signal;

  // The signal aborts the real fetch and its body; racing the deadline as well
  // makes it hold even for a fetch implementation that ignores signals. A
  // referenced timer (unlike AbortSignal.timeout's) keeps the process alive
  // until the deadline settles the request.
  let timer: ReturnType<typeof setTimeout> | undefined;

  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      const reason = new DOMException(`Timed out after ${ms} ms`, "TimeoutError");
      controller.abort(reason);
      reject(reason);
    }, ms);
  });

  const attempt = async (): Promise<RemoteResult<T>> => {
    const response = await fetchImpl(url, { headers: options.headers, signal });

    if (!response.ok) {
      // Not awaited: a cancellation that never settles must not turn a known
      // HTTP failure into a timeout.
      response.body?.cancel().catch(() => undefined);

      return {
        ok: false,
        failure: { kind: "http", status: response.status, statusText: response.statusText },
      };
    }

    return { ok: true, value: await read(response) };
  };

  const pending = attempt();

  // Whichever loses the race must not surface as an unhandled rejection.
  pending.catch(() => undefined);

  try {
    return await Promise.race([pending, deadline]);
  } catch (error) {
    // The body read can fail with an abort error of another name; the signal
    // is the authority on whether the deadline passed.
    if (signal.aborted) {
      return { ok: false, failure: { kind: "timeout", ms } };
    }

    const message = error instanceof Error ? error.message : String(error);

    return { ok: false, failure: { kind: "network", message } };
  } finally {
    clearTimeout(timer);
  }
}

export function fetchText(
  url: string | URL,
  options: RemoteOptions = {},
): Promise<RemoteResult<string>> {
  return request(url, options, (response) => response.text());
}

export function fetchBytes(
  url: string | URL,
  options: RemoteOptions = {},
): Promise<RemoteResult<Uint8Array>> {
  return request(url, options, async (response) => new Uint8Array(await response.arrayBuffer()));
}
