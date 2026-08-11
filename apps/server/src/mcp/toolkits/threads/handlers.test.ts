import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  IsoDateTime,
  MessageId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type OrchestrationCommand,
  type OrchestrationMessage,
  type OrchestrationThread,
  type OrchestrationThreadShell,
  type ServerProvider,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as OrchestrationEngine from "../../../orchestration/Services/OrchestrationEngine.ts";
import * as ProjectionSnapshotQuery from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import {
  ProjectionThreadRepository,
  type ProjectionThread,
} from "../../../persistence/Services/ProjectionThreads.ts";
import { makeProviderRegistryLayer } from "../../../provider/testUtils/providerRegistryMock.ts";
import {
  THREAD_READ_MESSAGE_CHARACTER_LIMIT,
  THREAD_READ_MESSAGE_LIMIT,
  threadsToolkitHandlers,
} from "./handlers.ts";

const now = IsoDateTime.make("2026-08-11T12:00:00.000Z");
const callerThreadId = ThreadId.make("thread-caller");
const targetThreadId = ThreadId.make("thread-target");
const projectId = ProjectId.make("project-1");
const otherProjectId = ProjectId.make("project-2");

const makeShell = (
  id: ThreadId,
  targetProjectId: ProjectId,
  overrides: Partial<OrchestrationThreadShell> = {},
): OrchestrationThreadShell => ({
  id,
  projectId: targetProjectId,
  title: id,
  modelSelection: {
    instanceId: ProviderInstanceId.make("codex-work"),
    model: "gpt-5.6-sol",
  },
  runtimeMode: "auto",
  interactionMode: "default",
  branch: null,
  worktreePath: null,
  latestTurn: null,
  createdAt: now,
  updatedAt: now,
  archivedAt: null,
  settledOverride: null,
  settledAt: null,
  snoozedUntil: null,
  snoozedAt: null,
  pinnedAt: null,
  pinOrderKey: null,
  titleRegeneration: null,
  voiceSession: null,
  session: null,
  latestUserMessageAt: null,
  hasPendingApprovals: false,
  hasPendingUserInput: false,
  hasActionableProposedPlan: false,
  backgroundLiveness: null,
  planProgress: null,
  ...overrides,
});

const makeMessage = (index: number, text: string): OrchestrationMessage => ({
  id: MessageId.make(`message-${index}`),
  role: index % 2 === 0 ? "user" : "assistant",
  text,
  turnId: TurnId.make(`turn-${index}`),
  streaming: false,
  createdAt: now,
  updatedAt: now,
});

const makeDetail = (
  shell: OrchestrationThreadShell,
  messages: ReadonlyArray<OrchestrationMessage> = [],
): OrchestrationThread => ({
  id: shell.id,
  projectId: shell.projectId,
  title: shell.title,
  modelSelection: shell.modelSelection,
  runtimeMode: shell.runtimeMode,
  interactionMode: shell.interactionMode,
  branch: shell.branch,
  worktreePath: shell.worktreePath,
  latestTurn: shell.latestTurn,
  createdAt: shell.createdAt,
  updatedAt: shell.updatedAt,
  archivedAt: shell.archivedAt,
  settledOverride: shell.settledOverride,
  settledAt: shell.settledAt,
  snoozedUntil: shell.snoozedUntil,
  snoozedAt: shell.snoozedAt,
  pinnedAt: shell.pinnedAt,
  pinOrderKey: shell.pinOrderKey,
  titleRegeneration: shell.titleRegeneration,
  voiceSession: shell.voiceSession,
  deletedAt: null,
  messages: [...messages],
  proposedPlans: [],
  activities: [],
  checkpoints: [],
  session: shell.session,
});

const makeProjectionRow = (
  shell: OrchestrationThreadShell,
  pendingApprovalCount = 0,
): ProjectionThread => ({
  threadId: shell.id,
  projectId: shell.projectId,
  title: shell.title,
  modelSelection: shell.modelSelection,
  runtimeMode: shell.runtimeMode,
  interactionMode: shell.interactionMode,
  branch: shell.branch,
  worktreePath: shell.worktreePath,
  latestTurnId: shell.latestTurn?.turnId ?? null,
  createdAt: shell.createdAt,
  updatedAt: shell.updatedAt,
  archivedAt: shell.archivedAt,
  settledOverride: shell.settledOverride,
  settledAt: shell.settledAt,
  snoozedUntil: shell.snoozedUntil ?? null,
  snoozedAt: shell.snoozedAt ?? null,
  pinnedAt: shell.pinnedAt ?? null,
  pinOrderKey: shell.pinOrderKey ?? null,
  titleRegenerationRequestId: shell.titleRegeneration?.requestId ?? null,
  titleRegenerationStartedAt: shell.titleRegeneration?.startedAt ?? null,
  voiceSessionStartedAt: shell.voiceSession?.startedAt ?? null,
  latestUserMessageAt: shell.latestUserMessageAt,
  pendingApprovalCount,
  pendingUserInputCount: 0,
  hasActionableProposedPlan: 0,
  deletedAt: null,
});

