export type ApiErrorCode =
  'VALIDATION_FAILED' | 'NOT_FOUND' | 'INTERNAL_ERROR' | 'SERVICE_UNAVAILABLE';

export interface ApiErrorEnvelope {
  error: {
    code: ApiErrorCode;
    message: string;
    requestId: string;
    fields?: Record<string, string[]>;
  };
}
