import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  server: {
    AWS_REGION: z.string().min(1).default("ap-south-1"),
    AWS_ACCESS_KEY_ID: z.string().optional(),
    AWS_SECRET_ACCESS_KEY: z.string().optional(),
    AWS_SESSION_TOKEN: z.string().optional(),
  },
  client: {},
  clientPrefix: "NEXT_PUBLIC_",
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
