import { expect, it } from "@effect/vitest";
import { Tool } from "effect/unstable/ai";

import { ThreadsToolkit } from "./tools.ts";

const schemaHasDescription = (schema: unknown): boolean => {
  if (!schema || typeof schema !== "object") return false;
  const record = schema as Record<string, unknown>;
  if (typeof record.description === "string" && record.description.length > 0) return true;
  return [record.anyOf, record.oneOf, record.allOf]
    .filter(Array.isArray)
    .some((members) => members.some(schemaHasDescription));
};

it("exports provider-compatible object schemas with described parameters", () => {
  expect(Object.keys(ThreadsToolkit.tools)).toEqual([
    "t3_thread_create",
    "t3_thread_send",
    "t3_thread_read",
    "t3_thread_list",
    "t3_thread_interrupt",
  ]);

  for (const tool of Object.values(ThreadsToolkit.tools)) {
    const schema = Tool.getJsonSchema(tool) as {
      readonly type?: unknown;
      readonly properties?: Readonly<Record<string, unknown>>;
      readonly anyOf?: unknown;
      readonly oneOf?: unknown;
    };
    expect(
      tool.description?.length ?? 0,
      `${tool.name} should have a useful description`,
    ).toBeGreaterThan(100);
    expect(tool.description).toContain("T3 Code");
    expect(schema.type, `${tool.name} must export a top-level object schema`).toBe("object");
    expect(schema.anyOf, `${tool.name} must not export a root anyOf`).toBeUndefined();
    expect(schema.oneOf, `${tool.name} must not export a root oneOf`).toBeUndefined();
    for (const [field, fieldSchema] of Object.entries(schema.properties ?? {})) {
      expect(
        schemaHasDescription(fieldSchema),
        `${tool.name}.${field} should explain what data the agent must pass`,
      ).toBe(true);
    }
  }
});

it("tells models to use real T3 threads instead of internal delegation", () => {
  expect(ThreadsToolkit.tools.t3_thread_create.description).toContain("internal subagent");
  expect(ThreadsToolkit.tools.t3_thread_send.description).toContain("internal subagent");
  expect(ThreadsToolkit.tools.t3_thread_list.description).toContain("internal subagents");
});
