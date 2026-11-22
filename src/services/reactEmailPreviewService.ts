/**
 * Frontend React Email template service — renders email preview HTML
 * by delegating to the backend React Email API.
 *
 * Issue #2214: Refactor transactional email rendering using React Email.
 *
 * The frontend uses this service to show a live preview of a transactional
 * email template before sending. The actual rendering happens on the backend;
 * this service prepares the request and handles the HTTP round-trip.
 */

export type ReactEmailTemplateId =
  | 'receipt_payment_succeeded'
  | 'invoice_due'
  | 'invoice_overdue'
  | 'payment_method_updated'
  | 'refund_issued'
  | 'subscription_renewed'
  | 'password_reset'
  | 'email_verification';

export interface ReactEmailPreviewResult {
  html: string;
  text: string;
  subject: string;
}

export interface ReactEmailPreviewRequest {
  templateId: ReactEmailTemplateId;
  variables: Record<string, string>;
}

/** Injectable HTTP client for backend email preview endpoints. */
export interface ReactEmailHttpClient {
  post(path: string, body: unknown): Promise<unknown>;
}

export class ReactEmailPreviewService {
  private static instance: ReactEmailPreviewService;

  private constructor(
    private httpClient: ReactEmailHttpClient,
    private basePath: string = '/api/emails/react-preview',
  ) {}

  static getInstance(httpClient?: ReactEmailHttpClient): ReactEmailPreviewService {
    if (!ReactEmailPreviewService.instance) {
      const client: ReactEmailHttpClient =
        httpClient ??
        {
          post: async (path: string, body: unknown) => {
            const res = await fetch(path, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
            });
            return res.json();
          },
        };
      ReactEmailPreviewService.instance = new ReactEmailPreviewService(client);
    }
    return ReactEmailPreviewService.instance;
  }

  static reset(): void {
    ReactEmailPreviewService.instance = undefined as unknown as ReactEmailPreviewService;
  }

  static createWithClient(httpClient: ReactEmailHttpClient, basePath?: string): ReactEmailPreviewService {
    return new ReactEmailPreviewService(httpClient, basePath ?? '/api/emails/react-preview');
  }

  /** Preview a transactional email template with the given variables. */
  async preview(request: ReactEmailPreviewRequest): Promise<ReactEmailPreviewResult> {
    if (!request.templateId) {
      throw new Error('templateId is required');
    }
    if (!request.variables || typeof request.variables !== 'object') {
      throw new Error('variables must be a Record<string, string>');
    }
    return this.httpClient.post(this.basePath, request) as Promise<ReactEmailPreviewResult>;
  }

  /** Get the list of available template IDs. */
  getTemplateIds(): ReactEmailTemplateId[] {
    return [
      'receipt_payment_succeeded',
      'invoice_due',
      'invoice_overdue',
      'payment_method_updated',
      'refund_issued',
      'subscription_renewed',
      'password_reset',
      'email_verification',
    ];
  }
}

export const reactEmailPreviewService = ReactEmailPreviewService.getInstance();
