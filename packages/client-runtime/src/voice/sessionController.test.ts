import { EnvironmentId, ThreadId, type ScopedThreadRef } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  VoiceSessionController,
  type VoiceSessionSnapshot,
  type VoiceTransport,
} from "./sessionController.ts";

const home: ScopedThreadRef = {
  environmentId: EnvironmentId.make("environment-1"),
  threadId: ThreadId.make("thread-1"),
};

function createHarness() {
  const acceptedAnswers: Array<string> = [];
  const close = vi.fn();
  const setMuted = vi.fn();
  const transport: VoiceTransport = {
    open: async () => "offer-with-gathered-candidates",
    acceptAnswer: async (sdp) => {
      acceptedAnswers.push(sdp);
    },
    setMuted,
    localLevel: () => 0.1,
    remoteLevel: () => 0.8,
    close,
  };
  const snapshots: Array<VoiceSessionSnapshot | null> = [];
  const dispatchStart = vi.fn(async () => undefined);
  const dispatchStop = vi.fn(async () => undefined);
  const controller = new VoiceSessionController({
    createTransport: () => transport,
    dispatchStart,
    dispatchStop,
    onChange: (snapshot) => snapshots.push(snapshot),
  });
  return { acceptedAnswers, close, controller, dispatchStart, dispatchStop, setMuted, snapshots };
}

describe("VoiceSessionController", () => {
  it("dispatches the start command with the transport's gathered offer", async () => {
    const harness = createHarness();

    await harness.controller.start(home);

    expect(harness.dispatchStart).toHaveBeenCalledWith(home, "offer-with-gathered-candidates");
  });

  it("applies the answer and maps interleaved transcript events to captions and orb states", async () => {
    const harness = createHarness();
    await harness.controller.start(home);

    await harness.controller.handleRealtime({
      type: "thread.realtime.sdp",
      threadId: home.threadId,
      sdp: "answer-sdp",
    });
    expect(harness.acceptedAnswers).toEqual(["answer-sdp"]);
    expect(harness.controller.read()?.phase).toBe("listening");

    await harness.controller.handleRealtime({
      type: "thread.realtime.transcript.delta",
      threadId: home.threadId,
      role: "user",
      delta: "what is ",
    });
    await harness.controller.handleRealtime({
      type: "thread.realtime.transcript.delta",
      threadId: home.threadId,
      role: "user",
      delta: "failing?",
    });
    expect(harness.controller.read()).toMatchObject({
      phase: "listening",
      captionRole: "user",
      caption: "what is failing?",
    });

    await harness.controller.handleRealtime({
      type: "thread.realtime.transcript.done",
      threadId: home.threadId,
      role: "user",
      text: "what is failing?",
    });
    expect(harness.controller.read()?.phase).toBe("thinking");

    await harness.controller.handleRealtime({
      type: "thread.realtime.transcript.delta",
      threadId: home.threadId,
      role: "assistant",
      delta: "One test",
    });
    expect(harness.controller.read()).toMatchObject({
      phase: "speaking",
      captionRole: "assistant",
      caption: "One test",
    });
  });

  it("reads the level of whichever side holds the floor", async () => {
    const harness = createHarness();
    await harness.controller.start(home);

    await harness.controller.handleRealtime({
      type: "thread.realtime.started",
      threadId: home.threadId,
    });
    // Listening amplifies the quiet microphone signal.
    expect(harness.controller.getSignalLevel()).toBeCloseTo(0.6, 5);

    await harness.controller.handleRealtime({
      type: "thread.realtime.transcript.delta",
      threadId: home.threadId,
      role: "assistant",
      delta: "speaking now",
    });
    expect(harness.controller.getSignalLevel()).toBeCloseTo(0.8, 5);
  });

  it("closes the transport when the server closes the session", async () => {
    const harness = createHarness();
    await harness.controller.start(home);

    await harness.controller.handleRealtime({
      type: "thread.realtime.closed",
      threadId: home.threadId,
      reason: "provider closed",
    });

    expect(harness.close).toHaveBeenCalledOnce();
    expect(harness.controller.read()).toBeNull();
    expect(harness.snapshots.at(-1)).toBeNull();
  });

  it("tears down after an active voiceSession disappears from projection", async () => {
    const harness = createHarness();
    await harness.controller.start(home);

    harness.controller.syncProjection(true);
    harness.controller.syncProjection(false);

    expect(harness.close).toHaveBeenCalledOnce();
    expect(harness.controller.read()).toBeNull();
  });

  it("ignores a projection that has not yet caught up with a starting session", async () => {
    const harness = createHarness();
    await harness.controller.start(home);

    harness.controller.syncProjection(false);

    expect(harness.close).not.toHaveBeenCalled();
    expect(harness.controller.read()).not.toBeNull();
  });

  it("mutes through the transport without ending the session", async () => {
    const harness = createHarness();
    await harness.controller.start(home);

    harness.controller.toggleMute();

    expect(harness.setMuted).toHaveBeenCalledWith(true);
    expect(harness.controller.read()?.muted).toBe(true);
    expect(harness.close).not.toHaveBeenCalled();
  });

  it("dispatches stop and performs the same local teardown from the end control", async () => {
    const harness = createHarness();
    await harness.controller.start(home);

    await harness.controller.end();

    expect(harness.dispatchStop).toHaveBeenCalledWith(home);
    expect(harness.close).toHaveBeenCalledOnce();
    expect(harness.controller.read()).toBeNull();
  });
});
