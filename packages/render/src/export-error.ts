/**
 * The error of an export that cannot be made (step 22.1c, and in the public exports of `@karmania/viewer` since 23.F3): a module of its own, with nothing of three.js in it,
 * so that the declarations of the package that name it do not need the types of three.js.
 */
/** Why an export did not come to an end: what a person is told is from the code (an abort is the signal's own reason, not one of these). */
export type ExportErrorCode =
  /** Another export is being made. */
  | 'busy'
  /** The layers or the view changed while it was being made, so what is drawn is not what was asked for. */
  | 'interrupted'
  /** The graphics card took the map away while it was being made. */
  | 'context_lost'
  /** The map was taken out of the page. */
  | 'disposed'
  /** The map was still being put on the card, or the card did not give the picture. */
  | 'not_ready'
  /** The picture is larger than the card draws. */
  | 'too_large'
  /** A point of the map, at the size of the picture, is larger than the card draws a point. */
  | 'point_size'
  /** The card has not the memory for a picture of this size. */
  | 'out_of_memory';

/** What goes wrong with an export that is not a mistake of the caller. */
export class ExportError extends Error {
  readonly code: ExportErrorCode;

  constructor(code: ExportErrorCode, message: string) {
    super(message);
    this.name = 'ExportError';
    this.code = code;
  }
}
