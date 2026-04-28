import { serve } from "@hono/node-server";
import { app } from "./app.ts";
import { startNotificationCron } from "./lib/notification/cron.ts";

const port = Number(process.env.PORT) || 3000;

console.log(`Server running on http://localhost:${port}`);

// Start background jobs (hourly due-soon + overdue notifications)
startNotificationCron();

serve({ fetch: app.fetch, port });
