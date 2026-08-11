import {
  CommandId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationReadModel,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { decideOrchestrationCommand } from "./decider.ts";

const NOW = "2026-08-10T00:00:00.000Z";

function readModel(provider = "codex", voiceSession: { startedAt: string } | null = null) {
  return {
    snapshotSequence: 0,
    projects: [],
    threads: [
      {
        id: ThreadId.make("thread-1"),
        projectId: ProjectId.make("project-1"),
        title: "Voice thread",
        modelSelection: {
          instanceId: ProviderInstanceId.make(provider),
          model: "model",
        },
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        latestTurn: null,
        createdAt: NOW,
        updatedAt: NOW,
        archivedAt: null,
        settledOverride: null,
        settledAt: null,
        deletedAt: null,
        messages: [],
        proposedPlans: [],
        activities: [],
        checkpoints: [],
        session: null,
        voiceSession,
      },
    ],
    updatedAt: NOW,
  } satisfies OrchestrationReadModel;
}

const startCommand = {
  type: "thread.voice.start" as const,
  commandId: CommandId.make("voice-start"),
  threadId: ThreadId.make("thread-1"),
  sdp: "v=0\r\n",
  createdAt: NOW,
};

it.layer(NodeServices.layer)("voice session decider", (it) => {
  it.effect("refuses start when the environment setting is off", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        decideOrchestrationCommand({ command: startCommand, readModel: readModel() }),
      );
      expect(error.message).toContain("Voice mode is disabled");
    }),
  );

  it.effect("refuses a non-Codex thread", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        decideOrchestrationCommand({
          command: startCommand,
          readModel: readModel("claude-agent"),
          voiceModeEnabled: true,
        }),
      );
      expect(error.message).toContain("does not use the Codex provider");
    }),
  );

  it.effect("refuses a second environment voice session with an explicit thread", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        decideOrchestrationCommand({
          command: startCommand,
          readModel: readModel("codex", { startedAt: NOW }),
          voiceModeEnabled: true,
        }),
      );
      expect(error.message).toContain("already active in thread 'thread-1'");
    }),
  );

  it.effect("accepts stop when active and when already stopped", () =>
    Effect.gen(function* () {
      for (const model of [readModel("codex", { startedAt: NOW }), readModel()]) {
        const event = yield* decideOrchestrationCommand({
          command: {
            type: "thread.voice.stop",
            commandId: CommandId.make(`stop-${model.threads[0]?.voiceSession ? "active" : "idle"}`),
            threadId: ThreadId.make("thread-1"),
            createdAt: NOW,
          },
          readModel: model,
          voiceModeEnabled: true,
        });
        const events = Array.isArray(event) ? event : [event];
        expect(events[0]?.type).toBe("thread.voice-session-stopped");
      }
    }),
  );
});
