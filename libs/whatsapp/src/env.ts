import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const whatsappEnv = createEnv({
  server: {
    META_APP_ID: z.string().min(1),
    META_APP_SECRET: z.string().min(1),
    META_WEBHOOK_VERIFY_TOKEN: z.string().min(1),
    META_API_VERSION: z.string().default("v21.0"),
    WHATSAPP_MEDIA_S3_BUCKET: z.string().default("chatbot-whatsapp-media"),
    REDIS_URL: z.string().url().optional(),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
  skipValidation: !process.env.META_APP_ID,
});
