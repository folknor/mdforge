/**
 * Applies the page environment over the Chrome DevTools Protocol to the page
 * and to every out-of-process frame it gets, for both drivers.
 *
 * Chromium keeps emulated media per renderer process, set through a debugger
 * session attached to that process's frame target. A cross-origin iframe runs
 * in its own process (site isolation), so media set on the page's session
 * never reaches it: without this it prints with print media whatever
 * page_media_type says. So the root session auto-attaches to iframe targets,
 * paused before they run, and each gets the media before it is let go;
 * nested ones the same way through their parent's session. An iframe that
 * later becomes in-process again (a same-site navigation) is covered by its
 * parent's process and needs nothing.
 *
 * Emulation is session-local bookkeeping writing settings shared by every
 * session on the target: attaching another session to the page can reset
 * them (observed: a second session attached to a Puppeteer page discarded the
 * media Puppeteer had set). So a driver sends every command for a page
 * through one session it keeps for the page's life, and opens no other.
 */

import type { PageEnvironment, PageValue } from "./driver.ts";

/** A protocol command's parameters: JSON data. */
export type CdpParams = { [key: string]: PageValue };

/**
 * A driver's debugger session for one page: commands to the page's own
 * target (no `sessionId`) or to a child target attached through it. Command
 * results are not needed, only whether a command succeeded.
 */
export interface CdpChannel {
  send(method: string, params: CdpParams, sessionId?: string): Promise<void>;
  /** Whether a child session is still attached (its frame not gone). */
  isAttached(sessionId: string): boolean;
}

const AUTO_ATTACH = {
  autoAttach: true,
  waitForDebuggerOnStart: true,
  flatten: true,
  filter: [{ type: "iframe", exclude: false }],
};

/** The environment of one page and its out-of-process frames. */
export class FrameEnvironment {
  /** Rejects when a live frame could not be given the environment. Never resolves. */
  readonly failure: Promise<never>;
  readonly #channel: CdpChannel;
  readonly #environment: PageEnvironment;
  readonly #fail: (error: Error) => void;
  readonly #pending = new Set<Promise<void>>();

  constructor(channel: CdpChannel, environment: PageEnvironment) {
    this.#channel = channel;
    this.#environment = environment;

    const { promise, reject } = Promise.withResolvers<never>();
    this.failure = promise;
    this.failure.catch(() => undefined);
    this.#fail = reject;
  }

  /** Set the environment on the page's own target, before anything loads. */
  async apply(): Promise<void> {
    const { viewport, mediaType } = this.#environment;

    await this.#channel.send("Emulation.setDeviceMetricsOverride", {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: viewport.deviceScaleFactor,
      mobile: false,
    });
    await this.#channel.send("Emulation.setEmulatedMedia", { media: mediaType });
    await this.#channel.send("Target.setAutoAttach", AUTO_ATTACH);
  }

  /**
   * A child target attached through the channel (Target.attachedToTarget).
   * It waits until released, which always happens; a frame that went away
   * meanwhile is no failure, a live one left without its media is.
   */
  attached(sessionId: string): void {
    const setup = (async () => {
      try {
        await this.#channel.send(
          "Emulation.setEmulatedMedia",
          { media: this.#environment.mediaType },
          sessionId,
        );
        await this.#channel.send("Target.setAutoAttach", AUTO_ATTACH, sessionId);
      } catch (error) {
        this.#failIfLive(sessionId, "could not be given the page settings", String(error));
      } finally {
        try {
          await this.#channel.send("Runtime.runIfWaitingForDebugger", {}, sessionId);
        } catch (error) {
          this.#failIfLive(sessionId, "could not be resumed", String(error));
        }
      }
    })();

    this.#pending.add(setup);
    void setup.finally(() => this.#pending.delete(setup));
  }

  /** A child command failed: a failure unless its frame has gone. */
  #failIfLive(sessionId: string, what: string, reason: string): void {
    if (this.#channel.isAttached(sessionId)) this.#fail(new Error(`An iframe ${what}: ${reason}`));
  }

  /** Settles once every frame attached so far has been set up. */
  async settled(): Promise<void> {
    while (this.#pending.size > 0) await Promise.all(this.#pending);
  }
}
