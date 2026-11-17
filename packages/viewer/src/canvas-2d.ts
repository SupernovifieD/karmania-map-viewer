/**
 * What the drawing of the exported picture needs of a canvas: a page's `CanvasRenderingContext2D` and an offscreen one are both this. Named by what is used, so that the
 * drawing is tested with a context that records what it is asked (there is no canvas in the unit tests).
 */
export interface Canvas2d {
  save(): void;
  restore(): void;
  translate(x: number, y: number): void;
  rotate(angle: number): void;
  scale(x: number, y: number): void;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  closePath(): void;
  roundRect(x: number, y: number, width: number, height: number, radius: number): void;
  rect(x: number, y: number, width: number, height: number): void;
  clip(): void;
  fill(path?: Path2D): void;
  stroke(path?: Path2D): void;
  fillRect(x: number, y: number, width: number, height: number): void;
  strokeRect(x: number, y: number, width: number, height: number): void;
  fillText(text: string, x: number, y: number): void;
  putImageData(image: ImageData, x: number, y: number): void;
  measureText(text: string): { readonly width: number };
  fillStyle: string | CanvasGradient | CanvasPattern;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  lineCap: CanvasLineCap;
  lineJoin: CanvasLineJoin;
  font: string;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
}

/** A length of the screen (96 to the inch) in whole pixels of a picture of `scale` (`dpi / 96`): whole, so that a line is crisp. */
export const atScale =
  (scale: number) =>
  (length: number): number =>
    Math.round(length * scale);
