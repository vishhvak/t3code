import type { EnvironmentId, ScopedThreadRef, ThreadId } from "@t3tools/contracts";

export interface VoiceEntryAvailability {
  readonly visible: boolean;
  readonly disabledReason: string | null;
}

/**
 * Decides whether a composer shows a voice control. An absent capability hides
 * it entirely, which is how older servers stay usable, and a live session
 * disables it, because the server allows one voice session per environment and
 * the orb is the way to reach a running one.
 */
export function resolveVoiceEntryAvailability(input: {
  readonly realtimeVoiceCapability: boolean | undefined;
  readonly current: ScopedThreadRef | null;
  readonly canStartFromDraft?: boolean;
  readonly active: ScopedThreadRef | null;
}): VoiceEntryAvailability {
  if (
    input.realtimeVoiceCapability !== true ||
    (input.current === null && input.canStartFromDraft !== true)
  ) {
    return { visible: false, disabledReason: null };
  }
  if (input.active === null) return { visible: true, disabledReason: null };
  const sameThread =
    input.current !== null &&
    input.active.environmentId === input.current.environmentId &&
    input.active.threadId === input.current.threadId;
  return {
    visible: true,
    disabledReason: sameThread
      ? "Voice is already active on this thread."
      : "Another thread already holds the voice session.",
  };
}

/**
 * Finds the thread the server currently holds a voice session on, which is the
 * `active` argument above. Reads the projection rather than local session state
 * so a session another window started still disables the control here.
 */
export function findVoiceProjectedHome(
  shells: readonly {
    readonly environmentId: EnvironmentId;
    readonly id: ThreadId;
    readonly voiceSession?: unknown;
  }[],
): ScopedThreadRef | null {
  const shell = shells.find((candidate) => candidate.voiceSession != null);
  return shell ? { environmentId: shell.environmentId, threadId: shell.id } : null;
}
