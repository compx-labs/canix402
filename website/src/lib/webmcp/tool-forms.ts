import type { JsonSchemaObject } from "./types";

const AUTH_FIELD_NAMES = new Set(["paymentSignature", "sessionReceipt"]);

interface JsonSchemaNode {
  type?: string;
  enum?: unknown[];
  anyOf?: JsonSchemaNode[];
  items?: JsonSchemaNode;
  properties?: Record<string, JsonSchemaNode>;
  required?: string[];
  description?: string;
  minimum?: number;
  maximum?: number;
}

export type ToolFieldParse = "string" | "number" | "boolean" | "json" | "csv-string" | "csv-int";

export interface ToolFormField {
  name: string;
  label: string;
  kind: "text" | "number" | "checkbox" | "select" | "json";
  parse: ToolFieldParse;
  required: boolean;
  description?: string;
  placeholder?: string;
  options?: string[];
  min?: number;
  max?: number;
  rows?: number;
  defaultValue?: string;
}

export function fieldsForSchema(schema: JsonSchemaObject): ToolFormField[] {
  const required = new Set(schema.required ?? []);
  const fields: ToolFormField[] = [];
  for (const [name, raw] of Object.entries(schema.properties)) {
    if (AUTH_FIELD_NAMES.has(name)) {
      continue;
    }
    const node = unwrapAnyOf(raw as JsonSchemaNode);
    if (name === "budget" && node.type === "object" && node.properties) {
      const budgetRequired = required.has("budget");
      const budgetKeys = new Set(node.required ?? []);
      for (const [childName, childRaw] of Object.entries(node.properties)) {
        fields.push(
          fieldFromNode(
            `budget.${childName}`,
            unwrapAnyOf(childRaw),
            budgetRequired && budgetKeys.has(childName)
          )
        );
      }
      continue;
    }
    fields.push(fieldFromNode(name, node, required.has(name)));
  }
  return fields;
}

export function argsFromForm(form: HTMLFormElement, schema: JsonSchemaObject): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  const formData = new FormData(form);
  for (const field of fieldsForSchema(schema)) {
    const value = readField(form, formData, field);
    if (value === undefined) {
      continue;
    }
    setPath(args, field.name, value);
  }
  return args;
}

function fieldFromNode(name: string, node: JsonSchemaNode, required: boolean): ToolFormField {
  const label = labelFromName(name);
  const description = node.description;
  if (node.enum && node.enum.every((value) => typeof value === "string")) {
    return {
      name,
      label,
      kind: "select",
      parse: "string",
      required,
      description,
      options: node.enum as string[]
    };
  }
  if (node.type === "boolean") {
    return { name, label, kind: "checkbox", parse: "boolean", required, description };
  }
  if (node.type === "integer" || node.type === "number") {
    return {
      name,
      label,
      kind: "number",
      parse: "number",
      required,
      description,
      min: node.minimum,
      max: node.maximum,
      defaultValue: defaultForName(name)
    };
  }
  if (node.type === "array") {
    const itemType = node.items?.type;
    if (itemType === "integer" || itemType === "number") {
      return {
        name,
        label,
        kind: "text",
        parse: "csv-int",
        required,
        description,
        placeholder: "0, 31566704"
      };
    }
    if (itemType === "string" || Boolean(node.items?.enum)) {
      return {
        name,
        label,
        kind: "text",
        parse: "csv-string",
        required,
        description,
        placeholder: name === "opportunityIds" ? "reti-staking-12, tinyman:pool:1002541853" : "value-1, value-2"
      };
    }
    return {
      name,
      label,
      kind: "json",
      parse: "json",
      required,
      description,
      placeholder: "[]",
      rows: 8
    };
  }
  if (node.type === "object") {
    return {
      name,
      label,
      kind: "json",
      parse: "json",
      required,
      description,
      placeholder: "{}",
      rows: 6
    };
  }
  const isAddress = name === "address" || name.toLowerCase().includes("address");
  return {
    name,
    label,
    kind: "text",
    parse: "string",
    required,
    description,
    placeholder: isAddress
      ? "Algorand address"
      : name === "assetIds"
        ? "0,31566704"
        : name === "protocol" || name === "platform"
          ? "tinyman"
          : undefined,
    defaultValue: defaultForName(name)
  };
}

function readField(
  form: HTMLFormElement,
  formData: FormData,
  field: ToolFormField
): unknown {
  if (field.parse === "boolean") {
    const element = form.elements.namedItem(field.name);
    if (!(element instanceof HTMLInputElement)) {
      return undefined;
    }
    return element.checked ? true : undefined;
  }
  const raw = formData.get(field.name);
  const text = typeof raw === "string" ? raw.trim() : "";
  if (text === "") {
    return undefined;
  }
  switch (field.parse) {
    case "number": {
      const parsed = Number(text);
      if (!Number.isFinite(parsed)) {
        throw new Error(`${field.label} must be a number.`);
      }
      return parsed;
    }
    case "json": {
      try {
        return JSON.parse(text) as unknown;
      } catch {
        throw new Error(`${field.label} must be valid JSON.`);
      }
    }
    case "csv-int":
      return text.split(",").map((part) => {
        const parsed = Number(part.trim());
        if (!Number.isFinite(parsed)) {
          throw new Error(`${field.label} must be a comma-separated list of numbers.`);
        }
        return parsed;
      });
    case "csv-string":
      return text
        .split(",")
        .map((part) => part.trim())
        .filter((part) => part.length > 0);
    default:
      return text;
  }
}

function setPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".");
  if (parts.length === 1) {
    target[path] = value;
    return;
  }
  let cursor = target;
  for (const part of parts.slice(0, -1)) {
    const existing = cursor[part];
    if (!existing || typeof existing !== "object" || Array.isArray(existing)) {
      cursor[part] = {};
    }
    cursor = cursor[part] as Record<string, unknown>;
  }
  cursor[parts[parts.length - 1] ?? path] = value;
}

function unwrapAnyOf(node: JsonSchemaNode): JsonSchemaNode {
  if (!node.anyOf || node.anyOf.length === 0) {
    return node;
  }
  const preferred =
    node.anyOf.find((item) => item.type === "integer" || item.type === "number") ?? node.anyOf[0];
  return { ...node, ...preferred, anyOf: undefined };
}

function labelFromName(name: string): string {
  const leaf = name.includes(".") ? (name.split(".").at(-1) ?? name) : name;
  return leaf
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/^(.)/, (char) => char.toUpperCase());
}

function defaultForName(name: string): string | undefined {
  if (name === "limit") {
    return "25";
  }
  if (name === "budget.assetId") {
    return "0";
  }
  if (name === "budget.amount") {
    return "1000000";
  }
  return undefined;
}
