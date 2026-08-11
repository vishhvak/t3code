import * as Schema from "effect/Schema";
import * as Crypto from "effect/Crypto";
import { Tool, Toolkit } from "effect/unstable/ai";

import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as OrchestrationEngine from "../../../orchestration/Services/OrchestrationEngine.ts";
import * as ProjectionSnapshotQuery from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as ProviderRegistry from "../../../provider/Services/ProviderRegistry.ts";
import * as ProjectionThreads from "../../../persistence/Services/ProjectionThreads.ts";

export const T3ThreadProvider = Schema.Literals(["claude", "opencode", "cursor", "grok", "codex"]);
export type T3ThreadProvider = typeof T3ThreadProvider.Type;

export class ThreadsToolkitError extends Schema.TaggedErrorClass<ThreadsToolkitError>()(
  "ThreadsToolkitError",
  {
    reason: Schema.Literals(["projection_failed", "dispatch_failed", "identifier_failed"]),
    message: Schema.String,
  },
) {}

const ThreadsToolFailure = Schema.Union([
  McpInvocationContext.ThreadsCapabilityUnavailableError,
  ThreadsToolkitError,
]);

const ThreadIdField = Schema.String.annotate({
  description:
    "The exact T3 Code thread identifier returned by t3_thread_create, t3_thread_list, or another T3 thread tool.",
});

const NotFoundOutcome = Schema.Struct({
  outcome: Schema.Literal("not_found"),
  threadId: Schema.String,
  message: Schema.String,
});

const RefusedOutcome = Schema.Struct({
  outcome: Schema.Literal("refused"),
  threadId: Schema.String,
  reason: Schema.Literal("self_target"),
  message: Schema.String,
});

export const T3ThreadCreateInput = Schema.Struct({
  task: Schema.String.check(Schema.isMinLength(1), Schema.isPattern(/\S/)).annotate({
    description:
      "The complete first user message for the real sibling T3 Code thread. Include the goal, scope, constraints, and expected result.",
  }),
  title: Schema.optional(
    Schema.String.check(Schema.isMinLength(1)).annotate({
      description:
        "An optional short sidebar title. Omit it to derive a compact title from the task.",
    }),
  ),
  provider: Schema.optional(
    T3ThreadProvider.annotate({
      description:
        "The configured provider kind for the sibling thread. Omit it to inherit the calling thread's provider instance and model.",
    }),
  ),
});

export const T3ThreadCreateOutput = Schema.Union([
  Schema.Struct({
    outcome: Schema.Literal("created"),
    threadId: Schema.String,
    title: Schema.String,
    provider: Schema.String,
  }),
  Schema.Struct({
    outcome: Schema.Literal("refused"),
    reason: Schema.Literals(["caller_not_found", "provider_unavailable"]),
    message: Schema.String,
  }),
]);

export const T3ThreadSendInput = Schema.Struct({
  threadId: ThreadIdField,
  message: Schema.String.check(Schema.isMinLength(1), Schema.isPattern(/\S/)).annotate({
    description:
      "The complete next user message to start as a normal turn in the target T3 Code thread.",
  }),
});

export const T3ThreadSendOutput = Schema.Union([
  Schema.Struct({
    outcome: Schema.Literal("sent"),
    threadId: Schema.String,
  }),
  Schema.Struct({
    outcome: Schema.Literal("busy"),
    threadId: Schema.String,
    message: Schema.String,
  }),
  NotFoundOutcome,
  RefusedOutcome,
]);

export const T3ThreadReadInput = Schema.Struct({ threadId: ThreadIdField });

const T3ThreadMessageSummary = Schema.Struct({
  role: Schema.Literals(["user", "assistant", "system"]),
  text: Schema.String,
});

export const T3ThreadReadOutput = Schema.Union([
  Schema.Struct({
    outcome: Schema.Literal("found"),
    threadId: Schema.String,
    title: Schema.String,
    status: Schema.Literals(["working", "idle"]),
    pendingApprovalCount: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    messages: Schema.Array(T3ThreadMessageSummary),
  }),
  NotFoundOutcome,
]);

export const T3ThreadListInput = Schema.Record(Schema.String, Schema.Never);

