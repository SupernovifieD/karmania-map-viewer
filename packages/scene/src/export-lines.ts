/**
 * The lines of the legend as the exported picture has them, one after the other: the group headings, the layers and
 * the classes under them. The layout (`export-layout.ts`) measures each, sets them in columns and says where each goes;
 * the export (step 22.3) draws them. Only what is in the picture is listed.
 */
import type { ClassEntry } from './class-entries.js';
import type { LayerSwatch, LegendLayerEntry, LegendModel } from './legend-model.js';

/** A line of the exported legend. */
export type ExportLine =
  | {
      readonly kind: 'group';
      /** The id of the group. */
      readonly id: string;
      readonly name: string;
    }
  | {
      readonly kind: 'layer';
      readonly id: string;
      readonly name: string;
      readonly swatch: LayerSwatch;
      /** Whether a line of its classes follows, which a line of the layer is not left at the end of a column from. */
      readonly hasClasses: boolean;
      /** Whether it is in a group, and so is drawn one step in. */
      readonly indented: boolean;
    }
  | {
      readonly kind: 'class';
      /** The id of the layer the class is of. */
      readonly layerId: string;
      readonly entry: ClassEntry;
      readonly indented: boolean;
    };

function linesOfLayer(layer: LegendLayerEntry, indented: boolean): ExportLine[] {
  return [
    {
      kind: 'layer',
      id: layer.id,
      name: layer.name,
      swatch: layer.swatch,
      hasClasses: layer.classes.length > 0,
      indented,
    },
    ...layer.classes.map((entry): ExportLine => ({
      kind: 'class',
      layerId: layer.id,
      entry,
      indented,
    })),
  ];
}

/** Whether a layer is in the picture: the person has it on, and the engine says it is drawn. */
function inPicture(layer: LegendLayerEntry): boolean {
  return layer.visible && layer.drawn;
}

/**
 * The lines of the exported legend, in the order of the Legend tab. **Only layers that are on and are drawn are
 * listed** (section 10.6: "only visible layers appear"; a layer that is on but cannot be drawn is not in the picture,
 * so it is not in its legend), a group appears only if it has such a layer, and whether a group is folded in the
 * Legend tab does not matter: a picture has no way to unfold it.
 */
export function exportLegendLines(model: LegendModel): ExportLine[] {
  return model.entries.flatMap((entry): ExportLine[] => {
    if (entry.type === 'layer') {
      return inPicture(entry) ? linesOfLayer(entry, false) : [];
    }
    const layers = entry.layers.filter(inPicture);
    if (layers.length === 0) {
      return [];
    }
    return [
      { kind: 'group', id: entry.id, name: entry.name },
      ...layers.flatMap((layer) => linesOfLayer(layer, true)),
    ];
  });
}
