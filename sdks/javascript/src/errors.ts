export class SubTrackrError extends Error {
  /** Server-assigned request id (envelope `meta.requestId`), for support/debugging. */
  public requestId?: string;
  /** Per-field validation details (envelope `error.details`). */
  public details?: Record<string, string>;

  constructor(
    public message: string,
    public statusCode?: number,
    public code?: string
  ) {
    super(message);
    this.name = 'SubTrackrError';
  }
}

export class AuthenticationError extends SubTrackrError {
  constructor(message: string = 'Authentication failed') {
    super(message, 401, 'unauthorized');
    this.name = 'AuthenticationError';
  }
}

export class ApiError extends SubTrackrError {
  constructor(
    message: string,
    statusCode: number,
    code?: string,
    extra: { requestId?: string; details?: Record<string, string> } = {}
  ) {
    super(message, statusCode, code);
    this.name = 'ApiError';
    this.requestId = extra.requestId;
    this.details = extra.details;
  }

  /** Whether retrying the same request may succeed. */
  get retryable(): boolean {
    const s = this.statusCode ?? 0;
    return s === 408 || s === 429 || s >= 500;
  }
}

export interface ParsedErrorBody {
  message: string;
  code?: string;
  requestId?: string;
  details?: Record<string, string>;
}

/**
 * Extracts error information from a response body. Accepts the canonical
 * envelope `{ success:false, error:{code,message,details}, meta:{requestId} }`
 * and the two legacy shapes `{ message, code }` and `{ error: "text" }`.
 */
export function parseErrorBody(body: unknown, fallbackMessage: string): ParsedErrorBody {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, any>;
  const meta = b.meta && typeof b.meta === 'object' ? b.meta : {};
  const requestId = typeof meta.requestId === 'string' ? meta.requestId : undefined;

  if (b.error && typeof b.error === 'object') {
    return {
      message: typeof b.error.message === 'string' && b.error.message ? b.error.message : fallbackMessage,
      code: typeof b.error.code === 'string' ? b.error.code : undefined,
      details: b.error.details && typeof b.error.details === 'object' ? b.error.details : undefined,
      requestId,
    };
  }
  if (typeof b.error === 'string' && b.error) {
    return { message: b.error, code: typeof b.code === 'string' ? b.code : undefined, requestId };
  }
  return {
    message: typeof b.message === 'string' && b.message ? b.message : fallbackMessage,
    code: typeof b.code === 'string' ? b.code : undefined,
    requestId,
  };
}

/** Builds an ApiError from a failed response body. */
export function apiErrorFromBody(body: unknown, status: number, fallbackMessage: string): ApiError {
  const p = parseErrorBody(body, fallbackMessage);
  return new ApiError(p.message, status, p.code, { requestId: p.requestId, details: p.details });
}

/**
 * Thrown when the caller requests an API version that is no longer supported.
 */
export class UnsupportedVersionError extends SubTrackrError {
  readonly requestedVersion: number;
  readonly minSupportedVersion: number;

  constructor(requestedVersion: number, minSupportedVersion: number) {
    super(
      `API version ${requestedVersion} is not supported by this SDK. ` +
        `Minimum supported version is ${minSupportedVersion}.`,
      400,
      'unsupported_version'
    );
    this.name = 'UnsupportedVersionError';
    this.requestedVersion = requestedVersion;
    this.minSupportedVersion = minSupportedVersion;
  }
}

/**
 * Thrown when a server response contains a version header that is incompatible
 * with the current SDK (e.g. a future API version the SDK doesn't understand).
 */
export class VersionMismatchError extends SubTrackrError {
  readonly sdkVersion: string;
  readonly apiVersion: number;

  constructor(sdkVersion: string, apiVersion: number, detail?: string) {
    super(
      detail ?? `API version mismatch: server returned v${apiVersion} but SDK is v${sdkVersion}.`,
      0,
      'version_mismatch'
    );
    this.name = 'VersionMismatchError';
    this.sdkVersion = sdkVersion;
    this.apiVersion = apiVersion;
  }
}
