import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const whatsappEnv = createEnv({
  server: {
    META_APP_ID: z.string().min(1),
    META_APP_SECRET: z.string().min(1),
    META_WEBHOOK_VERIFY_TOKEN: z.string().min(1),
    META_API_VERSION: z.string().default("v21.0"),
    // Only needed for the Embedded Signup connect flow (Settings > Channels > WhatsApp).
    // The webhook/messaging routes don't use this, so it stays optional even when the
    // rest of the WhatsApp integration is configured.
    META_WHATSAPP_CONFIG_ID: z.string().optional(),
    NETCORE_DEFAULT_SOURCE: z.string().default("new_swe"),
    WHATSAPP_MEDIA_S3_BUCKET: z.string().default("chatbot-whatsapp-media"),
    REDIS_URL: z.string().url().optional(),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
  skipValidation: !process.env.META_APP_ID,
});