const provider = (
  instanceId: string,
  driver: "codex" | "claudeAgent",
  model: string,
): ServerProvider => ({
  instanceId: ProviderInstanceId.make(instanceId),
  driver: ProviderDriverKind.make(driver),
  enabled: true,
  installed: true,
  version: null,
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: now,
  availability: "available",
  models: [
    {
      slug: model,
      name: model,
      isCustom: false,
      isDefault: true,
      capabilities: null,
    },
  ],
  slashCommands: [],
  skills: [],
});

interface HarnessOptions {
  readonly shells?: ReadonlyArray<OrchestrationThreadShell>;
  readonly details?: ReadonlyArray<OrchestrationThread>;
  readonly rows?: ReadonlyArray<ProjectionThread>;
  readonly providers?: ReadonlyArray<ServerProvider>;
  readonly capabilities?: ReadonlySet<McpInvocationContext.McpCapability>;
  readonly commands?: Array<OrchestrationCommand>;
}

const makeHarnessLayer = (options: HarnessOptions = {}) => {
  const shells = options.shells ?? [makeShell(callerThreadId, projectId)];
  const details = options.details ?? shells.map((shell) => makeDetail(shell));
  const rows = options.rows ?? shells.map((shell) => makeProjectionRow(shell));
  const commands = options.commands ?? [];
  const invocation: McpInvocationContext.McpInvocationScope = {
    environmentId: EnvironmentId.make("environment-1"),
    threadId: callerThreadId,
    providerSessionId: "provider-session-1",
    providerInstanceId: ProviderInstanceId.make("codex-work"),
    capabilities: options.capabilities ?? new Set(["threads"]),
    issuedAt: 1,
  };

  return Layer.mergeAll(
    Layer.succeed(McpInvocationContext.McpInvocationContext, invocation),
    Layer.mock(OrchestrationEngine.OrchestrationEngineService)({
      dispatch: (command) =>
        Effect.sync(() => {
          commands.push(command);
          return { sequence: commands.length };
        }),
      readEvents: () => Stream.empty,
      streamDomainEvents: Stream.empty,
      latestSequence: Effect.succeed(0),
    }),
    Layer.mock(ProjectionSnapshotQuery.ProjectionSnapshotQuery)({
      getThreadShellById: (threadId) =>
        Effect.succeed(Option.fromUndefinedOr(shells.find((thread) => thread.id === threadId))),
      getThreadDetailById: (threadId) =>
        Effect.succeed(Option.fromUndefinedOr(details.find((thread) => thread.id === threadId))),
      getShellSnapshot: () =>
        Effect.succeed({
          snapshotSequence: 1,
          projects: [],
          threads: shells,
          updatedAt: now,
        }),
    }),
    Layer.mock(ProjectionThreadRepository)({
      getById: ({ threadId }) =>
        Effect.succeed(Option.fromUndefinedOr(rows.find((thread) => thread.threadId === threadId))),
    }),
    makeProviderRegistryLayer(
      options.providers ?? [provider("codex-work", "codex", "gpt-5.6-sol")],
    ),
    NodeServices.layer,
  );
};

it.effect("creates in the caller project then starts a turn with a complete model selection", () =>
  Effect.gen(function* () {
    const commands: Array<OrchestrationCommand> = [];
    const result = yield* threadsToolkitHandlers
      .t3_thread_create({ task: "Research the failing test", title: "Research test" })
      .pipe(Effect.provide(makeHarnessLayer({ commands })));

    expect(result.outcome).toBe("created");
    expect(commands).toHaveLength(2);
    expect(commands[0]).toMatchObject({
      type: "thread.create",
      projectId,
      title: "Research test",
      modelSelection: { instanceId: "codex-work", model: "gpt-5.6-sol" },
    });
    expect(commands[1]).toMatchObject({
      type: "thread.turn.start",
      message: { role: "user", text: "Research the failing test" },
      modelSelection: { instanceId: "codex-work", model: "gpt-5.6-sol" },
    });
    const createCommand = commands[0];
    const turnCommand = commands[1];
    if (createCommand?.type !== "thread.create" || turnCommand?.type !== "thread.turn.start") {
      throw new Error("Expected thread.create followed by thread.turn.start");
    }
    expect(turnCommand.threadId).toBe(createCommand.threadId);
  }),
);

