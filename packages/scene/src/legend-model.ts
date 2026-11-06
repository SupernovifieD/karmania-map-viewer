/**
 * The legend as data: the groups and layers in the order they are listed, with their swatches, the lines under
 * each layer, and a notice for each layer that cannot be drawn. The Legend tab draws it as DOM and the export draws it
 * on a canvas (step 22.3), so the two say the same words with the same numbers and colours.
 */
import type { ClassBreaks, DrawableEntry } from '@karmania/engine/display';
import type { Finding } from '@karmania/engine/types';
import { classColours, classEntries, type ClassEntry } from './class-entries.js';
import { rampById, sampleRamp } from './ramps.js';
import type { Layer, LayerId, SceneDocument } from './types.js';

/** What is known besides the document: the classes of each classified layer, and what the engine says is drawn. */
export interface LegendInputs {
  /** The breaks of the layers that were classified (what `engine.classify` gave), by layer id. */
  readonly breaks?: Readonly<Record<LayerId, ClassBreaks>>;
  /** `FrameChoice.drawable`: one entry for each dataset, with whether it is drawn and why not. */
  readonly drawable?: readonly DrawableEntry[];
}

/** Why a layer is not on the map, and what to do, in the engine's words. */
export interface LayerNotice {
  readonly message: string;
  readonly hint?: string;
}

/** What a layer's row shows beside its name: one colour, or the colours of its ramp. */
export type LayerSwatch =
  | { readonly kind: 'colour'; readonly colour: string }
  | { readonly kind: 'ramp'; readonly colours: readonly string[] };

/** A layer in the legend. */
export interface LegendLayerEntry {
  readonly type: 'layer';
  readonly id: LayerId;
  readonly name: string;
  /** Whether the person has it on. A layer that is on can still be not drawn. */
  readonly visible: boolean;
  /** `false` if the engine says the dataset cannot be drawn in the map's coordinate system. */
  readonly drawn: boolean;
  /** Present exactly when the layer is not drawn. */
  readonly notice?: LayerNotice;
  readonly swatch: LayerSwatch;
  /** The lines under the layer: only for a layer that is coloured by classes, is drawn and has been classified. */
  readonly classes: readonly ClassEntry[];
}

/** Whether all, some or none of the layers of a group are on. A group with no layers has `none`. */
export type GroupVisibility = 'all' | 'some' | 'none';

/** A group in the legend, with its layers. */
export interface LegendGroupEntry {
  readonly type: 'group';
  readonly id: string;
  readonly name: string;
  readonly collapsed: boolean;
  readonly visibility: GroupVisibility;
  readonly layers: readonly LegendLayerEntry[];
}

/** An entry of the legend's top level. */
export type LegendEntry = LegendLayerEntry | LegendGroupEntry;

/** The legend. */
export interface LegendModel {
  /** Top to bottom, as in the document. */
  readonly entries: readonly LegendEntry[];
  /** How many layers there are, in groups or not. */
  readonly layerCount: number;
  /** `3 layers`, `1 layer`: the caption above the list. */
  readonly layerCountLabel: string;
}

const NOT_DRAWN_MESSAGE = 'This dataset cannot be drawn in the coordinate system of the map.';

/** The finding that says best why a dataset is not drawn: an error first, then a warning, then any. */
function mainFinding(findings: readonly Finding[]): Finding | undefined {
  return (
    findings.find((finding) => finding.severity === 'error') ??
    findings.find((finding) => finding.severity === 'warning') ??
    findings[0]
  );
}

function noticeFor(entry: DrawableEntry): LayerNotice {
  const finding = mainFinding(entry.findings);
  if (finding === undefined) {
    return { message: NOT_DRAWN_MESSAGE };
  }
  return finding.hint === undefined
    ? { message: finding.message }
    : { message: finding.message, hint: finding.hint };
}

function layerEntry(layer: Layer, inputs: LegendInputs): LegendLayerEntry {
  const drawable = inputs.drawable?.find((entry) => entry.id === layer.datasetId);
  const drawn = drawable?.status !== 'not_drawn';
  const breaks =
    inputs.breaks !== undefined && Object.hasOwn(inputs.breaks, layer.id)
      ? inputs.breaks[layer.id]
      : undefined;
  const colour = layer.style.colour;
  let swatch: LayerSwatch;
  let classes: readonly ClassEntry[] = [];
  if (colour.mode === 'single') {
    swatch = { kind: 'colour', colour: colour.value };
  } else if (breaks !== undefined) {
    swatch = { kind: 'ramp', colours: classColours(colour, breaks) };
    classes = drawn ? classEntries(colour, breaks) : [];
  } else {
    const ramp = rampById(colour.ramp);
    if (ramp === undefined) {
      throw new RangeError(`There is no ramp "${colour.ramp}".`);
    }
    swatch = { kind: 'ramp', colours: sampleRamp(ramp, colour.classes, colour.reverse) };
  }
  const entry = {
    type: 'layer' as const,
    id: layer.id,
    name: layer.name,
    visible: layer.visible,
    drawn,
    swatch,
    classes,
  };
  return drawable !== undefined && !drawn ? { ...entry, notice: noticeFor(drawable) } : entry;
}

function visibilityOf(layers: readonly LegendLayerEntry[]): GroupVisibility {
  const on = layers.filter((layer) => layer.visible).length;
  if (on === 0) {
    return 'none';
  }
  return on === layers.length ? 'all' : 'some';
}

/**
 * The legend of a scene. A layer is not drawn if `inputs.drawable` has an entry for its dataset that says so, and
 * then it has a notice (the engine's own words: an error first, then a warning, then anything) and no lines under
 * it; a dataset that is not mentioned is taken to be drawn. A layer coloured by classes has its lines when its breaks
 * are given, and until then shows the ramp it will be coloured with. A mistake of the document (a layer in the legend
 * that is not in the layers, which `validateScene` refuses) is left out.
 */
export function legendModel(doc: SceneDocument, inputs: LegendInputs = {}): LegendModel {
  const entryOf = (id: string): LegendLayerEntry | undefined => {
    const layer = Object.hasOwn(doc.layers, id) ? doc.layers[id] : undefined;
    return layer === undefined ? undefined : layerEntry(layer, inputs);
  };
  const entries: LegendEntry[] = [];
  let layerCount = 0;
  for (const node of doc.legend) {
    if (node.type === 'layer') {
      const entry = entryOf(node.id);
      if (entry !== undefined) {
        entries.push(entry);
        layerCount += 1;
      }
    } else {
      const layers = node.children.flatMap((id) => entryOf(id) ?? []);
      layerCount += layers.length;
      entries.push({
        type: 'group',
        id: node.id,
        name: node.name,
        collapsed: node.collapsed,
        visibility: visibilityOf(layers),
        layers,
      });
    }
  }
  return {
    entries,
    layerCount,
    layerCountLabel: `${String(layerCount)} ${layerCount === 1 ? 'layer' : 'layers'}`,
  };
}
