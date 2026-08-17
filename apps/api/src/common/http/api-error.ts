import type { ApiErrorCode as SharedApiErrorCode } from '@mdp/contracts';
import { HttpException } from '@nestjs/common';

export type { ApiErrorCode, ApiErrorEnvelope } from '@mdp/contracts';

export class CodedHttpException extends HttpException {
  constructor(
    readonly code: SharedApiErrorCode,
    status: number,
    readonly safeMessage: string,
  ) {
    super(safeMessage, status);
  }
}
