import { Hono } from "hono";
import { authMiddleware } from "@/middleware/auth.ts";

export const tasksRouter = new Hono().use(authMiddleware);
