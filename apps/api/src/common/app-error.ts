export interface AppFieldError {
  readonly field: string;
  readonly message: string;
}

export class AppError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode: number,
    readonly options: {
      readonly businessRef?: string;
      readonly fieldErrors?: readonly AppFieldError[];
      readonly retryable?: boolean;
    } = {},
  ) {
    super(message);
    this.name = 'AppError';
  }
}
