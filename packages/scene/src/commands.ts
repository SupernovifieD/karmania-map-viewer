/**
 * Every command as a value, and the one function that applies a command to a document. A store (`store.ts`) takes
 * these, so that an action of a person, a call of an embedder and a test are all the same thing: data that says what
 * to do. Each kind is the command function of the same name, with its arguments in the fields.
 */
import type { Frame } from '@karmania/engine/display';
import { setFrame, setSelection } from './commands-frame.js';
import {
  addLayers,
  removeLayersOfDataset,
  setGroupVisible,
  setVisible,
  type NewDataset,
} from './commands-layers.js';
import {
  createGroup,
  deleteGroup,
  moveNode,
  renameGroup,
  setGroupCollapsed,
  type LegendPlace,
} from './commands-legend.js';
import { setContours, setStyle, type StylePatch } from './commands-style.js';
import {
  setCamera,
  setVerticalExaggeration,
  setViewMode,
  type CameraPatch,
} from './commands-view.js';
import type {
  ContourParams,
  GroupId,
  LayerId,
  SceneDocument,
  SceneSelection,
  VerticalExaggeration,
  ViewMode,
} from './types.js';

/** What a person or a program asks the scene to do. */
export type Command =
  | { readonly type: 'addLayers'; readonly datasets: readonly NewDataset[] }
  | { readonly type: 'removeLayersOfDataset'; readonly datasetId: number }
  | { readonly type: 'setVisible'; readonly layerId: LayerId; readonly visible: boolean }
  | { readonly type: 'setGroupVisible'; readonly groupId: GroupId; readonly visible: boolean }
  | { readonly type: 'moveNode'; readonly id: string; readonly to: LegendPlace }
  | { readonly type: 'createGroup'; readonly name: string; readonly index?: number }
  | { readonly type: 'renameGroup'; readonly groupId: GroupId; readonly name: string }
  | { readonly type: 'deleteGroup'; readonly groupId: GroupId }
  | { readonly type: 'setGroupCollapsed'; readonly groupId: GroupId; readonly collapsed: boolean }
  | { readonly type: 'setStyle'; readonly layerId: LayerId; readonly patch: StylePatch }
  | {
      readonly type: 'setContours';
      readonly layerId: LayerId;
      readonly contours: (ContourParams & { readonly visible: boolean }) | null;
    }
  | { readonly type: 'setViewMode'; readonly mode: ViewMode }
  | { readonly type: 'setVerticalExaggeration'; readonly factor: VerticalExaggeration }
  | { readonly type: 'setCamera'; readonly patch: CameraPatch }
  | { readonly type: 'setFrame'; readonly frame: Frame | null }
  | { readonly type: 'setSelection'; readonly selection: SceneSelection | null };

/** The `type` of every command. */
export const COMMAND_TYPES = [
  'addLayers',
  'removeLayersOfDataset',
  'setVisible',
  'setGroupVisible',
  'moveNode',
  'createGroup',
  'renameGroup',
  'deleteGroup',
  'setGroupCollapsed',
  'setStyle',
  'setContours',
  'setViewMode',
  'setVerticalExaggeration',
  'setCamera',
  'setFrame',
  'setSelection',
] as const satisfies readonly Command['type'][];

/**
 * The document that `command` makes of `doc`: the very `doc` if the command changes nothing, and never a
 * document that `validateScene` would refuse.
 *
 * @throws TypeError for a command of a kind that there is not, which only a program that is not typed can pass.
 */
export function applyCommand(doc: SceneDocument, command: Command): SceneDocument {
  switch (command.type) {
    case 'addLayers':
      return addLayers(doc, command.datasets);
    case 'removeLayersOfDataset':
      return removeLayersOfDataset(doc, command.datasetId);
    case 'setVisible':
      return setVisible(doc, command.layerId, command.visible);
    case 'setGroupVisible':
      return setGroupVisible(doc, command.groupId, command.visible);
    case 'moveNode':
      return moveNode(doc, command.id, command.to);
    case 'createGroup':
      return createGroup(doc, command.name, command.index);
    case 'renameGroup':
      return renameGroup(doc, command.groupId, command.name);
    case 'deleteGroup':
      return deleteGroup(doc, command.groupId);
    case 'setGroupCollapsed':
      return setGroupCollapsed(doc, command.groupId, command.collapsed);
    case 'setStyle':
      return setStyle(doc, command.layerId, command.patch);
    case 'setContours':
      return setContours(doc, command.layerId, command.contours);
    case 'setViewMode':
      return setViewMode(doc, command.mode);
    case 'setVerticalExaggeration':
      return setVerticalExaggeration(doc, command.factor);
    case 'setCamera':
      return setCamera(doc, command.patch);
    case 'setFrame':
      return setFrame(doc, command.frame);
    case 'setSelection':
      return setSelection(doc, command.selection);
    default: {
      const unknown: { readonly type: unknown } = command;
      throw new TypeError(`There is no command of the kind ${JSON.stringify(unknown.type)}.`);
    }
  }
}
