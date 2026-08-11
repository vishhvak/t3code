import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { assert, it } from "@effect/vitest";

import * as CodexRpc from "./rpc.ts";
import * as CodexSchema from "./schema.ts";

it.effect("round-trips thread realtime start params", () =>
  Effect.gen(function* () {
    assert.equal(CodexRpc.CLIENT_REQUEST_METHODS["thread/realtime/start"], "thread/realtime/start");
    assert.strictEqual(
      CodexRpc.CLIENT_REQUEST_PARAMS["thread/realtime/start"],
      CodexSchema.V2ThreadRealtimeStartParams,
    );

    const wireValue = {
      threadId: "019fe84c-0e99-7583-b183-d67d3511e651",
      outputModality: "audio",
      version: "v3",
      transport: { type: "webrtc", sdp: "v=0\r\n" },
      delegationAckFiller: true,
      codexResponseHandoffMode: "bemTags",
      codexResponseHandoffChannelPrefixes: {
        analysis: ["[THINKING]"],
        commentary: ["[PROGRESS]"],
        final: ["[DONE]"],
      },
    } as const;
    const decoded = yield* Schema.decodeUnknownEffect(CodexSchema.V2ThreadRealtimeStartParams)(
      wireValue,
    );
    const encoded = yield* Schema.encodeUnknownEffect(CodexSchema.V2ThreadRealtimeStartParams)(
      decoded,
    );

    assert.deepEqual(decoded, wireValue);
    assert.deepEqual(encoded, wireValue);
  }),
);

it.effect("round-trips thread realtime start response", () =>
  Effect.gen(function* () {
    assert.strictEqual(
      CodexRpc.CLIENT_REQUEST_RESPONSES["thread/realtime/start"],
      CodexSchema.V2ThreadRealtimeStartResponse,
    );

    const decoded = yield* Schema.decodeUnknownEffect(CodexSchema.V2ThreadRealtimeStartResponse)(
      {},
    );
    const encoded = yield* Schema.encodeUnknownEffect(CodexSchema.V2ThreadRealtimeStartResponse)(
      decoded,
    );

    assert.deepEqual(decoded, {});
    assert.deepEqual(encoded, {});
  }),
);

it.effect("round-trips thread realtime stop params", () =>
  Effect.gen(function* () {
    assert.equal(CodexRpc.CLIENT_REQUEST_METHODS["thread/realtime/stop"], "thread/realtime/stop");
    assert.strictEqual(
      CodexRpc.CLIENT_REQUEST_PARAMS["thread/realtime/stop"],
      CodexSchema.V2ThreadRealtimeStopParams,
    );

    const wireValue = { threadId: "019fe84c-0e99-7583-b183-d67d3511e651" };
    const decoded = yield* Schema.decodeUnknownEffect(CodexSchema.V2ThreadRealtimeStopParams)(
      wireValue,
    );
    const encoded = yield* Schema.encodeUnknownEffect(CodexSchema.V2ThreadRealtimeStopParams)(
      decoded,
    );

    assert.deepEqual(decoded, wireValue);
    assert.deepEqual(encoded, wireValue);
  }),
);

it.effect("round-trips thread realtime stop response", () =>
  Effect.gen(function* () {
    assert.strictEqual(
      CodexRpc.CLIENT_REQUEST_RESPONSES["thread/realtime/stop"],
      CodexSchema.V2ThreadRealtimeStopResponse,
    );

    const decoded = yield* Schema.decodeUnknownEffect(CodexSchema.V2ThreadRealtimeStopResponse)({});
    const encoded = yield* Schema.encodeUnknownEffect(CodexSchema.V2ThreadRealtimeStopResponse)(
      decoded,
    );

    assert.deepEqual(decoded, {});
    assert.deepEqual(encoded, {});
  }),
);
