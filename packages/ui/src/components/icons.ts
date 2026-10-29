/**
 * The icons the UI uses, from Lucide (ISC license): a name for each, and its drawing. A new
 * icon is a new line in each of the three places below; the compiler insists on all of them.
 */
import box from 'lucide-static/icons/box.svg?raw';
import check from 'lucide-static/icons/check.svg?raw';
import chevronDown from 'lucide-static/icons/chevron-down.svg?raw';
import chevronsLeft from 'lucide-static/icons/chevrons-left.svg?raw';
import chevronsRight from 'lucide-static/icons/chevrons-right.svg?raw';
import circleAlert from 'lucide-static/icons/circle-alert.svg?raw';
import file from 'lucide-static/icons/file.svg?raw';
import grid from 'lucide-static/icons/grid-3x3.svg?raw';
import info from 'lucide-static/icons/info.svg?raw';
import layers from 'lucide-static/icons/layers.svg?raw';
import map from 'lucide-static/icons/map.svg?raw';
import mapPin from 'lucide-static/icons/map-pin.svg?raw';
import pentagon from 'lucide-static/icons/pentagon.svg?raw';
import search from 'lucide-static/icons/search.svg?raw';
import spline from 'lucide-static/icons/spline.svg?raw';
import table from 'lucide-static/icons/table.svg?raw';
import trash from 'lucide-static/icons/trash-2.svg?raw';
import triangle from 'lucide-static/icons/triangle.svg?raw';
import triangleAlert from 'lucide-static/icons/triangle-alert.svg?raw';
import upload from 'lucide-static/icons/upload.svg?raw';
import x from 'lucide-static/icons/x.svg?raw';

/** Every icon, by Lucide's name for it. */
export const ICON_NAMES = [
  'box',
  'check',
  'chevron-down',
  'chevrons-left',
  'chevrons-right',
  'circle-alert',
  'file',
  'grid-3x3',
  'info',
  'layers',
  'map',
  'map-pin',
  'pentagon',
  'search',
  'spline',
  'table',
  'trash-2',
  'triangle',
  'triangle-alert',
  'upload',
  'x',
] as const;

/** The name of an icon. */
export type IconName = (typeof ICON_NAMES)[number];

const DRAWINGS: Readonly<Record<IconName, string>> = {
  box,
  check,
  'chevron-down': chevronDown,
  'chevrons-left': chevronsLeft,
  'chevrons-right': chevronsRight,
  'circle-alert': circleAlert,
  file,
  'grid-3x3': grid,
  info,
  layers,
  map,
  'map-pin': mapPin,
  pentagon,
  search,
  spline,
  table,
  'trash-2': trash,
  triangle,
  'triangle-alert': triangleAlert,
  upload,
  x,
};

/** Whether some text, from an attribute say, is the name of an icon. */
export function isIconName(name: string): name is IconName {
  return ICON_NAMES.some((known) => known === name);
}

/**
 * What goes inside the `<svg>` of an icon: its paths and shapes, without the `<svg>` element
 * Lucide wraps them in (the component draws that, at the size it was asked for, in the
 * color of the text around it).
 */
export function iconShapes(name: IconName): string {
  return DRAWINGS[name]
    .replace(/^[\s\S]*?<svg[^>]*>/, '')
    .replace(/<\/svg>\s*$/, '')
    .trim();
}
