import { z } from "zod";

export const CATEGORIES = ["Italia", "economia", "esteri", "tecnologia", "sport"] as const;

export const scriptRequestSchema = z.object({
  categoria: z.enum(CATEGORIES).default("Italia"),
  numNotizie: z.number().int().min(1).max(7).default(5),
});

export const voiceoverRequestSchema = z.object({
  text: z.string().trim().min(1).max(4000),
  voiceId: z.string().regex(/^[A-Za-z0-9-]{1,64}$/).optional(),
});
