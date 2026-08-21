// Client-safe exports from @chatbot/agent-studio
// Mirrors @chatbot/shared/client: only the registry, pure validation, and types —
// no services, no env, no prisma, no AWS.
//
// Client components MUST import runtime values from here, never from the main
// '@chatbot/agent-studio' barrel. That barrel re-exports AgentService, which imports
// createLogger from the '@chatbot/shared' server barrel; that barrel re-exports
// S3Service, which imports @smithy/node-http-handler → node:https. Webpack cannot
// resolve the 'node:' scheme for the browser target, so pulling the barrel into a
// 'use client' module fails the build outright.

export { NodeRegistry } from './registry/node-registry';
export type { NodeDefinition } from './registry/node-registry';

export { GraphValidationService } from './services/graph-validation-service';
export type { GraphValidationResult } from './services/graph-validation-service';
