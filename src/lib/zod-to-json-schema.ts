import { z } from "zod";

type JsonSchema = Record<string, unknown>;

const typeName = (schema: z.ZodType): string =>
  (schema as unknown as { _def: { typeName: string } })._def.typeName;

const inner = (schema: z.ZodType): z.ZodType => {
  const def = (schema as unknown as { _def: { innerType?: z.ZodType; type?: z.ZodType } })._def;
  return (def.innerType ?? def.type ?? schema) as z.ZodType;
};

function mapType(schema: z.ZodType): JsonSchema {
  const base: JsonSchema = schema.description ? { description: schema.description } : {};
  const name = typeName(schema);
  const def = (schema as unknown as { _def: Record<string, unknown> })._def;

  switch (name) {
    case "ZodString":
      return { ...base, type: "string" };
    case "ZodNumber":
      return { ...base, type: "number" };
    case "ZodBoolean":
      return { ...base, type: "boolean" };
    case "ZodLiteral":
      return { ...base, const: def.value };
    case "ZodEnum":
      return { ...base, type: "string", enum: (def.values as string[]) ?? [] };
    case "ZodNativeEnum":
      return { ...base, type: "string", enum: Object.keys(def.values as object) };
    case "ZodArray":
      return { ...base, type: "array", items: mapType(inner(schema)) };
    case "ZodObject": {
      const shape = def.shape as Record<string, z.ZodType>;
      return { ...base, type: "object", ...mapObject(shape) };
    }
    case "ZodOptional":
    case "ZodDefault":
    case "ZodNullable":
    case "ZodEffects":
    case "ZodCatch":
      return mapType(inner(schema));
    case "ZodUnion": {
      const options = (def.options as z.ZodType[]) ?? [];
      const anyOf = options.map(mapType);
      return anyOf.length === 0 ? base : { ...base, anyOf };
    }
    default:
      return base;
  }
}

function mapObject(shape: Record<string, z.ZodType>): { properties: Record<string, JsonSchema>; required: string[] } {
  const properties: Record<string, JsonSchema> = {};
  const required: string[] = [];

  for (const [key, value] of Object.entries(shape)) {
    properties[key] = mapType(value);
    if (typeof (value as unknown as { isOptional?: () => boolean }).isOptional === "function") {
      if (!value.isOptional()) required.push(key);
    } else {
      required.push(key);
    }
  }

  return { properties, required };
}

export function zodToJsonSchema(shape: Record<string, z.ZodType>): JsonSchema {
  const { properties, required } = mapObject(shape);
  return {
    type: "object",
    properties,
    required,
  };
}
