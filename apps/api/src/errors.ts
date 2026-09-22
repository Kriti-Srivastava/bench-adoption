/**
 * Expected failures carry an HTTP status and a stable machine-readable code.
 * Services throw these; the app's error handler turns them into
 * `{ error: { code, message } }` responses.
 */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const badRequest = (code: string, message: string) => new AppError(400, code, message);
export const unauthorized = (message = 'Please sign in.') =>
  new AppError(401, 'unauthorized', message);
export const forbidden = (message = 'You do not have access to this.') =>
  new AppError(403, 'forbidden', message);
export const notFound = (what: string) => new AppError(404, 'not_found', `${what} not found.`);
export const conflict = (code: string, message: string) => new AppError(409, code, message);
