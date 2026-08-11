import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { ExecutionEnvironmentCapabilities, ExecutionEnvironmentDescriptor } from "./environment.ts";

const decodeDescriptor = Schema.decodeUnknownSync(ExecutionEnvironmentDescriptor);
const decodeCapabilities = Schema.decodeUnknownSync(ExecutionEnvironmentCapabilities);

const descriptor = {
  environmentId: "environment-1",
  label: "Local",
  platform: { os: "darwin", arch: "arm64" },
  serverVersion: "0.0.32",
  capabilities: { repositoryIdentity: true },
} as const;

describe("ExecutionEnvironmentDescriptor", () => {
  it("treats a missing pull-request capability as unsupported under version skew", () => {
    expect(decodeDescriptor(descriptor).capabilities.pullRequests).toBeUndefined();
  });

  it("preserves an advertised pull-request capability", () => {
    expect(
      decodeDescriptor({
        ...descriptor,
        capabilities: { ...descriptor.capabilities, pullRequests: true },
      }).capabilities.pullRequests,
    ).toBe(true);
  });
});

describe("ExecutionEnvironmentCapabilities", () => {
  it("keeps realtime voice capability absent for older servers", () => {
    expect(decodeCapabilities({ repositoryIdentity: true }).realtimeVoice).toBeUndefined();
    expect(
      decodeCapabilities({ repositoryIdentity: true, realtimeVoice: true }).realtimeVoice,
    ).toBe(true);
  });
});
