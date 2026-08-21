import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  server: {
    AWS_REGION: z.string().min(1).default("ap-south-1"),
    AWS_ACCESS_KEY_ID: z.string().optional(),
    AWS_SECRET_ACCESS_KEY: z.string().optional(),
    AWS_SESSION_TOKEN: z.string().optional(),
    AWS_BEARER_TOKEN_BEDROCK: z.string().optional(),

    // Web Search — at least one provider must be configured for the web_search tool to be available
    TAVILY_API_KEY: z.string().optional(),
    BRAVE_API_KEY: z.string().optional(),
    SEARXNG_API_BASE: z.string().url().optional(),

    // Web Fetch — opt-in fallback when a tenant has no 'webFetchEnabled' config set.
    // Kept disabled by default: an always-on web_fetch tool disables the LLM response
    // cache (see hasBuiltInTools in the inference route), so it must be explicit.
    WEB_FETCH_ENABLED: z.string().optional().default("false"),

    // SSRF guard — every model-supplied URL is resolved and rejected if it lands
    // on a loopback/private/link-local address. Set to "true" ONLY for local
    // development against a fixture server; enabling it in a deployed
    // environment exposes the VPC and the instance metadata endpoint.
    WEB_GUARD_ALLOW_PRIVATE_HOSTS: z.string().optional().default("false"),

    // Transcription — when no model endpoint is registered, return a placeholder
    // transcript so the flow is testable in dev. Set to "false" to hard-fail instead.
    TRANSCRIPTION_ALLOW_STUB: z.string().optional().default("true"),
  },
  client: {},
  clientPrefix: "NEXT_PUBLIC_",
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
