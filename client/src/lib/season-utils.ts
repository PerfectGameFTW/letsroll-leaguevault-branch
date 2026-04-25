// Re-export shim: the canonical implementation now lives at
// `shared/season-utils.ts` so the server (Square custom-attribute
// sync, task #429) can produce the same labels users see in-app.
//
// Keeping this file as a re-export means existing
// `import { getSeasonLabel } from "@/lib/season-utils"` lines in the
// client compile unchanged. New client code may import directly from
// `@shared/season-utils` if preferred.
export { getSeasonLabel } from "@shared/season-utils";
