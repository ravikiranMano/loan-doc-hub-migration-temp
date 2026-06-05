import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

/**
 * Catches everything that HttpExceptionFilter does NOT handle —
 * Prisma errors, runtime exceptions, third-party throws, etc.
 * Must be registered BEFORE HttpExceptionFilter (outermost filter runs first).
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('UnhandledException');

  constructor(private readonly isProd: boolean) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx      = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request  = ctx.getRequest<Request>();
    const status   = HttpStatus.INTERNAL_SERVER_ERROR;

    // Never leak stack traces or internal error messages in production.
    const message = this.isProd
      ? 'Internal server error'
      : (exception instanceof Error ? exception.message : String(exception));

    this.logger.error(
      `${request.method} ${request.url} → 500`,
      exception instanceof Error ? exception.stack : String(exception),
    );

    response.status(status).json({
      statusCode: status,
      message,
      path: request.url,
      timestamp: new Date().toISOString(),
    });
  }
}
