import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { findVoiceProjectedHome, resolveVoiceEntryAvailability } from "./entryAvailability.ts";

const current = {
  environmentId: EnvironmentId.make("environment-1"),
  threadId: ThreadId.make("thread-1"),
};

describe("resolveVoiceEntryAvailability", () => {
  it("hides the control when the server does not advertise realtime voice", () => {
    expect(
      resolveVoiceEntryAvailability({
        realtimeVoiceCapability: undefined,
        current,
        active: null,
      }),
    ).toEqual({ visible: false, disabledReason: null });
  });

  it("shows an enabled control when no session is running", () => {
    expect(
      resolveVoiceEntryAvailability({ realtimeVoiceCapability: true, current, active: null }),
    ).toEqual({ visible: true, disabledReason: null });
  });

  it("shows the control on a draft when voice can create the thread", () => {
    expect(
      resolveVoiceEntryAvailability({
        realtimeVoiceCapability: true,
        current: null,
        canStartFromDraft: true,
        active: null,
      }),
    ).toEqual({ visible: true, disabledReason: null });
  });

  it("hides the control on a draft that cannot create a thread", () => {
    expect(
      resolveVoiceEntryAvailability({
        realtimeVoiceCapability: true,
        current: null,
        active: null,
      }),
    ).toEqual({ visible: false, disabledReason: null });
  });

  it("disables the control while another thread holds the session", () => {
    expect(
      resolveVoiceEntryAvailability({
        realtimeVoiceCapability: true,
        current,
        active: { environmentId: current.environmentId, threadId: ThreadId.make("thread-2") },
      }),
    ).toEqual({
      visible: true,
      disabledReason: "Another thread already holds the voice session.",
    });
  });

  it("disables the control on the thread that already holds the session", () => {
    expect(
      resolveVoiceEntryAvailability({ realtimeVoiceCapability: true, current, active: current }),
    ).toEqual({ visible: true, disabledReason: "Voice is already active on this thread." });
  });
});

describe("findVoiceProjectedHome", () => {
  const shell = (id: string, voiceSession: unknown) => ({
    environmentId: current.environmentId,
    id: ThreadId.make(id),
    voiceSession,
  });

  it("returns nothing when no thread holds a session", () => {
    expect(findVoiceProjectedHome([shell("thread-1", null), shell("thread-2", null)])).toBeNull();
  });

  it("returns the thread the server holds the session on", () => {
    expect(
      findVoiceProjectedHome([shell("thread-1", null), shell("thread-2", { startedAt: "now" })]),
    ).toEqual({ environmentId: current.environmentId, threadId: ThreadId.make("thread-2") });
  });
});
