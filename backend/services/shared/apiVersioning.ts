/**
 * API Versioning with Deprecation Management — SubTrackr
 *
 * Provides URL-based versioning, header-based version negotiation,
 * deprecation warnings, and sunset headers for API lifecycle management.
 */

export interface ApiVersion {
  version: string;
  releasedAt: string;
  deprecatedAt: string | null;
  sunsetAt: string | null;
  status: 'active' | 'deprecated' | 'sunset';
}

export interface VersionNegotiationResult {
  version: string;
  deprecated: boolean;
  sunset: boolean;
  deprecationWarning?: string;
  sunsetWarning?: string;
  links?: Record<string, string>;
}

export interface DeprecationNotice {
  version: string;
  message: string;
  alternative: string;
  deprecationDate: string;
  sunsetDate: string;
}

const API_VERSIONS: ApiVersion[] = [
  {
    version: '1.0',
    releasedAt: '2024-01-01T00:00:00Z',
    deprecatedAt: null,
    sunsetAt: null,
    status: 'active',
  },
  {
    version: '2.0',
    releasedAt: '2024-06-01T00:00:00Z',
    deprecatedAt: null,
    sunsetAt: null,
    status: 'active',
  },
];

const LATEST_VERSION = '2.0';
const DEFAULT_VERSION = '1.0';

const deprecationMessages: Record<string, DeprecationNotice> = {};

export function registerDeprecation(
  version: string,
  notice: Omit<DeprecationNotice, 'version'>,
): void {
  deprecationMessages[version] = { ...notice, version };

  const apiVersion = API_VERSIONS.find((v) => v.version === version);
  if (apiVersion) {
    apiVersion.status = 'deprecated';
    apiVersion.deprecatedAt = notice.deprecationDate;
    apiVersion.sunsetAt = notice.sunsetDate;
  }
}

export function getVersions(): ApiVersion[] {
  return [...API_VERSIONS];
}

export function getLatestVersion(): string {
  return LATEST_VERSION;
}

export function negotiateVersion(request: {
  acceptVersion?: string;
  urlVersion?: string;
  headerVersion?: string;
}): VersionNegotiationResult {
  const requestedVersion = request.urlVersion ?? request.headerVersion ?? request.acceptVersion ?? DEFAULT_VERSION;

  const matched = API_VERSIONS.find((v) => v.version === requestedVersion);

  if (!matched) {
    return {
      version: DEFAULT_VERSION,
      deprecated: false,
      sunset: false,
    };
  }

  const result: VersionNegotiationResult = {
    version: matched.version,
    deprecated: matched.status === 'deprecated',
    sunset: matched.status === 'sunset',
  };

  if (matched.status === 'deprecated' && deprecationMessages[matched.version]) {
    const notice = deprecationMessages[matched.version];
    result.deprecationWarning = notice.message;
    result.links = {
      deprecation: notice.deprecationDate,
      sunset: notice.sunsetDate,
      latest: `/api/${LATEST_VERSION}`,
    };
  }

  if (matched.status === 'sunset') {
    result.sunsetWarning = `API version ${matched.version} has been sunset. Please migrate to version ${LATEST_VERSION}.`;
    result.links = {
      migration: `/api/${LATEST_VERSION}/migration-guide`,
      latest: `/api/${LATEST_VERSION}`,
    };
  }

  return result;
}

export function getVersionHeaders(negotiation: VersionNegotiationResult): Record<string, string> {
  const headers: Record<string, string> = {
    'X-API-Version': negotiation.version,
  };

  if (negotiation.deprecated) {
    headers['Deprecation'] = 'true';
    if (negotiation.deprecationWarning) {
      headers['Deprecation-Notice'] = negotiation.deprecationWarning;
    }
    if (negotiation.links) {
      headers['Link'] = Object.entries(negotiation.links)
        .map(([rel, url]) => `<${url}>; rel="${rel}"`)
        .join(', ');
    }
  }

  if (negotiation.sunset) {
    const matched = API_VERSIONS.find((v) => v.version === negotiation.version);
    if (matched?.sunsetAt) {
      headers['Sunset'] = matched.sunsetAt;
    }
  }

  return headers;
}

export function createVersionMiddleware() {
  return function versionMiddleware(
    req: { url?: string; headers?: Record<string, string | string[] | undefined> },
    res: { setHeader(name: string, value: string | string[]): void },
    next: () => void,
  ): void {
    const urlVersion = extractVersionFromUrl(req.url ?? '');
    const headerVersion = typeof req.headers?.['x-api-version'] === 'string'
      ? req.headers['x-api-version']
      : undefined;
    const acceptVersion = typeof req.headers?.['accept'] === 'string'
      ? extractVersionFromAccept(req.headers['accept'])
      : undefined;

    const negotiation = negotiateVersion({ urlVersion, headerVersion, acceptVersion });

    if (negotiation.sunset) {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('HTTP/1.1', '503 Service Unavailable');
      return;
    }

    const versionHeaders = getVersionHeaders(negotiation);
    for (const [name, value] of Object.entries(versionHeaders)) {
      res.setHeader(name, value);
    }

    next();
  };
}

function extractVersionFromUrl(url: string): string | undefined {
  const match = url.match(/\/api\/v(\d+(?:\.\d+)?)\//);
  return match ? match[1] : undefined;
}

function extractVersionFromAccept(accept: string): string | undefined {
  const match = accept.match(/application\/vnd\.subtrackr\.v(\d+(?:\.\d+)?)(\+json)?/);
  return match ? match[1] : undefined;
}

export function getDeprecationNotice(version: string): DeprecationNotice | undefined {
  return deprecationMessages[version];
}

export function getActiveVersions(): ApiVersion[] {
  return API_VERSIONS.filter((v) => v.status === 'active');
}

export function getDeprecatedVersions(): ApiVersion[] {
  return API_VERSIONS.filter((v) => v.status === 'deprecated');
}
