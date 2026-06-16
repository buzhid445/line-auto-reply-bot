import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.string().default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  LINE_CHANNEL_SECRET: z.string().min(1),
  LINE_CHANNEL_ACCESS_TOKEN: z.string().min(1),
  OPENAI_API_KEY: z.string().min(1),
  OPENAI_MODEL: z.string().default("gpt-4.1-mini"),
  TECH_ESCALATION_TARGET: z.string().optional().default("")
});

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(env = process.env): AppConfig {
  return envSchema.parse(env);
}
