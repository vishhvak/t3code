import { ORCHESTRATION_WS_METHODS } from "@t3tools/contracts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "@t3tools/client-runtime/state/runtime";
import * as Result from "effect/Result";
import * as Stream from "effect/Stream";

import { connectionAtomRuntime } from "../connection/runtime";

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
