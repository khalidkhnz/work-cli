// Thin fetch wrapper with Atlassian-style Basic auth, retry logic, rate limiting,
// and useful error messages.
//
// Atlassian Cloud (Jira, Confluence, and Bitbucket since the 2025 app-password
// deprecation) all authenticate as base64(email:api_token).

// ---------------------------------------------------------------- Rate limiting

// Per-host rate limit state
const rateLimitState = new Map();

// Default rate limit settings
const DEFAULT_RATE_LIMIT = {
  requestsPerSecond: 10, // Atlassian Cloud allows ~10 req/s
  minDelayMs: 100, // Minimum delay between requests
  maxRetries: 3, // Max retry attempts for rate-limited requests
  retryDelayMs: 1000, // Base delay for exponential backoff
};

/**
 * Get or create rate limit state for a host.
 * @param {string} url - Request URL
 * @returns {object} Rate limit state for the host
 */
function getRateLimitState(url) {
  const host = new URL(url).host;
  if (!rateLimitState.has(host)) {
    rateLimitState.set(host, {
      lastRequest: 0,
      retryAfter: 0,
      requestCount: 0,
      windowStart: Date.now(),
    });
  }
  return rateLimitState.get(host);
}

/**
 * Wait for rate limit window if needed.
 * @param {string} url - Request URL
 */
async function waitForRateLimit(url) {
  const state = getRateLimitState(url);
  const now = Date.now();

  // If we got a Retry-After header, respect it
  if (state.retryAfter > now) {
    const waitTime = state.retryAfter - now;
    await sleep(waitTime);
  }

  // Enforce minimum delay between requests
  const timeSinceLastRequest = now - state.lastRequest;
  if (timeSinceLastRequest < DEFAULT_RATE_LIMIT.minDelayMs) {
    await sleep(DEFAULT_RATE_LIMIT.minDelayMs - timeSinceLastRequest);
  }

  // Reset window every second
  if (now - state.windowStart > 1000) {
    state.requestCount = 0;
    state.windowStart = now;
  }

  // If we've hit the limit, wait for the window to reset
  if (state.requestCount >= DEFAULT_RATE_LIMIT.requestsPerSecond) {
    const waitTime = 1000 - (now - state.windowStart);
    if (waitTime > 0) {
      await sleep(waitTime);
    }
    state.requestCount = 0;
    state.windowStart = Date.now();
  }

  state.lastRequest = Date.now();
  state.requestCount++;
}

/**
 * Update rate limit state from response headers.
 * @param {string} url - Request URL
 * @param {Response} res - Fetch response
 */
function updateRateLimitFromResponse(url, res) {
  const state = getRateLimitState(url);

  // Check for Retry-After header (used by Atlassian for 429s)
  const retryAfter = res.headers.get("Retry-After");
  if (retryAfter) {
    const seconds = parseInt(retryAfter, 10);
    if (!isNaN(seconds)) {
      state.retryAfter = Date.now() + seconds * 1000;
    }
  }

  // Check for X-RateLimit headers (used by some Atlassian endpoints)
  const remaining = res.headers.get("X-RateLimit-Remaining");
  const reset = res.headers.get("X-RateLimit-Reset");
  if (remaining && parseInt(remaining, 10) === 0 && reset) {
    state.retryAfter = parseInt(reset, 10) * 1000;
  }
}

// ---------------------------------------------------------------- Retry logic

/**
 * Determine if an error is retryable.
 * @param {number} status - HTTP status code
 * @param {string} text - Response body
 * @returns {boolean} True if the request should be retried
 */
function isRetryable(status, text) {
  // Rate limited
  if (status === 429) return true;

  // Server errors (except 501 Not Implemented)
  if (status >= 500 && status !== 501) return true;

  // Request timeout
  if (status === 408) return true;

  // Gateway errors
  if (status === 502 || status === 503 || status === 504) return true;

  // Check for transient error messages
  const transientPatterns = [
    /temporarily unavailable/i,
    /service unavailable/i,
    /try again/i,
    /rate limit/i,
    /too many requests/i,
    /timeout/i,
    /connection reset/i,
    /ECONNRESET/i,
    /ETIMEDOUT/i,
  ];

  for (const pattern of transientPatterns) {
    if (pattern.test(text)) return true;
  }

  return false;
}

