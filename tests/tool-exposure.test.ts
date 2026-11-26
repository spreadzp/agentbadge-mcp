import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  createNamespace,
  registerTool,
  listTools,
  type ToolExposure,
} from "../src/server";

const stubHandler = async () => ({
  content: [{ type: "text" as const, text: "ok" }],
});

describe("ToolExposure model (SLICE-259-1)", () => {
  it("defaults to 'admin' when no exposure is given (deny-by-default)", () => {
    const ns = createNamespace("exp-default");
    ns.registerTool("unclassified_tool", "No exposure", {}, stubHandler);

    const tool = ns.listTools().find((t) => t.name === "unclassified_tool");
    expect(tool).toBeDefined();
    expect(tool!.exposure).toBe("admin");
  });

  it.each(["public", "authenticated", "admin"] as ToolExposure[])(
    "round-trips exposure '%s' through registerTool → listTools",
    (exposure) => {
      const ns = createNamespace(`exp-${exposure}`);
      ns.registerTool(`${exposure}_tool`, `${exposure} tool`, {}, stubHandler, {
        exposure,
      });

      const tool = ns.listTools().find((t) => t.name === `${exposure}_tool`);
      expect(tool!.exposure).toBe(exposure);
    },
  );

  it("exposure is per-tool, independent within one namespace", () => {
    const ns = createNamespace("exp-mixed");
    ns.registerTool("pub", "P", {}, stubHandler, { exposure: "public" });
    ns.registerTool("adm", "A", {}, stubHandler, { exposure: "admin" });
    ns.registerTool("uncl", "U", {}, stubHandler);

    const tools = ns.listTools();
    expect(tools.find((t) => t.name === "pub")!.exposure).toBe("public");
    expect(tools.find((t) => t.name === "adm")!.exposure).toBe("admin");
    expect(tools.find((t) => t.name === "uncl")!.exposure).toBe("admin");
  });

  it("global registerTool/listTools expose exposure on the default namespace", () => {
    registerTool("exp_global_tool", "Global", { m: z.string() }, stubHandler, {
      exposure: "authenticated",
    });

    const tool = listTools().find((t) => t.name === "exp_global_tool");
    expect(tool!.exposure).toBe("authenticated");
  });

  it("re-registration updates exposure", () => {
    const ns = createNamespace("exp-rereg");
    ns.registerTool("flip_tool", "Flip", {}, stubHandler, { exposure: "admin" });
    ns.registerTool("flip_tool", "Flip", {}, stubHandler, { exposure: "public" });

    expect(ns.listTools().find((t) => t.name === "flip_tool")!.exposure).toBe(
      "public",
    );
  });
});
