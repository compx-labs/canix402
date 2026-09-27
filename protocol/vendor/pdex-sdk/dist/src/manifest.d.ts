export type ProtocolManifest = Record<string, any>;
export type DeploymentManifest = Record<string, any>;
export declare function setProtocolManifest(manifest: ProtocolManifest, key?: string | number): ProtocolManifest;
export declare function loadManifest(manifest?: ProtocolManifest, key?: string | number): ProtocolManifest;
export declare function loadManifestVersion(version: string | number, manifest?: ProtocolManifest): ProtocolManifest;
export declare function loadManifestFromUrl(baseUrl: string, fetchImpl?: typeof fetch, version?: string | number): Promise<ProtocolManifest>;
export declare function setDeploymentManifest(manifest: DeploymentManifest): DeploymentManifest;
export declare function loadDeploymentManifest(manifest?: DeploymentManifest): DeploymentManifest;
export declare function loadDeploymentManifestFromUrl(url: string, fetchImpl?: typeof fetch): Promise<DeploymentManifest>;
export declare function normalizeDeploymentManifest(payload: DeploymentManifest): DeploymentManifest;
export declare function deploymentAppIds(deployment?: DeploymentManifest, includeZero?: boolean): Record<string, number>;
export declare function deploymentAppNamesById(deployment?: DeploymentManifest): Record<number, string>;
export declare function deploymentAssets(deployment?: DeploymentManifest): Record<string, number>;
export declare function appMethod(appName: string, methodName: string, manifest?: ProtocolManifest): any;
//# sourceMappingURL=manifest.d.ts.map