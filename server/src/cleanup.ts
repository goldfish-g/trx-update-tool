import cron from "node-cron";
import type { Storage } from "./storage.js";

/**
 * Schedule a cleanup job that runs every 10 minutes,
 * removing expired files from storage.
 */
export function startCleanupScheduler(storage: Storage): void {
  cron.schedule("*/10 * * * *", async () => {
    const count = await storage.cleanup();
    if (count > 0) {
      console.log(`[cleanup] removed ${count} expired file(s)`);
    }
  });

  console.log("[cleanup] scheduler started (every 10 minutes)");
}
