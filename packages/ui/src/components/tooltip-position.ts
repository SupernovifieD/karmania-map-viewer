/** A box on the page, in pixels from the top left of the window. */
export interface Box {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** Which side of the control the tooltip sits on. */
export type Placement = 'top' | 'bottom' | 'left' | 'right';

/** Where a tooltip goes. */
export interface Position {
  readonly left: number;
  readonly top: number;
  /** The side it ended up on, which may not be the one it was asked for. */
  readonly placement: Placement;
}

/** Whether some text, from an attribute say, is one of the sides. */
export function isPlacement(side: string): side is Placement {
  return side === 'top' || side === 'bottom' || side === 'left' || side === 'right';
}

const OPPOSITE: Readonly<Record<Placement, Placement>> = {
  top: 'bottom',
  bottom: 'top',
  left: 'right',
  right: 'left',
};

/**
 * Works out where a tooltip of size `tip` goes for the control `anchor`, in a window of size
 * `viewport`: centred on the control along the side it is on (above or below it, or beside it),
 * on the preferred side if it fits there and on the opposite side if not, and always inside the
 * window, `margin` from its edges. Where neither side has room for it, it takes the side with
 * more, and is slid until it is inside.
 */
export function placeTooltip(
  anchor: Box,
  tip: { readonly width: number; readonly height: number },
  viewport: { readonly width: number; readonly height: number },
  gap: number,
  margin: number,
  preferred: Placement = 'top',
): Position {
  const room: Readonly<Record<Placement, number>> = {
    top: anchor.top - gap - margin,
    bottom: viewport.height - margin - (anchor.top + anchor.height + gap),
    left: anchor.left - gap - margin,
    right: viewport.width - margin - (anchor.left + anchor.width + gap),
  };
  // What the tooltip needs of the room on a side: its height above or below, its width beside.
  const needed = (side: Placement): number =>
    side === 'top' || side === 'bottom' ? tip.height : tip.width;
  const other = OPPOSITE[preferred];
  let placement = preferred;
  if (room[preferred] < needed(preferred)) {
    placement = room[other] >= needed(other) || room[other] > room[preferred] ? other : preferred;
  }
  const centredLeft = anchor.left + anchor.width / 2 - tip.width / 2;
  const centredTop = anchor.top + anchor.height / 2 - tip.height / 2;
  const raw = {
    top: { left: centredLeft, top: anchor.top - gap - tip.height },
    bottom: { left: centredLeft, top: anchor.top + anchor.height + gap },
    left: { left: anchor.left - gap - tip.width, top: centredTop },
    right: { left: anchor.left + anchor.width + gap, top: centredTop },
  }[placement];
  const clamp = (value: number, size: number, limit: number): number =>
    Math.max(margin, Math.min(value, limit - margin - size));
  return {
    left: clamp(raw.left, tip.width, viewport.width),
    top: clamp(raw.top, tip.height, viewport.height),
    placement,
  };
}
