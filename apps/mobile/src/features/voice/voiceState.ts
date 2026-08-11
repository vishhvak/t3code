import { ORCHESTRATION_WS_METHODS, type ScopedThreadRef } from "@t3tools/contracts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "@t3tools/client-runtime/state/runtime";
import * as Result from "effect/Result";
import * as Stream from "effect/Stream";
import { Atom } from "effect/unstable/reactivity";

import { connectionAtomRuntime } from "../../connection/runtime";
import { appAtomRegistry } from "../../state/atom-registry";

// Signals RootStackLayout (inside the navigation tree) that the orb was tapped.
// The orb mounts above the navigation container so a session survives moving
// between screens, which also leaves it with no navigation object of its own.
export const voiceHomeRequestAtom = Atom.make<ScopedThreadRef | null>(null).pipe(
  Atom.keepAlive,
  Atom.withLabel("mobile:voice-home-request"),
);

export function requestVoiceHome(home: ScopedThreadRef): void {
  appAtomRegistry.set(voiceHomeRequestAtom, home);
}

export function clearVoiceHomeRequest(): void {
  appAtomRegistry.set(voiceHomeRequestAtom, null);
}

/**
 * Voice reuses the ordinary command and thread-subscription methods; the
 * realtime events it needs arrive as a distinct arm of the same per-thread
 * stream, so no new protocol or channel exists on either platform.
 */
export const voiceEnvironment = {
  dispatch: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "environment-data:commands:thread:voice",
    tag: ORCHESTRATION_WS_METHODS.dispatchCommand,
  }),
  realtimeEvents: createEnvironmentRpcSubscriptionAtomFamily(connectionAtomRuntime, {
    label: "environment-data:orchestration:thread-realtime",
    tag: ORCHESTRATION_WS_METHODS.subscribeThread,
    idleTtlMs: 0,
    transform: (stream) =>
      stream.pipe(
        Stream.filterMap((item) =>
          item.kind === "realtime" ? Result.succeed(item.event) : Result.failVoid,
        ),
      ),
  }),
};
