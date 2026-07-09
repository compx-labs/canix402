import { EndpointAccess, X402EndpointMetadata } from "../services/payment-policy.js";

export interface DiscoveryErrorDescriptor {
  code: string;
  httpStatus: number;
  description: string;
}

export interface DiscoveryEndpointDescriptor {
  id: string;
  method: "GET" | "POST";
  path: string;
  access: Exclude<EndpointAccess, "unknown">;
  summary: string;
  description?: string;
  tags: string[];
  pathParams: string[];
  queryParams: string[];
  responseCodes: number[];
  x402?: X402EndpointMetadata;
}

export interface DiscoveryDocument {
  service: "canix402";
  apiVersion: string;
  discoveryVersion: "1.0.0";
  capabilities: string[];
  x402ProtocolVersion: 2;
  mcpServer?: {
    name: string;
    transport: "stdio";
    package: string;
    install: string;
    docsUrl: string;
    tools: string[];
  };
  endpoints: DiscoveryEndpointDescriptor[];
  errorCatalog: DiscoveryErrorDescriptor[];
}
