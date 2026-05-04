import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  server: {
    AWS_REGION: z.string().min(1).default("ap-south-1"),
  },
  client: {},
  clientPrefix: "NEXT_PUBLIC_",
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
