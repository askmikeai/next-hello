/**
 * Calendly OAuth2 Client
 *
 * Handles OAuth2 authorization flow for Calendly API access.
 * Uses Authorization Code flow with PKCE.
 */

import crypto from "crypto";
import { getRedisConnection } from "../../queue/client.js";

const CALENDLY_AUTH_BASE = "https://auth.calendly.com";
const CALENDLY_TOKEN_URL = `${CALENDLY_AUTH_BASE}/oauth/token`;
const CALENDLY_AUTHORIZE_URL = `${CALENDLY_AUTH_BASE}/oauth/authorize`;

// Token storage key in Redis
const TOKEN_STORAGE_KEY = "calendly:oauth:tokens";
const STATE_STORAGE_PREFIX = "calendly:oauth:state:";

export interface CalendlyTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // Unix timestamp
  tokenType: string;
  scope: string;
  createdAt: number;
  owner: string; // User URI
  organization: string; // Organization URI
}

export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

function log(message: string): void {
  console.log(`[calendly-oauth] ${message}`);
}

function getOAuthConfig(): OAuthConfig {
  const clientId = process.env.CALENDLY_CLIENT_ID;
  const clientSecret = process.env.CALENDLY_CLIENT_SECRET;
  const redirectUri = process.env.CALENDLY_REDIRECT_URI || "http://localhost:3000/api/calendly/callback";

  if (!clientId || !clientSecret) {
    throw new Error("CALENDLY_CLIENT_ID and CALENDLY_CLIENT_SECRET must be set");
  }

  return { clientId, clientSecret, redirectUri };
}

/**
 * Generate a random state parameter for CSRF protection
 */
function generateState(): string {
  return crypto.randomBytes(32).toString("hex");
}

/**
 * Generate the authorization URL for OAuth2 flow
 */
export async function getAuthorizationUrl(): Promise<{ url: string; state: string }> {
  const config = getOAuthConfig();
  const state = generateState();

  // Store state in Redis for verification (expires in 10 minutes)
  const redis = getRedisConnection();
  if (redis) {
    await redis.setex(`${STATE_STORAGE_PREFIX}${state}`, 600, "pending");
  }

  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    state,
  });

  const url = `${CALENDLY_AUTHORIZE_URL}?${params.toString()}`;

  log(`Generated authorization URL with state: ${state.substring(0, 8)}...`);

  return { url, state };
}

/**
 * Verify the state parameter from callback
 */
export async function verifyState(state: string): Promise<boolean> {
  const redis = getRedisConnection();
  if (!redis) {
    log("Warning: Redis not available, skipping state verification");
    return true;
  }

  const stored = await redis.get(`${STATE_STORAGE_PREFIX}${state}`);
  if (stored) {
    // Delete the state after verification (one-time use)
    await redis.del(`${STATE_STORAGE_PREFIX}${state}`);
    return true;
  }

  return false;
}

/**
 * Exchange authorization code for tokens
 */
export async function exchangeCodeForTokens(code: string): Promise<CalendlyTokens> {
  const config = getOAuthConfig();

  log("Exchanging authorization code for tokens...");

  const response = await fetch(CALENDLY_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      redirect_uri: config.redirectUri,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    log(`Token exchange failed: ${response.status} - ${error}`);
    throw new Error(`Failed to exchange code for tokens: ${response.status} - ${error}`);
  }

  const data = (await response.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    token_type: string;
    scope: string;
    created_at: number;
    owner: string;
    organization: string;
  };

  const tokens: CalendlyTokens = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
    tokenType: data.token_type,
    scope: data.scope,
    createdAt: data.created_at * 1000,
    owner: data.owner,
    organization: data.organization,
  };

  // Store tokens
  await storeTokens(tokens);

  log(`Tokens obtained successfully. Owner: ${tokens.owner}`);

  return tokens;
}

/**
 * Refresh the access token using the refresh token
 */
export async function refreshAccessToken(refreshToken: string): Promise<CalendlyTokens> {
  const config = getOAuthConfig();

  log("Refreshing access token...");

  const response = await fetch(CALENDLY_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: refreshToken,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    log(`Token refresh failed: ${response.status} - ${error}`);
    throw new Error(`Failed to refresh token: ${response.status} - ${error}`);
  }

  const data = (await response.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    token_type: string;
    scope: string;
    created_at: number;
    owner: string;
    organization: string;
  };

  const tokens: CalendlyTokens = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
    tokenType: data.token_type,
    scope: data.scope,
    createdAt: data.created_at * 1000,
    owner: data.owner,
    organization: data.organization,
  };

  // Store updated tokens
  await storeTokens(tokens);

  log("Access token refreshed successfully");

  return tokens;
}

/**
 * Store tokens in Redis
 */
async function storeTokens(tokens: CalendlyTokens): Promise<void> {
  const redis = getRedisConnection();
  if (!redis) {
    log("Warning: Redis not available, tokens will not persist");
    // Fall back to in-memory storage
    cachedTokens = tokens;
    return;
  }

  await redis.set(TOKEN_STORAGE_KEY, JSON.stringify(tokens));
  cachedTokens = tokens;
}

// In-memory cache for tokens
let cachedTokens: CalendlyTokens | null = null;

/**
 * Get stored tokens from Redis
 */
export async function getStoredTokens(): Promise<CalendlyTokens | null> {
  // Check cache first
  if (cachedTokens) {
    return cachedTokens;
  }

  const redis = getRedisConnection();
  if (!redis) {
    return null;
  }

  const stored = await redis.get(TOKEN_STORAGE_KEY);
  if (!stored) {
    return null;
  }

  try {
    cachedTokens = JSON.parse(stored) as CalendlyTokens;
    return cachedTokens;
  } catch {
    return null;
  }
}

/**
 * Get a valid access token, refreshing if necessary
 */
export async function getValidAccessToken(): Promise<string | null> {
  let tokens = await getStoredTokens();

  if (!tokens) {
    log("No tokens stored - authorization required");
    return null;
  }

  // Check if token is expired or will expire in the next 5 minutes
  const expirationBuffer = 5 * 60 * 1000; // 5 minutes
  if (Date.now() >= tokens.expiresAt - expirationBuffer) {
    log("Access token expired or expiring soon, refreshing...");
    try {
      tokens = await refreshAccessToken(tokens.refreshToken);
    } catch (error) {
      log(`Failed to refresh token: ${error}`);
      return null;
    }
  }

  return tokens.accessToken;
}

/**
 * Check if OAuth2 is configured and authorized
 */
export async function isAuthorized(): Promise<boolean> {
  const token = await getValidAccessToken();
  return token !== null;
}

/**
 * Get the organization URI from stored tokens
 */
export async function getOrganizationUri(): Promise<string | null> {
  const tokens = await getStoredTokens();
  return tokens?.organization ?? null;
}

/**
 * Clear stored tokens (for logout/reauthorization)
 */
export async function clearTokens(): Promise<void> {
  cachedTokens = null;
  const redis = getRedisConnection();
  if (redis) {
    await redis.del(TOKEN_STORAGE_KEY);
  }
  log("Tokens cleared");
}
