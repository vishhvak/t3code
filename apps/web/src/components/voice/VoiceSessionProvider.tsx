import { useAtomValue } from "@effect/atom-react";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { findVoiceProjectedHome } from "@t3tools/client-runtime/voice";
import type { OrchestrationThreadRealtimeEvent, ScopedThreadRef } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { AsyncResult } from "effect/unstable/reactivity";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { newCommandId } from "~/lib/utils";
import { useThread, useThreadShells } from "~/state/entities";
import { useAtomCommand } from "~/state/use-atom-command";
import { voiceEnvironment } from "~/state/voice";
import { toastManager } from "~/components/ui/toast";
import { useVoiceOrbColors } from "~/voiceOrbColor";
import {
  createBrowserVoiceTransport,
  VoiceSessionController,
  type VoiceSessionSnapshot,
} from "~/voiceSessionController";

import { VoiceOrbWidget } from "./VoiceOrbWidget";

interface VoiceSessionContextValue {
  readonly session: VoiceSessionSnapshot | null;
  readonly projectedHome: ScopedThreadRef | null;
  readonly start: (
    home: ScopedThreadRef,
    options?: { readonly provisional?: boolean },
  ) => Promise<void>;
  readonly toggleMute: () => void;
  readonly end: () => Promise<void>;
}

const VoiceSessionContext = createContext<VoiceSessionContextValue | null>(null);

export function useVoiceSession(): VoiceSessionContextValue {
  const value = useContext(VoiceSessionContext);
  if (value === null) throw new Error("useVoiceSession must be used inside VoiceSessionProvider.");
  return value;
}

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
  const thread = useThread(home);

  useEffect(() => {
    if (!AsyncResult.isSuccess(eventResult)) return;
    void controller
      .handleRealtime(eventResult.value as OrchestrationThreadRealtimeEvent)
      .catch((error) => {
        controller.close();
        toastManager.add({
          type: "error",
          title: "Voice connection closed",
          description: error instanceof Error ? error.message : String(error),
        });
      });
  }, [controller, eventResult]);

  useEffect(() => {
    controller.syncProjection(thread?.voiceSession != null);
  }, [controller, thread?.voiceSession]);

  return null;
}

export function VoiceSessionProvider({ children }: { readonly children: ReactNode }) {
  const navigate = useNavigate();
  const dispatch = useAtomCommand(voiceEnvironment.dispatch, { reportFailure: false });
  const [session, setSession] = useState<VoiceSessionSnapshot | null>(null);
  // Holds the last snapshot so the widget can dissolve out before unmounting.
  // This is derived during render, not in an effect: an effect leaves one
  // render where both are null, which unmounts the orb and remounts it a
  // frame later, restarting its entry animation and moving it.
  const [visibleSession, setVisibleSession] = useState<VoiceSessionSnapshot | null>(null);
  if (session !== null && session !== visibleSession) setVisibleSession(session);
  // A voice thread created from the home draft stays provisional until the
  // first user utterance persists: promoted (navigate to it) once something
  // is said, deleted like an abandoned draft if the session closes silent.
  const provisionalHomeRef = useRef<ScopedThreadRef | null>(null);
  const previousSessionRef = useRef<VoiceSessionSnapshot | null>(null);
  const threadShells = useThreadShells();
  const colors = useVoiceOrbColors();

  const controller = useMemo(
    () =>
      new VoiceSessionController({
        createTransport: createBrowserVoiceTransport,
        onChange: setSession,
        dispatchStart: async (home, sdp) => {
          const result = await dispatch({
            environmentId: home.environmentId,
            input: {
              type: "thread.voice.start",
              commandId: newCommandId(),
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
              commandId: newCommandId(),
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

  const deleteProvisionalThread = useCallback(
    (home: ScopedThreadRef) => {
      void dispatch({
        environmentId: home.environmentId,
        input: {
          type: "thread.delete",
          commandId: newCommandId(),
          threadId: home.threadId,
        },
      });
    },
    [dispatch],
  );

  useEffect(() => {
    if (session === null && previousSessionRef.current !== null) {
      // The session closed with nothing said: the provisional thread
      // vanishes the way an abandoned draft does.
      const provisional = provisionalHomeRef.current;
      if (provisional !== null) {
        provisionalHomeRef.current = null;
        deleteProvisionalThread(provisional);
      }
    }
    previousSessionRef.current = session;
  }, [deleteProvisionalThread, session]);

  // Promotion: the first persisted user utterance makes the provisional
  // thread real; move focus onto it with an ordinary route transition (the
  // shell-mounted orb rides along, so the session feels continuous).
  useEffect(() => {
    const provisional = provisionalHomeRef.current;
    if (provisional === null) return;
    const shell = threadShells.find(
      (candidate) =>
        candidate.environmentId === provisional.environmentId &&
        candidate.id === provisional.threadId,
    );
    if (shell?.latestUserMessageAt == null) return;
    provisionalHomeRef.current = null;
    void navigate({
      to: "/$environmentId/$threadId",
      params: { environmentId: provisional.environmentId, threadId: provisional.threadId },
    });
  }, [navigate, threadShells]);

  const projectedHome = useMemo(() => findVoiceProjectedHome(threadShells), [threadShells]);

  const start = useCallback(
    async (home: ScopedThreadRef, options?: { readonly provisional?: boolean }) => {
      provisionalHomeRef.current = options?.provisional ? home : null;
      try {
        await controller.start(home);
      } catch (error) {
        // A provisional thread whose session never started is an abandoned
        // draft (for example, microphone permission denied).
        if (provisionalHomeRef.current !== null) {
          deleteProvisionalThread(provisionalHomeRef.current);
          provisionalHomeRef.current = null;
        }
        toastManager.add({
          type: "error",
          title: "Could not start voice",
          description: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [controller, deleteProvisionalThread],
  );

  const end = useCallback(async () => {
    try {
      await controller.end();
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Voice ended locally",
        description: error instanceof Error ? error.message : String(error),
      });
    }
  }, [controller]);

  const navigateHome = useCallback(() => {
    const home = controller.read()?.home;
    if (!home) return;
    void navigate({
      to: "/$environmentId/$threadId",
      params: { environmentId: home.environmentId, threadId: home.threadId },
    });
  }, [controller, navigate]);

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
        <VoiceOrbWidget
          session={visibleSession}
          colors={colors}
          closing={session === null}
          onClosed={() => setVisibleSession(null)}
          getSignalLevel={controller.getSignalLevel}
          onToggleMute={() => controller.toggleMute()}
          onEnd={() => void end()}
          onNavigateHome={navigateHome}
        />
      ) : null}
    </VoiceSessionContext.Provider>
  );
}
