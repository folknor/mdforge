import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PageEnvironment } from "../src/driver.ts";
import { type CdpChannel, FrameEnvironment } from "../src/frame-environment.ts";

const environment: PageEnvironment = {
  viewport: { width: 800, height: 600, deviceScaleFactor: 1 },
  mediaType: "screen",
};

interface Sent {
  method: string;
  sessionId: string | undefined;
}

/** A channel recording what is sent; `failing` methods reject. */
function channel(failing: string[] = [], attached = true): CdpChannel & { sent: Sent[] } {
  const sent: Sent[] = [];

  return {
    sent,
    async send(method, _params, sessionId) {
      sent.push({ method, sessionId });

      if (failing.includes(method)) throw new Error(`${method} failed`);
    },
    isAttached: () => attached,
  };
}

const rejected = async (promise: Promise<never>): Promise<boolean> =>
  Promise.race([
    promise.then(
      () => false,
      () => true,
    ),
    new Promise<boolean>((resolve) => setImmediate(() => resolve(false))),
  ]);

describe("FrameEnvironment", () => {
  it("sets the page, then auto-attaches", async () => {
    const cdp = channel();
    await new FrameEnvironment(cdp, environment).apply();

    assert.deepEqual(
      cdp.sent.map((s) => s.method),
      ["Emulation.setDeviceMetricsOverride", "Emulation.setEmulatedMedia", "Target.setAutoAttach"],
    );
  });

  it("gives a child the media and its own auto-attach before releasing it", async () => {
    const cdp = channel();
    const frames = new FrameEnvironment(cdp, environment);
    frames.attached("child");
    await frames.settled();

    assert.deepEqual(cdp.sent, [
      { method: "Emulation.setEmulatedMedia", sessionId: "child" },
      { method: "Target.setAutoAttach", sessionId: "child" },
      { method: "Runtime.runIfWaitingForDebugger", sessionId: "child" },
    ]);
    assert.equal(await rejected(frames.failure), false);
  });

  it("releases and fails a live child whose setup failed", async () => {
    const cdp = channel(["Emulation.setEmulatedMedia"]);
    const frames = new FrameEnvironment(cdp, environment);
    frames.attached("child");
    await frames.settled();

    assert.equal(cdp.sent.at(-1)?.method, "Runtime.runIfWaitingForDebugger");
    assert.equal(await rejected(frames.failure), true);
  });

  it("fails a live child that could not be released", async () => {
    const frames = new FrameEnvironment(channel(["Runtime.runIfWaitingForDebugger"]), environment);
    frames.attached("child");
    await frames.settled();

    assert.equal(await rejected(frames.failure), true);
  });

  it("ignores failures of a child whose frame has gone", async () => {
    const frames = new FrameEnvironment(
      channel(["Emulation.setEmulatedMedia", "Runtime.runIfWaitingForDebugger"], false),
      environment,
    );

    frames.attached("child");
    await frames.settled();

    assert.equal(await rejected(frames.failure), false);
  });
});