it.effect("provider override selects an enabled instance and its default model", () =>
  Effect.gen(function* () {
    const commands: Array<OrchestrationCommand> = [];
    const result = yield* threadsToolkitHandlers
      .t3_thread_create({ task: "Review the diff", provider: "claude" })
      .pipe(
        Effect.provide(
          makeHarnessLayer({
            commands,
            providers: [
              provider("codex-work", "codex", "gpt-5.6-sol"),
              provider("claude-review", "claudeAgent", "claude-opus-4-6"),
            ],
          }),
        ),
      );

    expect(result).toMatchObject({ outcome: "created", provider: "claude" });
    expect(commands[0]).toMatchObject({
      modelSelection: { instanceId: "claude-review", model: "claude-opus-4-6" },
    });
    expect(commands[1]).toMatchObject({
      modelSelection: { instanceId: "claude-review", model: "claude-opus-4-6" },
    });
  }),
);

it.effect("returns busy without dispatching when send targets an active turn", () =>
  Effect.gen(function* () {
    const commands: Array<OrchestrationCommand> = [];
    const busy = makeShell(targetThreadId, projectId, {
      session: {
        threadId: targetThreadId,
        status: "running",
        providerName: "codex",
        providerInstanceId: ProviderInstanceId.make("codex-work"),
        runtimeMode: "auto",
        activeTurnId: TurnId.make("turn-active"),
        lastError: null,
        updatedAt: now,
      },
    });
    const result = yield* threadsToolkitHandlers
      .t3_thread_send({ threadId: targetThreadId, message: "Change direction" })
      .pipe(
        Effect.provide(
          makeHarnessLayer({
            commands,
            shells: [makeShell(callerThreadId, projectId), busy],
          }),
        ),
      );

    expect(result).toMatchObject({ outcome: "busy", threadId: targetThreadId });
    expect(commands).toEqual([]);
  }),
);

it.effect("sends an ordinary turn to an idle sibling", () =>
  Effect.gen(function* () {
    const commands: Array<OrchestrationCommand> = [];
    const result = yield* threadsToolkitHandlers
      .t3_thread_send({ threadId: targetThreadId, message: "Continue the review" })
      .pipe(
        Effect.provide(
          makeHarnessLayer({
            commands,
            shells: [makeShell(callerThreadId, projectId), makeShell(targetThreadId, projectId)],
          }),
        ),
      );

    expect(result).toMatchObject({ outcome: "sent", threadId: targetThreadId });
    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({
      type: "thread.turn.start",
      threadId: targetThreadId,
      message: { role: "user", text: "Continue the review" },
    });
  }),
);

it.effect("caps recent messages and hard-truncates each message", () =>
  Effect.gen(function* () {
    const caller = makeShell(callerThreadId, projectId);
    const target = makeShell(targetThreadId, projectId, { title: "Research" });
    const messages = Array.from({ length: THREAD_READ_MESSAGE_LIMIT + 3 }, (_, index) =>
      makeMessage(index, index === 8 ? "x".repeat(700) : `message-${index}`),
    );
    const result = yield* threadsToolkitHandlers.t3_thread_read({ threadId: targetThreadId }).pipe(
      Effect.provide(
        makeHarnessLayer({
          shells: [caller, target],
          details: [makeDetail(caller), makeDetail(target, messages)],
          rows: [makeProjectionRow(caller), makeProjectionRow(target, 3)],
        }),
      ),
    );

    expect(result.outcome).toBe("found");
    if (result.outcome !== "found") return;
    expect(result.pendingApprovalCount).toBe(3);
    expect(result.messages).toHaveLength(THREAD_READ_MESSAGE_LIMIT);
    expect(result.messages[0]?.text).toBe("message-3");
    expect(result.messages.at(-1)?.text).toHaveLength(THREAD_READ_MESSAGE_CHARACTER_LIMIT);
    expect(result.messages.at(-1)?.text.endsWith("...")).toBe(true);
  }),
);

