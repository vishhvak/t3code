import * as CodexSchema from "./schema.ts";
import * as GeneratedRpc from "./_generated/meta.gen.ts";

export * from "./_generated/meta.gen.ts";

export const CLIENT_REQUEST_METHODS = {
  ...GeneratedRpc.CLIENT_REQUEST_METHODS,
  "thread/realtime/start": "thread/realtime/start",
  "thread/realtime/stop": "thread/realtime/stop",
} as const;

export type ClientRequestMethod = keyof typeof CLIENT_REQUEST_METHODS;

export interface ClientRequestParamsByMethod extends GeneratedRpc.ClientRequestParamsByMethod {
  readonly "thread/realtime/start": CodexSchema.V2ThreadRealtimeStartParams;
  readonly "thread/realtime/stop": CodexSchema.V2ThreadRealtimeStopParams;
}

export interface ClientRequestResponsesByMethod
  extends GeneratedRpc.ClientRequestResponsesByMethod {
  readonly "thread/realtime/start": CodexSchema.V2ThreadRealtimeStartResponse;
  readonly "thread/realtime/stop": CodexSchema.V2ThreadRealtimeStopResponse;
}

export const CLIENT_REQUEST_PARAMS = {
  ...GeneratedRpc.CLIENT_REQUEST_PARAMS,
  "thread/realtime/start": CodexSchema.V2ThreadRealtimeStartParams,
  "thread/realtime/stop": CodexSchema.V2ThreadRealtimeStopParams,
} as const;

export const CLIENT_REQUEST_RESPONSES = {
  ...GeneratedRpc.CLIENT_REQUEST_RESPONSES,
  "thread/realtime/start": CodexSchema.V2ThreadRealtimeStartResponse,
  "thread/realtime/stop": CodexSchema.V2ThreadRealtimeStopResponse,
} as const;
