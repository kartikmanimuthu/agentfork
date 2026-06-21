export type Module = 'Settings' | 'Users' | 'Tenants' | 'Agents' | 'KnowledgeBases' | 'McpServers' | 'LlmProviders' | 'Evaluation' | 'Dashboards';

export type Action = 'create' | 'read' | 'update' | 'delete';

export type PredefinedRole = 'Owner' | 'Admin' | 'Member' | 'Viewer';

export type RoleLevel = 1 | 2 | 3 | 4;

export type PermissionSet = Record<Module, Action[]>;

export const SUBJECT_TO_MODULE: Record<string, Module> = {
  User: 'Users',
  Role: 'Users',
  Tenant: 'Tenants',
  TenantConfig: 'Settings',
  Settings: 'Settings',
  KnowledgeBases: 'KnowledgeBases',
  KnowledgeBase: 'KnowledgeBases',
  all: 'Settings',
  Agent: 'Agents',
  AgentVersion: 'Agents',
  AgentExecution: 'Agents',
  PlaygroundSession: 'Agents',
  InferenceSession: 'Agents',
  SdkWidget: 'Agents',
  McpServer: 'McpServers',
  McpServers: 'McpServers',
  LlmProvider: 'LlmProviders',
  LlmProviders: 'LlmProviders',
  Score: 'Evaluation',
  ScoreConfig: 'Evaluation',
  Dataset: 'Evaluation',
  DatasetItem: 'Evaluation',
  Evaluator: 'Evaluation',
  AnnotationQueue: 'Evaluation',
  AnnotationQueueItem: 'Evaluation',
  Experiment: 'Evaluation',
  ExperimentRunItem: 'Evaluation',
  Dashboard: 'Dashboards',
  DashboardWidget: 'Dashboards',
};

export const ACTION_MAP: Record<string, Action | Action[]> = {
  manage: ['create', 'read', 'update', 'delete'],
  create: 'create',
  read: 'read',
  update: 'update',
  delete: 'delete',
};
