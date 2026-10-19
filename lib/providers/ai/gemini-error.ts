import "server-only";

/**
 * Error raised for a known AI-provider failure. `retryable` drives whether the
 * durable workflow retries the step or surfaces a terminal state to the user.
 * Kept in its own module so media-upload helpers can share it without a cycle.
 */
export class GeminiExtractionError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "GeminiExtractionError";
  }
}