/**
 * Calculate exponential backoff delay.
 * @param {number} attempt - Attempt number (0-indexed)
 * @param {number} baseDelay - Base delay in ms
 * @returns {number} Delay in ms
 */
function backoffDelay(attempt, baseDelay = DEFAULT_RATE_LIMIT.retryDelayMs) {
  // Exponential backoff with jitter: baseDelay * 2^attempt + random(0-500)
  const exponential = baseDelay * Math.pow(2, attempt);
  const jitter = Math.random() * 500;
  return Math.min(exponential + jitter, 30000); // Cap at 30 seconds
}

/**
 * Sleep for a given duration.
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------- Auth helpers

export function basicAuth(email, token) {
  return "Basic " + Buffer.from(`${email}:${token}`).toString("base64");
}

export function bearerAuth(token) {
  return `Bearer ${token}`;
}

// ---------------------------------------------------------------- Main API function

/**
 * Make an HTTP request with retry logic and rate limiting.
 *
 * @param {string} url - Request URL
 * @param {object} [options] - Request options
 * @param {string} [options.method='GET'] - HTTP method
 * @param {string} [options.auth] - Authorization header value
 * @param {object|string} [options.body] - Request body (will be JSON-stringified if object)
 * @param {object} [options.headers={}] - Additional headers
 * @param {boolean} [options.raw=false] - Return raw text instead of parsed JSON
 * @param {number} [options.maxRetries] - Override max retry attempts
 * @param {boolean} [options.skipRateLimit=false] - Skip rate limiting (for time-sensitive requests)
 * @param {number} [options.timeout=30000] - Request timeout in ms
 * @returns {Promise<any>} Parsed response or raw text
 * @throws {Error} If request fails after all retries
 */
export async function api(
  url,
  {
    method = "GET",
    auth,
    body,
    headers = {},
    raw = false,
    maxRetries = DEFAULT_RATE_LIMIT.maxRetries,
    skipRateLimit = false,
    timeout = 30000,
  } = {},
) {
  let lastError;
  let lastStatus;
  let lastText;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // Wait for rate limit (unless skipped)
    if (!skipRateLimit) {
      await waitForRateLimit(url);
    }

    try {
      // Create abort controller for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const res = await fetch(url, {
        method,
        headers: {
          Authorization: auth,
          Accept: "application/json",
          ...(body ? { "Content-Type": "application/json" } : {}),
          ...headers,
        },
        body: body
          ? typeof body === "string"
            ? body
            : JSON.stringify(body)
          : undefined,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // Update rate limit state from response
      updateRateLimitFromResponse(url, res);

      const text = await res.text();
      lastStatus = res.status;
      lastText = text;

      // Success
      if (res.ok) {
        if (raw) return text;
        if (!text) return null;
        try {
          return JSON.parse(text);
        } catch {
          return text;
        }
      }

      // Check if retryable
      if (isRetryable(res.status, text) && attempt < maxRetries) {
        const delay =
          res.status === 429
            ? parseInt(res.headers.get("Retry-After") || "5", 10) * 1000
            : backoffDelay(attempt);

        console.warn(
          `[http] ${method} ${url} returned ${res.status}, retrying in ${Math.round(delay)}ms (attempt ${attempt + 1}/${maxRetries + 1})`,
        );
        await sleep(delay);
        continue;
      }

      // Non-retryable error
      throw new Error(formatError(res, url, method, text));
    } catch (err) {
      lastError = err;

      // Network errors (fetch throws)
      if (err.name === "AbortError") {
        if (attempt < maxRetries) {
          console.warn(
            `[http] ${method} ${url} timed out, retrying (attempt ${attempt + 1}/${maxRetries + 1})`,
          );
          await sleep(backoffDelay(attempt));
          continue;
        }
        throw new Error(
          `${method} ${url}\nRequest timed out after ${timeout}ms`,
        );
      }

      // Connection errors
      if (
        err.cause?.code &&
        ["ECONNRESET", "ETIMEDOUT", "ECONNREFUSED", "ENOTFOUND"].includes(
          err.cause.code,
        )
      ) {
        if (attempt < maxRetries) {
          console.warn(
            `[http] ${method} ${url} connection error: ${err.cause.code}, retrying (attempt ${attempt + 1}/${maxRetries + 1})`,
          );
          await sleep(backoffDelay(attempt));
          continue;
        }
      }

      // Re-throw if it's our formatted error
      if (err.message.startsWith(`${method} ${url}`)) {
        throw err;
      }

      // Unknown error
      throw new Error(`${method} ${url}\n${err.message}`);
    }
  }

  // Should not reach here, but just in case
  throw (
    lastError ||
    new Error(`${method} ${url}\nFailed after ${maxRetries + 1} attempts`)
  );
}

