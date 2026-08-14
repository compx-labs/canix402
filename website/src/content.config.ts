import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

const releaseNotes = defineCollection({
  loader: glob({ pattern: "*.md", base: "../docs/release-notes" }),
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    version: z.string()
  })
});

export const collections = {
  releaseNotes
};