export const T3ThreadListOutput = Schema.Struct({
  threads: Schema.Array(
    Schema.Struct({
      threadId: Schema.String,
      title: Schema.String,
      status: Schema.Literals(["working", "idle"]),
      updatedAt: Schema.String,
    }),
  ),
});

export const T3ThreadInterruptInput = Schema.Struct({ threadId: ThreadIdField });

export const T3ThreadInterruptOutput = Schema.Union([
  Schema.Struct({
    outcome: Schema.Literal("interrupted"),
    threadId: Schema.String,
  }),
  Schema.Struct({
    outcome: Schema.Literal("idle"),
    threadId: Schema.String,
    message: Schema.String,
  }),
  NotFoundOutcome,
  RefusedOutcome,
]);

const dependencies = [
  McpInvocationContext.McpInvocationContext,
  OrchestrationEngine.OrchestrationEngineService,
  ProjectionSnapshotQuery.ProjectionSnapshotQuery,
  ProviderRegistry.ProviderRegistry,
  ProjectionThreads.ProjectionThreadRepository,
  Crypto.Crypto,
];

export const T3ThreadCreateTool = Tool.make("t3_thread_create", {
  description:
    "Create a real sibling T3 Code thread that appears in the sidebar, then start its first turn. Use this whenever the user says create, start, or spin up a thread or chat, or wants delegated work visible in T3 Code. Do not use an internal subagent or collaboration tool for those requests.",
  parameters: T3ThreadCreateInput,
  success: T3ThreadCreateOutput,
  failure: ThreadsToolFailure,
  dependencies,
})
  .annotate(Tool.Title, "Create T3 Code thread")
  .annotate(Tool.Destructive, true);

export const T3ThreadSendTool = Tool.make("t3_thread_send", {
  description:
    "Send a normal user turn to an existing real T3 Code thread. Use this to steer or continue a thread or chat visible in the T3 Code sidebar. It never queues or interrupts a busy thread, so inspect the send outcome and decide what to do next. Do not substitute an internal subagent message.",
  parameters: T3ThreadSendInput,
  success: T3ThreadSendOutput,
  failure: ThreadsToolFailure,
  dependencies,
})
  .annotate(Tool.Title, "Send to T3 Code thread")
  .annotate(Tool.Destructive, true);

export const T3ThreadReadTool = Tool.make("t3_thread_read", {
  description:
    "Read a compact, bounded status and recent transcript from a real T3 Code thread for narration. Use this for a thread or chat in the T3 Code sidebar, including the calling thread itself, instead of internal subagent status tools.",
  parameters: T3ThreadReadInput,
  success: T3ThreadReadOutput,
  failure: ThreadsToolFailure,
  dependencies,
})
  .annotate(Tool.Title, "Read T3 Code thread")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true);

export const T3ThreadListTool = Tool.make("t3_thread_list", {
  description:
    "List real active T3 Code threads and chats in the calling thread's project, with sidebar titles and working status. Use this to resolve which visible T3 Code thread the user means. It does not list internal subagents, deleted threads, archived threads, or other projects.",
  parameters: T3ThreadListInput,
  success: T3ThreadListOutput,
  failure: ThreadsToolFailure,
  dependencies,
})
  .annotate(Tool.Title, "List T3 Code threads")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true);

export const T3ThreadInterruptTool = Tool.make("t3_thread_interrupt", {
  description:
    "Interrupt the active turn in a real sibling T3 Code thread or chat. Use this only when the user asks to stop or redirect visible delegated work. It is idempotent when the thread is idle and cannot interrupt the calling thread itself.",
  parameters: T3ThreadInterruptInput,
  success: T3ThreadInterruptOutput,
  failure: ThreadsToolFailure,
  dependencies,
})
  .annotate(Tool.Title, "Interrupt T3 Code thread")
  .annotate(Tool.Destructive, true)
  .annotate(Tool.Idempotent, true);

export const ThreadsToolkit = Toolkit.make(
  T3ThreadCreateTool,
  T3ThreadSendTool,
  T3ThreadReadTool,
  T3ThreadListTool,
  T3ThreadInterruptTool,
);