// ---------------------------------------------------------------- Error formatting

function formatError(res, url, method, text) {
  let detail = text.slice(0, 800);
  let errorMessages = null;

  try {
    const j = JSON.parse(text);
    errorMessages =
      j.errorMessages ?? j.errors ?? j.message ?? j.error?.message ?? j.error;
    if (errorMessages) {
      detail =
        typeof errorMessages === "string"
          ? errorMessages
          : JSON.stringify(errorMessages, null, 2);
    }
  } catch {
    /* keep raw body */
  }

  // Atlassian API tokens are scoped at creation time, and a Jira-scoped token
  // fails against Bitbucket with a message that reads like bad credentials.
  const noScopes = /no Bitbucket scopes/i.test(text);

  let hint = "";

  if (noScopes) {
    hint =
      "\nHint: this token works for Jira/Confluence but was created without Bitbucket scopes." +
      "\n      Mint a second token at https://id.atlassian.com/manage-profile/security/api-tokens" +
      "\n      selecting the Bitbucket scopes (read/write repository and pull requests), then set" +
      "\n      BITBUCKET_TOKEN to it — a token cannot be re-scoped after creation.";
  } else if (res.status === 401) {
    hint =
      "\nHint: token rejected. Atlassian and Bitbucket both need email + API token (app passwords stopped working in 2026).";
  } else if (res.status === 403) {
    hint =
      "\nHint: authenticated but not permitted. Check the token scopes for this site.";
  } else if (res.status === 404) {
    hint =
      "\nHint: not found. Wrong site, key, or the account lacks visibility on it.";
  } else if (res.status === 429) {
    hint =
      "\nHint: rate limited. The request will be retried automatically, or wait a moment and try again.";
  } else if (res.status === 400) {
    // Check for common ADF errors
    if (/invalid.*adf|adf.*invalid|document.*format/i.test(text)) {
      hint =
        "\nHint: invalid ADF document format. Use the ADF validation helpers in markup.mjs to check your payload.";
    } else if (/field.*required|required.*field/i.test(text)) {
      hint = "\nHint: a required field is missing. Check the request body.";
    }
  } else if (res.status >= 500) {
    hint =
      "\nHint: server error. This is usually temporary — the request will be retried automatically.";
  }

  return `${method} ${url}\n${res.status} ${res.statusText}: ${detail}${hint}`;
}

// ---------------------------------------------------------------- Multipart uploads

/**
 * Upload a file using multipart/form-data (for attachments).
 *
 * @param {string} url - Upload URL
 * @param {object} options - Options
 * @param {string} options.auth - Authorization header
 * @param {Buffer|Uint8Array} options.file - File content
 * @param {string} options.filename - Filename
 * @param {string} [options.contentType='application/octet-stream'] - File content type
 * @returns {Promise<any>} Parsed response
 */
export async function uploadFile(
  url,
  { auth, file, filename, contentType = "application/octet-stream" },
) {
  await waitForRateLimit(url);

  // Build multipart boundary
  const boundary = `----WorkCLIBoundary${Date.now()}`;

  // Build multipart body
  const parts = [
    `--${boundary}`,
    `Content-Disposition: form-data; name="file"; filename="${filename}"`,
    `Content-Type: ${contentType}`,
    "",
  ];

  const header = Buffer.from(parts.join("\r\n") + "\r\n");
  const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
  const body = Buffer.concat([header, Buffer.from(file), footer]);

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: auth,
      Accept: "application/json",
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
      "X-Atlassian-Token": "no-check", // Required for Jira attachment uploads
    },
    body,
  });

  updateRateLimitFromResponse(url, res);

  const text = await res.text();
  if (!res.ok) {
    throw new Error(formatError(res, url, "POST", text));
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
