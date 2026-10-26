import { passkeyService, PasskeyService } from '../domain/PasskeyService';
import { AuthError } from '../errors';
import { ok, fail } from '../../shared/apiResponse';
import type { ApiResponse, ErrorCode } from '../../shared/apiResponse';
import type {
  PasskeyAuthenticationOptions,
  PasskeyAuthenticationResponse,
  PasskeyAuthenticationResult,
  PasskeyCredential,
  PasskeyRegistrationOptions,
  PasskeyRegistrationResponse,
} from '../interfaces';

/** Public view of a stored credential — the public key stays server-side. */
export type PasskeySummary = Omit<PasskeyCredential, 'publicKey'>;

function toSummary(credential: PasskeyCredential): PasskeySummary {
  const { publicKey: _publicKey, ...summary } = credential;
  return summary;
}

function failFromError(err: unknown, fallback: ErrorCode, requestId?: string): ApiResponse<never> {
  if (err instanceof AuthError) {
    return fail(
      err.code as ErrorCode,
      err.message,
      requestId,
      err.details as Record<string, string>
    );
  }
  return fail(fallback, err instanceof Error ? err.message : 'Passkey request failed', requestId);
}

export class PasskeyController {
  constructor(private readonly service: PasskeyService = passkeyService) {}

  async registrationOptions(
    body: { userId?: string; userName?: string; displayName?: string },
    requestId?: string
  ): Promise<ApiResponse<PasskeyRegistrationOptions>> {
    if (!body.userId || !body.userName) {
      return fail('VALIDATION_ERROR', 'userId and userName are required', requestId);
    }
    try {
      const options = this.service.generateRegistrationOptions({
        userId: body.userId,
        userName: body.userName,
        displayName: body.displayName,
      });
      return ok(options, requestId);
    } catch (err) {
      return failFromError(err, 'INTERNAL_SERVER_ERROR', requestId);
    }
  }

  async verifyRegistration(
    body: { userId?: string; response?: PasskeyRegistrationResponse; deviceName?: string },
    requestId?: string
  ): Promise<ApiResponse<PasskeySummary>> {
    if (!body.userId || !body.response) {
      return fail('VALIDATION_ERROR', 'userId and response are required', requestId);
    }
    try {
      const credential = this.service.verifyRegistration({
        userId: body.userId,
        response: body.response,
        deviceName: body.deviceName,
      });
      return ok(toSummary(credential), requestId);
    } catch (err) {
      return failFromError(err, 'AUTH_PASSKEY_VERIFICATION_FAILED', requestId);
    }
  }

  async authenticationOptions(
    body: { userId?: string },
    requestId?: string
  ): Promise<ApiResponse<PasskeyAuthenticationOptions>> {
    try {
      return ok(this.service.generateAuthenticationOptions({ userId: body.userId }), requestId);
    } catch (err) {
      return failFromError(err, 'INTERNAL_SERVER_ERROR', requestId);
    }
  }

  async verifyAuthentication(
    body: { response?: PasskeyAuthenticationResponse },
    requestId?: string
  ): Promise<ApiResponse<PasskeyAuthenticationResult>> {
    if (!body.response) return fail('VALIDATION_ERROR', 'response is required', requestId);
    try {
      return ok(this.service.verifyAuthentication(body.response), requestId);
    } catch (err) {
      return failFromError(err, 'AUTH_PASSKEY_VERIFICATION_FAILED', requestId);
    }
  }

  async listCredentials(
    userId: string,
    requestId?: string
  ): Promise<ApiResponse<PasskeySummary[]>> {
    return ok(this.service.listCredentials(userId).map(toSummary), requestId);
  }

  async removeCredential(
    userId: string,
    credentialId: string,
    requestId?: string
  ): Promise<ApiResponse<{ removed: boolean }>> {
    try {
      return ok({ removed: this.service.removeCredential(userId, credentialId) }, requestId);
    } catch (err) {
      return failFromError(err, 'INTERNAL_SERVER_ERROR', requestId);
    }
  }
}

export const passkeyController = new PasskeyController();
