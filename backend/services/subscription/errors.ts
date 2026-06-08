import { DomainError } from '../shared/errors';
import { ErrorCode } from '../shared/apiResponse';

export class SubscriptionError extends DomainError {
  constructor(code: ErrorCode, message: string, details?: Record<string, string>) {
    super(code, message, details);
  }
}
