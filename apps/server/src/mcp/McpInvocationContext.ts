import {
  EnvironmentId,
  PreviewAutomationUnavailableError,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

export type McpCapability = "preview" | "threads";

export class ThreadsCapabilityUnavailableError extends Schema.TaggedErrorClass<ThreadsCapabilityUnavailableError>()(
  "ThreadsCapabilityUnavailableError",
  {
    capability: Schema.Literal("threads"),
    environmentId: EnvironmentId,
    threadId: ThreadId,
    providerSessionId: Schema.String,
    providerInstanceId: ProviderInstanceId,
  },
) {
  override get message(): string {
    return "MCP credential does not grant the threads capability.";
  }
}

export interface McpInvocationScope {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly providerSessionId: string;
  readonly providerInstanceId: ProviderInstanceId;
  readonly capabilities: ReadonlySet<McpCapability>;
  readonly issuedAt: number;
}

export class McpInvocationContext extends Context.Service<
  McpInvocationContext,
  McpInvocationScope
>()("t3/mcp/McpInvocationContext") {}

export function requireMcpCapability(
  capability: "preview",
): Effect.Effect<McpInvocationScope, PreviewAutomationUnavailableError, McpInvocationContext>;
export function requireMcpCapability(
  capability: "threads",
): Effect.Effect<McpInvocationScope, ThreadsCapabilityUnavailableError, McpInvocationContext>;
export function requireMcpCapability(capability: McpCapability) {
  return Effect.gen(function* () {
    const invocation = yield* McpInvocationContext;
    if (!invocation.capabilities.has(capability)) {
      if (capability === "threads") {
        return yield* new ThreadsCapabilityUnavailableError({
          capability,
          environmentId: invocation.environmentId,
          threadId: invocation.threadId,
          providerSessionId: invocation.providerSessionId,
          providerInstanceId: invocation.providerInstanceId,
        });
      }
      return yield* new PreviewAutomationUnavailableError({
        capability,
        environmentId: invocation.environmentId,
        threadId: invocation.threadId,
        providerSessionId: invocation.providerSessionId,
        providerInstanceId: invocation.providerInstanceId,
      });
    }
    return invocation;
  }).pipe(Effect.withSpan("mcp.requireCapability"));
}
