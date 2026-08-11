import {
  CommandId,
  MessageId,
  ProviderDriverKind,
  ThreadId,
  TurnId,
  type OrchestrationThreadShell,
  type ServerProvider,
} from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as OrchestrationEngine from "../../../orchestration/Services/OrchestrationEngine.ts";
import * as ProjectionSnapshotQuery from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as ProjectionThreads from "../../../persistence/Services/ProjectionThreads.ts";
import * as ProviderRegistry from "../../../provider/Services/ProviderRegistry.ts";
import { ThreadsToolkit, ThreadsToolkitError, type T3ThreadProvider } from "./tools.ts";

export const THREAD_READ_MESSAGE_LIMIT = 6;
export const THREAD_READ_MESSAGE_CHARACTER_LIMIT = 400;
const THREAD_TITLE_CHARACTER_LIMIT = 80;

const providerDriver = (provider: T3ThreadProvider): ProviderDriverKind =>
  ProviderDriverKind.make(provider === "claude" ? "claudeAgent" : provider);

const providerLabel = (provider: ServerProvider | undefined, instanceId: string): string =>
  provider?.driver === "claudeAgent" ? "claude" : (provider?.driver ?? instanceId);

const hasActiveTurn = (thread: OrchestrationThreadShell): boolean =>
  thread.session?.activeTurnId != null ||
  thread.session?.status === "starting" ||
  thread.session?.status === "running";

const isWorking = (thread: OrchestrationThreadShell): boolean =>
  hasActiveTurn(thread) || thread.backgroundLiveness === "working";

const truncateMessage = (text: string): string =>
  text.length <= THREAD_READ_MESSAGE_CHARACTER_LIMIT
    ? text
    : `${text.slice(0, THREAD_READ_MESSAGE_CHARACTER_LIMIT - 3)}...`;

const deriveTitle = (task: string): string => {
  const firstLine = task.split("\n", 1)[0]?.trim().replace(/\s+/g, " ");
  const title = firstLine && firstLine.length > 0 ? firstLine : "New thread";
  return title.slice(0, THREAD_TITLE_CHARACTER_LIMIT);
};

const projectionFailure = () =>
  new ThreadsToolkitError({
    reason: "projection_failed",
    message: "T3 Code could not read the thread projection.",
  });

const dispatchFailure = () =>
  new ThreadsToolkitError({
    reason: "dispatch_failed",
    message: "T3 Code could not dispatch the thread command.",
  });

const identifierFailure = () =>
  new ThreadsToolkitError({
    reason: "identifier_failed",
    message: "T3 Code could not generate thread command identifiers.",
  });

const notFound = (threadId: string) => ({
  outcome: "not_found" as const,
  threadId,
  message: "No active thread with that identifier exists in the calling thread's project.",
});

const selfRefused = (threadId: string) => ({
  outcome: "refused" as const,
  threadId,
  reason: "self_target" as const,
  message: "A thread cannot steer or interrupt itself during its own turn.",
});

const loadCallerAndTarget = Effect.fn("ThreadsToolkit.loadCallerAndTarget")(function* (
  callerThreadId: ThreadId,
  targetThreadId: ThreadId,
) {
  const query = yield* ProjectionSnapshotQuery.ProjectionSnapshotQuery;
  const caller = yield* query
    .getThreadShellById(callerThreadId)
    .pipe(Effect.mapError(projectionFailure));
  if (Option.isNone(caller)) return undefined;
  const target = yield* query
    .getThreadShellById(targetThreadId)
    .pipe(Effect.mapError(projectionFailure));
  if (Option.isNone(target) || target.value.projectId !== caller.value.projectId) return undefined;
  return { caller: caller.value, target: target.value };
});

const makeIdHelpers = Effect.fn("ThreadsToolkit.makeIdHelpers")(function* () {
  const crypto = yield* Crypto.Crypto;
  const uuid = crypto.randomUUIDv4.pipe(Effect.mapError(identifierFailure));
  return {
    commandId: (operation: string) =>
      uuid.pipe(Effect.map((value) => CommandId.make(`mcp:threads:${operation}:${value}`))),
    messageId: uuid.pipe(Effect.map(MessageId.make)),
    threadId: uuid.pipe(Effect.map(ThreadId.make)),
  };
});

