import { useAtomValue } from "@effect/atom-react";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import {
  findVoiceProjectedHome,
  VoiceSessionController,
  type VoiceSessionSnapshot,
} from "@t3tools/client-runtime/voice";
import type { OrchestrationThreadRealtimeEvent, ScopedThreadRef } from "@t3tools/contracts";
import { AsyncResult } from "effect/unstable/reactivity";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { CommandId } from "@t3tools/contracts";

import { uuidv4 } from "../../lib/uuid";
import { useThreadShell, useThreadShells } from "../../state/entities";
import { useAtomCommand } from "../../state/use-atom-command";

import { createNativeVoiceTransport } from "./nativeVoiceTransport";
import { VoiceOrb } from "./VoiceOrb";
import { requestVoiceHome, voiceEnvironment } from "./voiceState";

interface VoiceSessionContextValue {
  readonly session: VoiceSessionSnapshot | null;
  readonly projectedHome: ScopedThreadRef | null;
  readonly start: (home: ScopedThreadRef) => Promise<void>;
  readonly toggleMute: () => void;
  readonly end: () => Promise<void>;
}

const VoiceSessionContext = createContext<VoiceSessionContextValue | null>(null);

export function useVoiceSession(): VoiceSessionContextValue {
  const value = useContext(VoiceSessionContext);
  if (value === null) {
    throw new Error("useVoiceSession must be used inside VoiceSessionProvider.");
  }
  return value;
}

/**
 * Feeds the session controller the realtime events for its home thread and
 * mirrors the projected session state, exactly as the web bridge does.
 */
function VoiceRealtimeBridge({
  home,
  controller,
}: {
  readonly home: ScopedThreadRef;
  readonly controller: VoiceSessionController;
}) {
  const eventResult = useAtomValue(
    voiceEnvironment.realtimeEvents({
      environmentId: home.environmentId,
      input: { threadId: home.threadId },
    }),
  );
  const thread = useThreadShell(home);

  useEffect(() => {
    if (!AsyncResult.isSuccess(eventResult)) return;
    void controller
      .handleRealtime(eventResult.value as OrchestrationThreadRealtimeEvent)
      .catch(() => controller.close());
  }, [controller, eventResult]);

  useEffect(() => {
    controller.syncProjection(thread?.voiceSession != null);
  }, [controller, thread?.voiceSession]);

  return null;
}

/**
 * Mounts above navigation so a voice session survives moving between threads,
 * which is the same guarantee the web shell gives.
 */
export function VoiceSessionProvider({ children }: { readonly children: ReactNode }) {
  const dispatch = useAtomCommand(voiceEnvironment.dispatch, { reportFailure: false });
  const [session, setSession] = useState<VoiceSessionSnapshot | null>(null);
  // Derived during render, not in an effect: an effect leaves one render with
  // no snapshot at all, which unmounts the orb and remounts it a frame later.
  const [visibleSession, setVisibleSession] = useState<VoiceSessionSnapshot | null>(null);
  if (session !== null && session !== visibleSession) setVisibleSession(session);
  const threadShells = useThreadShells();

  const controller = useMemo(
    () =>
      new VoiceSessionController({
        createTransport: createNativeVoiceTransport,
        onChange: setSession,
        dispatchStart: async (home, sdp) => {
          const result = await dispatch({
            environmentId: home.environmentId,
            input: {
              type: "thread.voice.start",
              commandId: CommandId.make(uuidv4()),
              threadId: home.threadId,
              sdp,
              createdAt: new Date().toISOString(),
            },
          });
          if (result._tag === "Failure") throw squashAtomCommandFailure(result);
        },
        dispatchStop: async (home) => {
          const result = await dispatch({
            environmentId: home.environmentId,
            input: {
              type: "thread.voice.stop",
              commandId: CommandId.make(uuidv4()),
              threadId: home.threadId,
              createdAt: new Date().toISOString(),
            },
          });
          if (result._tag === "Failure") throw squashAtomCommandFailure(result);
        },
      }),
    [dispatch],
  );

  useEffect(() => () => controller.close(), [controller]);

  const projectedHome = useMemo(() => findVoiceProjectedHome(threadShells), [threadShells]);

  const start = useCallback(
    async (home: ScopedThreadRef) => {
      try {
        await controller.start(home);
      } catch {
        // Failures surface through the absent orb; the microphone permission
        // dialog is the common cause and the user already saw it.
        controller.close();
      }
    },
    [controller],
  );

  const end = useCallback(async () => {
    try {
      await controller.end();
    } catch {
      controller.close();
    }
  }, [controller]);

  const value = useMemo<VoiceSessionContextValue>(
    () => ({
      session,
      projectedHome,
      start,
      toggleMute: () => controller.toggleMute(),
      end,
    }),
    [controller, end, projectedHome, session, start],
  );

  return (
    <VoiceSessionContext.Provider value={value}>
      {children}
      {session ? <VoiceRealtimeBridge home={session.home} controller={controller} /> : null}
      {visibleSession ? (
        <VoiceOrb
          session={visibleSession}
          closing={session === null}
          onClosed={() => setVisibleSession(null)}
          getSignalLevel={controller.getSignalLevel}
          onToggleMute={() => controller.toggleMute()}
          onEnd={() => void end()}
          onOpenHome={() => requestVoiceHome(visibleSession.home)}
        />
      ) : null}
    </VoiceSessionContext.Provider>
  );
}
