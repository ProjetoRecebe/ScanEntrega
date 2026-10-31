// "mock:" usa o mock embutido (js/mock-api.js). Troque pela URL HTTPS do backend real.
export const API_URL = "mock:";
export const MIN_BRIGHTNESS = 40;
export const MAX_BRIGHTNESS = 220;
export const MAX_QUEUE_SIZE = 20;
export const REQUEST_TIMEOUT_MS = 30_000;
export const RETRY_BASE_DELAY_MS = 2_000;
export const RETRY_MAX_DELAY_MS = 5 * 60_000;
export const SYNC_LOCK_TTL_MS = 45_000;
export const SYNC_LOCK_HEARTBEAT_MS = 10_000;

let tokenProvider = null;

/**
 * Registers the host application's token provider without embedding a secret.
 * The provider may return a token string or null.
 * @param {() => string | null | Promise<string | null>} provider
 */
export function setTokenProvider(provider) {
  if (typeof provider !== "function") {
    throw new TypeError("O provedor de token precisa ser uma função.");
  }
  tokenProvider = provider;
}

/**
 * Returns request headers; multipart Content-Type is intentionally omitted.
 * @returns {Promise<Headers>}
 */
export async function getAuthHeaders() {
  const headers = new Headers();
  if (!tokenProvider) return headers;

  const token = await tokenProvider();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return headers;
}
