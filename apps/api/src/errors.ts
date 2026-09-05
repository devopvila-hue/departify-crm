import type { FastifyReply, FastifyRequest } from 'fastify';
import { ErrorCodes, type ApiErrorBody, type ErrorCode } from '@departify-crm/shared';

export class ApiError extends Error {
  public readonly code: ErrorCode;
  public readonly statusCode: number;
  public readonly details?: Record<string, unknown>;

  constructor(code: ErrorCode, message: string, statusCode: number, details?: Record<string, unknown>) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

export const httpError = (code: ErrorCode, message: string, statusCode: number, details?: Record<string, unknown>) =>
  new ApiError(code, message, statusCode, details);

export const badRequest = (message: string, details?: Record<string, unknown>) =>
  httpError(ErrorCodes.VALIDATION_ERROR, message, 400, details);
export const unauthorized = (message = 'Authentication required') =>
  httpError(ErrorCodes.UNAUTHENTICATED, message, 401);
export const forbidden = (message = 'You do not have access to this resource') =>
  httpError(ErrorCodes.FORBIDDEN, message, 403);
export const notFound = (message = 'Resource not found') => httpError(ErrorCodes.NOT_FOUND, message, 404);
export const conflict = (message: string, details?: Record<string, unknown>) =>
  httpError(ErrorCodes.CONFLICT, message, 409, details);
export const rateLimited = (message = 'Too many requests') => httpError(ErrorCodes.RATE_LIMITED, message, 429);

export function sendError(err: unknown, request: FastifyRequest, reply: FastifyReply) {
  const correlationId = request.id;

  if (err instanceof ApiError) {
    const body: ApiErrorBody = {
      code: err.code,
      message: err.message,
      details: err.details,
      correlationId,
    };
    return reply.status(err.statusCode).send(body);
  }

  request.log.error({ err }, 'unhandled error');
  const body: ApiErrorBody = {
    code: ErrorCodes.INTERNAL,
    message: 'Internal server error',
    correlationId,
  };
  return reply.status(500).send(body);
}
