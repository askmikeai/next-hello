import type { IncomingMessage, ServerResponse } from "http";
import type { NetworkingEventConfig, SupabaseConfig } from "../config/types.js";

export type WebhookHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  config: NetworkingEventConfig,
) => Promise<boolean>;

export interface WebhookRoute {
  path: string;
  handler: WebhookHandler;
}

/**
 * Registry for webhook routes
 */
const routes: WebhookRoute[] = [];

/**
 * Register a webhook route
 */
export function registerWebhookRoute(path: string, handler: WebhookHandler): void {
  routes.push({ path, handler });
}

/**
 * Get all registered routes
 */
export function getWebhookRoutes(): WebhookRoute[] {
  return [...routes];
}

/**
 * Match a path to a route
 */
export function matchRoute(path: string): WebhookRoute | null {
  // Normalize path
  const normalized = path.replace(/\/$/, "").toLowerCase();

  for (const route of routes) {
    const routePath = route.path.replace(/\/$/, "").toLowerCase();
    if (normalized === routePath || normalized.startsWith(`${routePath}/`)) {
      return route;
    }
  }

  return null;
}

/**
 * Parse JSON body from request
 */
export async function parseJsonBody<T>(req: IncomingMessage): Promise<T | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];

    req.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });

    req.on("end", () => {
      try {
        const body = Buffer.concat(chunks).toString("utf-8");
        resolve(JSON.parse(body) as T);
      } catch {
        resolve(null);
      }
    });

    req.on("error", () => {
      resolve(null);
    });
  });
}

/**
 * Get raw body as string
 */
export async function getRawBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];

    req.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });

    req.on("end", () => {
      resolve(Buffer.concat(chunks).toString("utf-8"));
    });

    req.on("error", () => {
      resolve("");
    });
  });
}

/**
 * Send JSON response
 */
export function sendJsonResponse(
  res: ServerResponse,
  status: number,
  data: unknown,
): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

/**
 * Send success response
 */
export function sendSuccess(res: ServerResponse, message = "OK"): void {
  sendJsonResponse(res, 200, { success: true, message });
}

/**
 * Send error response
 */
export function sendError(res: ServerResponse, status: number, error: string): void {
  sendJsonResponse(res, status, { success: false, error });
}

/**
 * Log webhook event
 */
export function logWebhook(source: string, event: string, details?: unknown): void {
  const timestamp = new Date().toISOString();
  console.log(`[webhook] ${timestamp} ${source}: ${event}`, details ?? "");
}
