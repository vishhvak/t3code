import type { OrchestrationThreadRealtimeEvent, ScopedThreadRef } from "@t3tools/contracts";

export type VoiceSessionPhase = "idle" | "listening" | "thinking" | "speaking";

export interface VoiceSessionSnapshot {
  readonly home: ScopedThreadRef;
  readonly phase: VoiceSessionPhase;
  readonly caption: string;
  readonly captionRole: "user" | "assistant" | null;
  readonly muted: boolean;
}

/**
 * Everything platform-specific about carrying voice: opening the microphone,
 * negotiating the peer connection, playing the agent back, and reporting how
 * loud each side currently is. The browser implements this with WebRTC and
 * the Web Audio API; React Native implements it with react-native-webrtc and
 * connection statistics. Audio itself never crosses the T3 Code pipe on
 * either platform, so this interface deliberately exposes no audio payload.
 */
export interface VoiceTransport {
  /**
   * Opens the microphone and returns the session description ("SDP offer")
   * with network candidates already gathered, which is what the agent needs
   * to complete the connection.
   */
  readonly open: () => Promise<string>;
  /** Applies the agent's answering session description. */
  readonly acceptAnswer: (sdp: string) => Promise<void>;
  readonly setMuted: (muted: boolean) => void;
  /** Microphone loudness, 0 to 1. */
  readonly localLevel: () => number;
  /** Agent voice loudness, 0 to 1. */
  readonly remoteLevel: () => number;
  readonly close: () => void;
}

export interface VoiceSessionControllerDependencies {
  readonly createTransport: () => VoiceTransport;
  readonly dispatchStart: (home: ScopedThreadRef, sdp: string) => Promise<unknown>;
  readonly dispatchStop: (home: ScopedThreadRef) => Promise<unknown>;
  readonly onChange: (snapshot: VoiceSessionSnapshot | null) => void;
}

/**
 * The whole voice session as a platform-free state machine: phases the orb
 * renders, captions accumulated from interleaved transcript deltas, and the
 * teardown ordering every exit path shares. Web and mobile run this exact
 * code and differ only in the transport they hand it.
 */
export class VoiceSessionController {
  private snapshot: VoiceSessionSnapshot | null = null;
  private transport: VoiceTransport | null = null;
  private projectionWasActive = false;
  private generation = 0;
  private readonly dependencies: VoiceSessionControllerDependencies;

  constructor(dependencies: VoiceSessionControllerDependencies) {
    this.dependencies = dependencies;
  }

  read(): VoiceSessionSnapshot | null {
    return this.snapshot;
  }

  async start(home: ScopedThreadRef): Promise<void> {
    if (this.snapshot !== null) return;
    const generation = ++this.generation;
    this.projectionWasActive = false;
    this.setSnapshot({ home, phase: "idle", caption: "", captionRole: null, muted: false });

    const transport = this.dependencies.createTransport();
    this.transport = transport;
    try {
      const sdp = await transport.open();
      // The user may have ended the session while the microphone permission
      // prompt or candidate gathering was still in flight.
      if (generation !== this.generation) {
        transport.close();
        return;
      }
      await this.dependencies.dispatchStart(home, sdp);
    } catch (error) {
      this.teardown();
      throw error;
    }
  }

  async handleRealtime(event: OrchestrationThreadRealtimeEvent): Promise<void> {
    const current = this.snapshot;
    if (current === null || event.threadId !== current.home.threadId) return;

    switch (event.type) {
      case "thread.realtime.started":
        this.patchSnapshot({ phase: "listening" });
        return;
      case "thread.realtime.sdp":
        if (this.transport === null) return;
        await this.transport.acceptAnswer(event.sdp);
        this.patchSnapshot({ phase: "listening" });
        return;
      case "thread.realtime.transcript.delta":
        this.patchSnapshot({
          phase: event.role === "assistant" ? "speaking" : "listening",
          captionRole: event.role,
          caption: current.captionRole === event.role ? current.caption + event.delta : event.delta,
        });
        return;
      case "thread.realtime.transcript.done":
        this.patchSnapshot({
          phase: event.role === "user" ? "thinking" : "listening",
          captionRole: event.role,
          caption: event.text,
        });
        return;
      case "thread.realtime.closed":
        this.teardown();
    }
  }

  /**
   * Mirrors the server's projected session state. The session only tears down
   * on an observed active-to-absent transition, so a projection that has not
   * caught up yet cannot kill a session that is still starting.
   */
  syncProjection(active: boolean): void {
    if (this.snapshot === null) return;
    if (active) {
      this.projectionWasActive = true;
      return;
    }
    if (this.projectionWasActive) this.teardown();
  }

  toggleMute(): void {
    const current = this.snapshot;
    if (current === null) return;
    const muted = !current.muted;
    this.transport?.setMuted(muted);
    this.patchSnapshot({ muted });
  }

  async end(): Promise<void> {
    const current = this.snapshot;
    if (current === null) return;
    const dispatch = this.dependencies.dispatchStop(current.home);
    this.teardown();
    await dispatch;
  }

  close(): void {
    this.teardown();
  }

  /** Drives the orb's motion: whichever side currently holds the floor. */
  readonly getSignalLevel = (): number => {
    if (this.snapshot?.phase === "speaking") return this.transport?.remoteLevel() ?? 0;
    if (this.snapshot?.phase === "listening") {
      return Math.min(1, (this.transport?.localLevel() ?? 0) * 6);
    }
    return 0;
  };

  private patchSnapshot(patch: Partial<Omit<VoiceSessionSnapshot, "home">>): void {
    if (this.snapshot === null) return;
    this.setSnapshot({ ...this.snapshot, ...patch });
  }

  private setSnapshot(snapshot: VoiceSessionSnapshot | null): void {
    this.snapshot = snapshot;
    this.dependencies.onChange(snapshot);
  }

  private teardown(): void {
    ++this.generation;
    this.transport?.close();
    this.transport = null;
    this.projectionWasActive = false;
    if (this.snapshot !== null) this.setSnapshot(null);
  }
}
