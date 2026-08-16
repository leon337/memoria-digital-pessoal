import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  ExceptionFilter,
  HttpException,
  NotFoundException,
  ServiceUnavailableException
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { ApiErrorCode, ApiErrorEnvelope } from './api-error.js';

@Catch()
export class ApiErrorFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();

    let status = 500;
    let code: ApiErrorCode = 'INTERNAL_ERROR';
    let message = 'Ocorreu um erro interno.';

    if (exception instanceof ServiceUnavailableException) {
      status = 503;
      code = 'SERVICE_UNAVAILABLE';
      message = 'Serviço temporariamente indisponível.';
    } else if (exception instanceof BadRequestException) {
      status = 400;
      code = 'VALIDATION_FAILED';
      message = 'Os dados enviados são inválidos.';
    } else if (exception instanceof NotFoundException) {
      status = 404;
      code = 'NOT_FOUND';
      message = 'Recurso não encontrado.';
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      message = 'A solicitação não pôde ser processada.';
    }

    const body: ApiErrorEnvelope = {
      error: { code, message, requestId: request.requestId }
    };
    response.status(status).json(body);
  }
}