export const threadsToolkitHandlers = {
  t3_thread_create: (input) =>
    Effect.gen(function* () {
      const scope = yield* McpInvocationContext.requireMcpCapability("threads");
      const query = yield* ProjectionSnapshotQuery.ProjectionSnapshotQuery;
      const engine = yield* OrchestrationEngine.OrchestrationEngineService;
      const registry = yield* ProviderRegistry.ProviderRegistry;
      const caller = yield* query
        .getThreadShellById(scope.threadId)
        .pipe(Effect.mapError(projectionFailure));
      if (Option.isNone(caller)) {
        return {
          outcome: "refused" as const,
          reason: "caller_not_found" as const,
          message: "The calling thread is no longer active in this environment.",
        };
      }

      const providers = yield* registry.getProviders;
      const callerProvider = providers.find(
        (provider) => provider.instanceId === caller.value.modelSelection.instanceId,
      );
      let selectedProvider = callerProvider;
      let modelSelection = caller.value.modelSelection;

      if (input.provider !== undefined) {
        const desiredDriver = providerDriver(input.provider);
        if (callerProvider?.driver !== desiredDriver) {
          selectedProvider = providers.find(
            (provider) =>
              provider.driver === desiredDriver &&
              provider.enabled &&
              provider.installed &&
              provider.availability !== "unavailable",
          );
          const defaultModel =
            selectedProvider?.models.find((model) => model.isDefault)?.slug ??
            selectedProvider?.models[0]?.slug;
          if (!selectedProvider || !defaultModel) {
            return {
              outcome: "refused" as const,
              reason: "provider_unavailable" as const,
              message: `No enabled ${input.provider} provider instance with a default model is configured.`,
            };
          }
          modelSelection = {
            instanceId: selectedProvider.instanceId,
            model: defaultModel,
          };
        }
      }

      const ids = yield* makeIdHelpers();
      const threadId = yield* ids.threadId;
      const createdAt = DateTime.formatIso(yield* DateTime.now);
      const task = input.task.trim();
      const title = input.title?.trim() || deriveTitle(task);

      yield* engine
        .dispatch({
          type: "thread.create",
          commandId: yield* ids.commandId("create"),
          threadId,
          projectId: caller.value.projectId,
          title,
          modelSelection,
          runtimeMode: caller.value.runtimeMode,
          interactionMode: caller.value.interactionMode,
          branch: null,
          worktreePath: null,
          createdAt,
        })
        .pipe(Effect.mapError(dispatchFailure));

      yield* engine
        .dispatch({
          type: "thread.turn.start",
          commandId: yield* ids.commandId("turn-start"),
          threadId,
          message: {
            messageId: yield* ids.messageId,
            role: "user",
            text: task,
            attachments: [],
          },
          modelSelection,
          runtimeMode: caller.value.runtimeMode,
          interactionMode: caller.value.interactionMode,
          createdAt,
        })
        .pipe(Effect.mapError(dispatchFailure));

      return {
        outcome: "created" as const,
        threadId,
        title,
        provider: providerLabel(selectedProvider, modelSelection.instanceId),
      };
    }),

  t3_thread_send: (input) =>
    Effect.gen(function* () {
      const scope = yield* McpInvocationContext.requireMcpCapability("threads");
      if (input.threadId === scope.threadId) return selfRefused(input.threadId);
      const targetThreadId = ThreadId.make(input.threadId);
      const scoped = yield* loadCallerAndTarget(scope.threadId, targetThreadId);
      if (!scoped) return notFound(input.threadId);
      if (hasActiveTurn(scoped.target)) {
        return {
          outcome: "busy" as const,
          threadId: input.threadId,
          message: "The target thread has an active turn. Nothing was queued or interrupted.",
        };
      }

      const engine = yield* OrchestrationEngine.OrchestrationEngineService;
      const ids = yield* makeIdHelpers();
      yield* engine
        .dispatch({
          type: "thread.turn.start",
          commandId: yield* ids.commandId("send"),
          threadId: targetThreadId,
          message: {
            messageId: yield* ids.messageId,
            role: "user",
            text: input.message.trim(),
            attachments: [],
          },
          modelSelection: scoped.target.modelSelection,
          runtimeMode: scoped.target.runtimeMode,
          interactionMode: scoped.target.interactionMode,
          createdAt: DateTime.formatIso(yield* DateTime.now),
        })
        .pipe(Effect.mapError(dispatchFailure));
      return { outcome: "sent" as const, threadId: input.threadId };
    }),

  t3_thread_read: (input) =>
    Effect.gen(function* () {
      const scope = yield* McpInvocationContext.requireMcpCapability("threads");
      const targetThreadId = ThreadId.make(input.threadId);
      const scoped = yield* loadCallerAndTarget(scope.threadId, targetThreadId);
      if (!scoped) return notFound(input.threadId);
      const query = yield* ProjectionSnapshotQuery.ProjectionSnapshotQuery;
      const repository = yield* ProjectionThreads.ProjectionThreadRepository;
      const [detail, row] = yield* Effect.all(
        [
          query.getThreadDetailById(targetThreadId),
          repository.getById({ threadId: targetThreadId }),
        ],
        { concurrency: "unbounded" },
      ).pipe(Effect.mapError(projectionFailure));
      if (Option.isNone(detail) || Option.isNone(row)) return notFound(input.threadId);

      return {
        outcome: "found" as const,
        threadId: input.threadId,
        title: scoped.target.title,
        status: isWorking(scoped.target) ? ("working" as const) : ("idle" as const),
        pendingApprovalCount: row.value.pendingApprovalCount,
        messages: detail.value.messages.slice(-THREAD_READ_MESSAGE_LIMIT).map((message) => ({
          role: message.role,
          text: truncateMessage(message.text),
        })),
      };
    }),

  t3_thread_list: (_input) =>
    Effect.gen(function* () {
      const scope = yield* McpInvocationContext.requireMcpCapability("threads");
      const query = yield* ProjectionSnapshotQuery.ProjectionSnapshotQuery;
      const caller = yield* query
        .getThreadShellById(scope.threadId)
        .pipe(Effect.mapError(projectionFailure));
      if (Option.isNone(caller)) return { threads: [] };
      const snapshot = yield* query.getShellSnapshot().pipe(Effect.mapError(projectionFailure));
      return {
        threads: snapshot.threads
          .filter(
            (thread) =>
              thread.projectId === caller.value.projectId &&
              thread.archivedAt === null &&
              (!("deletedAt" in thread) || thread.deletedAt === null),
          )
          .map((thread) => ({
            threadId: thread.id,
            title: thread.title,
            status: isWorking(thread) ? ("working" as const) : ("idle" as const),
            updatedAt: thread.updatedAt,
          })),
      };
    }),

  t3_thread_interrupt: (input) =>
    Effect.gen(function* () {
      const scope = yield* McpInvocationContext.requireMcpCapability("threads");
      if (input.threadId === scope.threadId) return selfRefused(input.threadId);
      const targetThreadId = ThreadId.make(input.threadId);
      const scoped = yield* loadCallerAndTarget(scope.threadId, targetThreadId);
      if (!scoped) return notFound(input.threadId);
      const activeTurnId = scoped.target.session?.activeTurnId;
      if (activeTurnId == null) {
        return {
          outcome: "idle" as const,
          threadId: input.threadId,
          message: "The target thread has no active turn to interrupt.",
        };
      }

      const engine = yield* OrchestrationEngine.OrchestrationEngineService;
      const ids = yield* makeIdHelpers();
      yield* engine
        .dispatch({
          type: "thread.turn.interrupt",
          commandId: yield* ids.commandId("interrupt"),
          threadId: targetThreadId,
          turnId: TurnId.make(activeTurnId),
          createdAt: DateTime.formatIso(yield* DateTime.now),
        })
        .pipe(Effect.mapError(dispatchFailure));
      return { outcome: "interrupted" as const, threadId: input.threadId };
    }),
} satisfies Parameters<typeof ThreadsToolkit.toLayer>[0];

export const ThreadsToolkitHandlersLive = ThreadsToolkit.toLayer(threadsToolkitHandlers);
