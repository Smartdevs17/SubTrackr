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
