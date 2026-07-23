import { getExecutionShapeDocsPath } from "./shape-docs.js";
import type { TransactionShapeRegistry } from "./registry.js";
import type {
  OpportunityRole,
  ShapeSourceReference,
  TransactionShapeSpec
} from "./types.js";

/**
 * Serializable catalog entry for GET /execution/shapes.
 * Metadata only — does not compile quotes or return transactions.
 */
export interface ExecutionShapeCatalogEntry {
  shapeKey: string;
  network: string;
  protocol: string;
  protocolVersion: string;
  action: string;
  variant: string;
  shapeVersion: string;
  title: string;
  description: string;
  summary: string;
  opportunityRole: OpportunityRole;
  supportedOpportunityTypes: string[];
  requiredInputs: string[];
  sources: ShapeSourceReference[];
  docsPath?: string;
}

export function toExecutionShapeCatalogEntry(
  shape: TransactionShapeSpec
): ExecutionShapeCatalogEntry {
  const docsPath = getExecutionShapeDocsPath(shape.key);
  const entry: ExecutionShapeCatalogEntry = {
    shapeKey: shape.key,
    network: shape.identity.network,
    protocol: shape.identity.protocol,
    protocolVersion: shape.identity.protocolVersion,
    action: shape.identity.action,
    variant: shape.identity.variant,
    shapeVersion: shape.shapeVersion,
    title: shape.title,
    description: shape.description,
    summary: shape.description,
    opportunityRole: shape.opportunityRole,
    supportedOpportunityTypes: [...shape.supportedOpportunityTypes],
    requiredInputs: [...shape.requiredInputs],
    sources: shape.sources.map((source) => ({ ...source }))
  };
  if (docsPath) {
    entry.docsPath = docsPath;
  }
  return entry;
}

export function listExecutionShapeCatalog(
  registry: TransactionShapeRegistry
): ExecutionShapeCatalogEntry[] {
  return registry.list().map(toExecutionShapeCatalogEntry);
}
