// Re-export shim. The real storage layer lives in `./storage/` (split per
// domain), but server code imports from `./storage` as a single entry point.
// Keep both — see `shared/schema.ts` for the matching convention on the
// shared side.
export { storage, DatabaseStorage } from "./storage/index";
export type { IStorage } from "./storage/index";
