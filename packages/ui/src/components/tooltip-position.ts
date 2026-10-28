/** A box on the page, in pixels from the top left of the window. */
export interface Box {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** Which side of the control the tooltip sits on. */
export type Placement = 'top' | 'bottom';

/** Where a tooltip goes. */
export interface Position {
  readonly left: number;
  readonly top: number;
  /** The side it ended up on, which may not be the one it was asked for. */
  readonly placement: Placement;
}

/**
 * Works out where a tooltip of size `tip` goes for the control `anchor`, in a window of size
 * `viewport`: centred on the control, on the preferred side if it fits there and on the other
 * side if not, and always inside the window, `margin` from its edges. Where neither side has
 * room for it, it takes the side with more, and is slid until it is inside.
 */
export function placeTooltip(
  anchor: Box,
  tip: { readonly width: number; readonly height: number },
  viewport: { readonly width: number; readonly height: number },
  gap: number,
  margin: number,
  preferred: Placement = 'top',
): Position {
  const room = {
    top: anchor.top - gap - margin,
    bottom: viewport.height - margin - (anchor.top + anchor.height + gap),
  };
  const other: Placement = preferred === 'top' ? 'bottom' : 'top';
  let placement = preferred;
  if (room[preferred] < tip.height) {
    placement = room[other] >= tip.height || room[other] > room[preferred] ? other : preferred;
  }
  const rawTop =
    placement === 'top' ? anchor.top - gap - tip.height : anchor.top + anchor.height + gap;
  const rawLeft = anchor.left + anchor.width / 2 - tip.width / 2;
  const clamp = (value: number, size: number, limit: number): number =>
    Math.max(margin, Math.min(value, limit - margin - size));
  return {
    left: clamp(rawLeft, tip.width, viewport.width),
    top: clamp(rawTop, tip.height, viewport.height),
    placement,
  };
}
