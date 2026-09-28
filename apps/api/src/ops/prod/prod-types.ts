export type ProdValidationStageId =
  | 'environment'
  | 'compute_sizing'
  | 'supply_chain'
  | 'network'
  | 'postgres'
  | 'object_storage'
  | 'tls'
  | 'secrets'
  | 'service_account'
  | 'scaling'
  | 'cost_controls'
  | 'backup'
  | 'observability'
  | 'security_scan';

export type ProdValidationStage = {
  id: ProdValidationStageId;
  label: string;
  passed: boolean;
  detail: string;
};

export type ProdValidationResult = {
  status: 'PASS' | 'FAIL';
  stages: ProdValidationStage[];
  sizing: ComputeSizingRecommendation;
  error?: string;
};

export type ComputeSizingRecommendation = {
  source: 'PROMPT_82_MEASURED_BASELINE';
  apiMinReplicas: number;
  apiMaxReplicas: number;
  apiCpuCores: number;
  apiMemoryMb: number;
  measuredMaxConcurrency: number;
  headroomFactor: number;
  postgresMaxConnections: number;
  postgresStorageGb: number;
  rationale: string;
};

export type ProdNetworkPolicy = {
  exposedPorts: number[];
  databasePubliclyExposed: boolean;
  objectStoragePubliclyExposed: boolean;
  tlsTermination: 'edge' | 'none';
};

export type SecretRotationPlan = {
  jwtRotationDays: number;
  databaseCredentialRotationDays: number;
  objectStorageKeyRotationDays: number;
  dualKeySupported: boolean;
};
