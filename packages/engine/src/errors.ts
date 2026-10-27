/**
 * Errors the engine throws. They are for misuse and for failures of the worker itself;
 * problems with the data are findings and never errors.
 */

/** An error as it crosses from the worker to the main thread. */
export interface SerializedError {
  /** The error's class name in the worker, such as `Error` or `TypeError`. */
  readonly name: string;
  readonly message: string;
  /** Where it happened in the worker, if the engine there knew. */
  readonly stack?: string;
}

/** A request the worker could not carry out: the kernel refused it or the worker failed. */
export class EngineError extends Error {
  /** The name of the error as it was in the worker. */
  readonly remoteName: string;
  /** The worker's stack trace, which names code the main thread does not have. */
  readonly remoteStack: string | undefined;

  constructor(remote: SerializedError) {
    super(remote.message);
    this.name = 'EngineError';
    this.remoteName = remote.name;
    this.remoteStack = remote.stack;
  }
}

/** Something was asked of an engine that has been disposed. */
export class EngineDisposedError extends Error {
  constructor(message = 'The engine has been disposed; create another one.') {
    super(message);
    this.name = 'EngineDisposedError';
  }
}

/** Describes anything that was thrown, so it can be sent as a message. */
export function serializeError(thrown: unknown): SerializedError {
  if (thrown instanceof Error) {
    return thrown.stack === undefined
      ? { name: thrown.name, message: thrown.message }
      : { name: thrown.name, message: thrown.message, stack: thrown.stack };
  }
  return {
    name: 'Error',
    message: typeof thrown === 'string' ? thrown : 'Something was thrown that is not an error.',
  };
}
