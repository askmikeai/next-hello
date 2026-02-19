/**
 * Calendly OAuth Routes
 *
 * Handles OAuth2 authorization flow for Calendly integration.
 */

import type { IncomingMessage, ServerResponse } from "http";
import { URL } from "url";
import {
  registerWebhookRoute,
  sendJsonResponse,
  sendError,
  logWebhook,
} from "./registry.js";
import {
  getAuthorizationUrl,
  verifyState,
  exchangeCodeForTokens,
  isAuthorized,
  getStoredTokens,
  clearTokens,
} from "../integrations/calendly/oauth.js";

const OAUTH_PATH = "/api/calendly";

function log(message: string): void {
  console.log(`[calendly-oauth] ${message}`);
}

/**
 * Handle OAuth routes
 */
async function handleOAuthRequest(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  const path = url.pathname;
  const method = req.method ?? "GET";

  // GET /api/calendly/auth - Start OAuth flow
  if (path === `${OAUTH_PATH}/auth` && method === "GET") {
    try {
      const { url: authUrl } = await getAuthorizationUrl();
      log(`Redirecting to Calendly authorization: ${authUrl.substring(0, 50)}...`);

      res.writeHead(302, { Location: authUrl });
      res.end();
      return true;
    } catch (error) {
      log(`Error starting OAuth: ${error}`);
      sendError(res, 500, `OAuth error: ${error instanceof Error ? error.message : String(error)}`);
      return true;
    }
  }

  // GET /api/calendly/callback - OAuth callback
  if (path === `${OAUTH_PATH}/callback` && method === "GET") {
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const error = url.searchParams.get("error");
    const errorDescription = url.searchParams.get("error_description");

    // Check for error from Calendly
    if (error) {
      log(`OAuth error from Calendly: ${error} - ${errorDescription}`);
      sendHtmlResponse(res, 400, `
        <html>
          <head><title>Calendly Authorization Failed</title></head>
          <body style="font-family: sans-serif; padding: 40px; text-align: center;">
            <h1>Authorization Failed</h1>
            <p>Error: ${error}</p>
            <p>${errorDescription || ""}</p>
            <a href="${OAUTH_PATH}/auth">Try Again</a>
          </body>
        </html>
      `);
      return true;
    }

    // Validate required params
    if (!code || !state) {
      sendError(res, 400, "Missing code or state parameter");
      return true;
    }

    // Verify state parameter
    const stateValid = await verifyState(state);
    if (!stateValid) {
      log(`Invalid state parameter: ${state.substring(0, 8)}...`);
      sendError(res, 400, "Invalid state parameter - possible CSRF attack");
      return true;
    }

    try {
      // Exchange code for tokens
      const tokens = await exchangeCodeForTokens(code);

      logWebhook("calendly", "oauth_success", {
        owner: tokens.owner,
        organization: tokens.organization,
      });

      // Show success page
      sendHtmlResponse(res, 200, `
        <html>
          <head><title>Calendly Connected</title></head>
          <body style="font-family: sans-serif; padding: 40px; text-align: center;">
            <h1>Calendly Connected Successfully!</h1>
            <p>Your Calendly account has been connected.</p>
            <p>Organization: ${tokens.organization}</p>
            <p style="color: green;">You can now close this window and use scheduling features.</p>
          </body>
        </html>
      `);
      return true;
    } catch (error) {
      log(`Token exchange failed: ${error}`);
      sendHtmlResponse(res, 500, `
        <html>
          <head><title>Calendly Authorization Failed</title></head>
          <body style="font-family: sans-serif; padding: 40px; text-align: center;">
            <h1>Authorization Failed</h1>
            <p>Failed to complete authorization: ${error instanceof Error ? error.message : String(error)}</p>
            <a href="${OAUTH_PATH}/auth">Try Again</a>
          </body>
        </html>
      `);
      return true;
    }
  }

  // GET /api/calendly/status - Check authorization status
  if (path === `${OAUTH_PATH}/status` && method === "GET") {
    try {
      const authorized = await isAuthorized();
      const tokens = authorized ? await getStoredTokens() : null;

      sendJsonResponse(res, 200, {
        authorized,
        organization: tokens?.organization ?? null,
        owner: tokens?.owner ?? null,
        expiresAt: tokens?.expiresAt ? new Date(tokens.expiresAt).toISOString() : null,
      });
      return true;
    } catch (error) {
      sendError(res, 500, `Status check failed: ${error instanceof Error ? error.message : String(error)}`);
      return true;
    }
  }

  // POST /api/calendly/disconnect - Clear tokens
  if (path === `${OAUTH_PATH}/disconnect` && method === "POST") {
    try {
      await clearTokens();
      log("Calendly disconnected");
      sendJsonResponse(res, 200, { success: true, message: "Calendly disconnected" });
      return true;
    } catch (error) {
      sendError(res, 500, `Disconnect failed: ${error instanceof Error ? error.message : String(error)}`);
      return true;
    }
  }

  return false;
}

/**
 * Send HTML response
 */
function sendHtmlResponse(res: ServerResponse, status: number, html: string): void {
  res.writeHead(status, { "Content-Type": "text/html" });
  res.end(html);
}

/**
 * Get the OAuth path prefix
 */
export function getCalendlyOAuthPath(): string {
  return OAUTH_PATH;
}

// Register the OAuth route handler
registerWebhookRoute(OAUTH_PATH, async (req, res) => {
  return handleOAuthRequest(req, res);
});

log(`Calendly OAuth routes registered at ${OAUTH_PATH}`);
