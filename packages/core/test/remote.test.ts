import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fetchBytes, fetchText } from "../src/lib/remote.ts";

/** A response whose body sends `first` and then whatever `rest` does. */
function streamed(first: string, rest: (controller: ReadableStreamDefaultController) => void) {
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(first));
        rest(controller);
      },
    }),
  );
}

describe("remote requests", () => {
  it("time out a fetch that never settles", async () => {
    const result = await fetchText("https://x.example/", {
      fetch: () => new Promise<Response>(() => {}),
      timeoutMs: 30,
    });

    assert.deepEqual(result, { ok: false, failure: { kind: "timeout", ms: 30 } });
  });

  it("time out a body that stalls after the headers", async () => {
    const result = await fetchText("https://x.example/", {
      fetch: async () => streamed("<svg", () => {}),
      timeoutMs: 30,
    });

    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.failure.kind, "timeout");
  });

  it("time out a body that keeps trickling", async () => {
    let timer: ReturnType<typeof setInterval> | undefined;

    try {
      const result = await fetchBytes("https://x.example/", {
        fetch: async () =>
          streamed("a", (controller) => {
            timer = setInterval(() => controller.enqueue(new Uint8Array([1])), 5);
          }),
        timeoutMs: 60,
      });

      assert.equal(!result.ok && result.failure.kind, "timeout");
    } finally {
      clearInterval(timer);
    }
  });

  it("pass the signal on, so a real fetch is aborted", async () => {
    let seen: AbortSignal | undefined;

    await fetchText("https://x.example/", {
      fetch: (_input, init) => {
        seen = init?.signal ?? undefined;

        return new Promise<Response>(() => {});
      },
      timeoutMs: 20,
    });

    assert.equal(seen?.aborted, true);
  });

  it("report an HTTP failure by status and cancel its body", async () => {
    let cancelled = false;

    const body = new ReadableStream({
      cancel() {
        cancelled = true;
      },
    });

    const result = await fetchText("https://x.example/", {
      fetch: async () => new Response(body, { status: 503, statusText: "Busy" }),
    });

    assert.deepEqual(result, {
      ok: false,
      failure: { kind: "http", status: 503, statusText: "Busy" },
    });
    assert.equal(cancelled, true);
  });

  it("report an HTTP failure even if cancelling its body never settles", async () => {
    const body = new ReadableStream({
      cancel: () => new Promise<void>(() => {}),
    });

    const result = await fetchText("https://x.example/", {
      fetch: async () => new Response(body, { status: 500 }),
      timeoutMs: 30,
    });

    assert.equal(!result.ok && result.failure.kind, "http");
  });

  it("report a network error by its message", async () => {
    const result = await fetchText("https://x.example/", {
      fetch: async () => {
        throw new Error("ECONNREFUSED");
      },
    });

    assert.deepEqual(result, { ok: false, failure: { kind: "network", message: "ECONNREFUSED" } });
  });

  it("return the body of a successful response", async () => {
    const result = await fetchBytes("https://x.example/", {
      fetch: async () => new Response(new Uint8Array([1, 2, 3])),
    });

    assert.deepEqual(result, { ok: true, value: new Uint8Array([1, 2, 3]) });
  });
});