it.effect("lists only active threads in the caller project", () =>
  Effect.gen(function* () {
    const caller = makeShell(callerThreadId, projectId);
    const active = makeShell(targetThreadId, projectId, { title: "Active" });
    const archived = makeShell(ThreadId.make("thread-archived"), projectId, {
      archivedAt: now,
    });
    const deleted = {
      ...makeShell(ThreadId.make("thread-deleted"), projectId),
      deletedAt: now,
    };
    const other = makeShell(ThreadId.make("thread-other"), otherProjectId);
    const result = yield* threadsToolkitHandlers
      .t3_thread_list({})
      .pipe(
        Effect.provide(makeHarnessLayer({ shells: [caller, active, archived, deleted, other] })),
      );

    expect(result.threads.map((thread) => thread.threadId)).toEqual([
      callerThreadId,
      targetThreadId,
    ]);
  }),
);

it.effect("interrupt on an idle thread is idempotent and dispatches nothing", () =>
  Effect.gen(function* () {
    const commands: Array<OrchestrationCommand> = [];
    const result = yield* threadsToolkitHandlers
      .t3_thread_interrupt({ threadId: targetThreadId })
      .pipe(
        Effect.provide(
          makeHarnessLayer({
            commands,
            shells: [makeShell(callerThreadId, projectId), makeShell(targetThreadId, projectId)],
          }),
        ),
      );
    expect(result).toMatchObject({ outcome: "idle", threadId: targetThreadId });
    expect(commands).toEqual([]);
  }),
);

it.effect("interrupt dispatches the active sibling turn identifier", () =>
  Effect.gen(function* () {
    const commands: Array<OrchestrationCommand> = [];
    const activeTurnId = TurnId.make("turn-active");
    const target = makeShell(targetThreadId, projectId, {
      session: {
        threadId: targetThreadId,
        status: "running",
        providerName: "codex",
        providerInstanceId: ProviderInstanceId.make("codex-work"),
        runtimeMode: "auto",
        activeTurnId,
        lastError: null,
        updatedAt: now,
      },
    });
    const result = yield* threadsToolkitHandlers
      .t3_thread_interrupt({ threadId: targetThreadId })
      .pipe(
        Effect.provide(
          makeHarnessLayer({
            commands,
            shells: [makeShell(callerThreadId, projectId), target],
          }),
        ),
      );

    expect(result).toMatchObject({ outcome: "interrupted", threadId: targetThreadId });
    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({
      type: "thread.turn.interrupt",
      threadId: targetThreadId,
      turnId: activeTurnId,
    });
  }),
);

it.effect("refuses self-send without dispatching", () =>
  Effect.gen(function* () {
    const commands: Array<OrchestrationCommand> = [];
    const result = yield* threadsToolkitHandlers
      .t3_thread_send({ threadId: callerThreadId, message: "Loop" })
      .pipe(Effect.provide(makeHarnessLayer({ commands })));
    expect(result).toMatchObject({ outcome: "refused", reason: "self_target" });
    expect(commands).toEqual([]);
  }),
);

it.effect("refuses self-interrupt without dispatching", () =>
  Effect.gen(function* () {
    const commands: Array<OrchestrationCommand> = [];
    const result = yield* threadsToolkitHandlers
      .t3_thread_interrupt({ threadId: callerThreadId })
      .pipe(Effect.provide(makeHarnessLayer({ commands })));
    expect(result).toMatchObject({ outcome: "refused", reason: "self_target" });
    expect(commands).toEqual([]);
  }),
);

it.effect("cross-project read returns not found", () =>
  Effect.gen(function* () {
    const result = yield* threadsToolkitHandlers.t3_thread_read({ threadId: targetThreadId }).pipe(
      Effect.provide(
        makeHarnessLayer({
          shells: [makeShell(callerThreadId, projectId), makeShell(targetThreadId, otherProjectId)],
        }),
      ),
    );
    expect(result).toMatchObject({ outcome: "not_found", threadId: targetThreadId });
  }),
);

it.effect("refuses a handler call without the threads capability", () =>
  Effect.gen(function* () {
    const error = yield* threadsToolkitHandlers
      .t3_thread_list({})
      .pipe(Effect.provide(makeHarnessLayer({ capabilities: new Set() })), Effect.flip);
    expect(error).toBeInstanceOf(McpInvocationContext.ThreadsCapabilityUnavailableError);
    expect(error.message).toBe("MCP credential does not grant the threads capability.");
  }),
);
