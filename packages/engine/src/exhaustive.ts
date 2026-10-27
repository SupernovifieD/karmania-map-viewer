/**
 * Marks the end of a `switch` over a union: it only compiles while every case is
 * handled, so adding a member to the union points at every place that has to change.
 * If it is reached anyway (a value that does not match its type), it throws.
 */
export function assertNever(value: never): never {
  throw new Error(`Unhandled value: ${JSON.stringify(value)}`);
}
