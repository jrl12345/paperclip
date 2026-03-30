import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AGENT_ADAPTER_TYPES } from "@paperclipai/shared";
import { createAgentSchema, createAgentHireSchema } from "@paperclipai/shared/validators/agent";

/**
 * Regression tests for AGENT_ADAPTER_TYPES constant.
 *
 * Feature: Agent adapter type validation
 *
 * Scenario: gemini_local is accepted in agent create requests
 *   Given the agent hire/create endpoint validates adapterType with Zod
 *   When a request specifies adapterType "gemini_local"
 *   Then it passes validation without error
 *   And the resolved adapterType equals "gemini_local"
 *
 * Scenario: gemini_local is present in the AGENT_ADAPTER_TYPES enum
 *   Given the AGENT_ADAPTER_TYPES constant used by validation schemas
 *   When I check whether "gemini_local" is a member
 *   Then it is present
 *
 * Scenario: unknown adapter type is rejected
 *   Given the agent hire/create endpoint validates adapterType with Zod
 *   When a request specifies an unrecognised adapterType
 *   Then validation fails with code "invalid_enum_value"
 */
describe("AGENT_ADAPTER_TYPES — gemini_local regression (#542)", () => {
  const adapterTypeSchema = z.enum(AGENT_ADAPTER_TYPES);

  describe("constant membership", () => {
    it("contains gemini_local", () => {
      expect(AGENT_ADAPTER_TYPES).toContain("gemini_local");
    });

    it("contains all historically known adapter types", () => {
      const known = [
        "process",
        "http",
        "claude_local",
        "codex_local",
        "opencode_local",
        "pi_local",
        "cursor",
        "openclaw_gateway",
        "hermes_local",
        "gemini_local",
      ] as const;
      for (const type of known) {
        expect(AGENT_ADAPTER_TYPES).toContain(type);
      }
    });
  });

  describe("Zod enum validation", () => {
    it("accepts gemini_local without error", () => {
      const result = adapterTypeSchema.safeParse("gemini_local");
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe("gemini_local");
      }
    });

    it("rejects an unknown adapter type with invalid_enum_value", () => {
      const result = adapterTypeSchema.safeParse("unknown_adapter_xyz");
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].code).toBe("invalid_enum_value");
      }
    });
  });

  describe("createAgentSchema integration", () => {
    it("accepts gemini_local as adapterType in agent create payload", () => {
      const result = createAgentSchema.safeParse({
        name: "Gemini Agent",
        adapterType: "gemini_local",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.adapterType).toBe("gemini_local");
      }
    });
  });

  describe("createAgentHireSchema integration", () => {
    it("accepts gemini_local as adapterType in agent hire payload", () => {
      const result = createAgentHireSchema.safeParse({
        name: "Gemini Hire",
        adapterType: "gemini_local",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.adapterType).toBe("gemini_local");
      }
    });

    it("rejects gemini_local-shaped typos in hire payload", () => {
      const result = createAgentHireSchema.safeParse({
        name: "Bad Adapter",
        adapterType: "geminilocal",
      });
      expect(result.success).toBe(false);
    });
  });
});
