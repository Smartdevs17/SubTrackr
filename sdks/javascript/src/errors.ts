export class SubTrackrError extends Error {
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
  constructor(message: string, statusCode: number, code?: string) {
    super(message, statusCode, code);
    this.name = 'ApiError';
  }
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
      detail ??
        `API version mismatch: server returned v${apiVersion} but SDK is v${sdkVersion}.`,
      0,
      'version_mismatch'
    );
    this.name = 'VersionMismatchError';
    this.sdkVersion = sdkVersion;
    this.apiVersion = apiVersion;
  }
}
