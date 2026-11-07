/**
 * The layers that are on the card, by the id the scene gives them: a layer is made for the buffers of a dataset, replaced when
 * its buffers come again, taken away (and its card memory freed) when it is removed. The container it adds them to is any
 * object that has `add` and `remove` (three's scene is one), so that this is tested without a graphics card.
 */
import type { RenderBuffers } from '@karmania/engine/display';
import type { Object3D } from 'three';
import type { FrameInfo, LayerLook } from './look.js';

/**
 * A layer on the card: the object to draw, and how to free what it holds (geometries, textures, materials). A layer too big to be
 * put on the card in one go (a million points) is built a part at a time: `step` does the next part, between two frames, and says
 * whether any is left. The size of a part is a number of elements and never a time, so that the same data is built the same way
 * on every machine.
 */
export interface LayerObject {
  readonly object: Object3D;
  dispose(): void;
  step?(): boolean;
  /** Changes how the layer looks (its colour, size, opacity, whether it is shown) without building it again. */
  setLook(look: LayerLook): void;
  /** Called before each frame with what is true of the screen and the theme then. */
  prepareFrame(info: FrameInfo): void;
}

/** Makes the layer of some buffers, looking as `look` says, or `undefined` if buffers of that kind are not drawn (yet). */
export type LayerMaker = (buffers: RenderBuffers, look: LayerLook) => LayerObject | undefined;

/** What the layers are put in. */
export interface Container {
  add(object: Object3D): unknown;
  remove(object: Object3D): unknown;
}

/** What `set` came to: the layer is drawn, or buffers of that kind are not drawn and there is no layer. */
export type LayerOutcome = 'drawn' | 'unsupported';

export class LayerSet {
  private readonly layers = new Map<string, LayerObject>();
  /** The layers that have parts left to build (one that is removed is dropped from here at the next step). */
  private readonly building = new Set<string>();

  constructor(
    private readonly container: Container,
    private readonly make: LayerMaker,
  ) {}

  /**
   * Puts the layer of `buffers` under `id`, looking as `look` says, in place of the one that was there (which is freed). If the buffers are of a
   * kind that is not drawn the old layer is gone all the same and there is none.
   */
  set(id: string, buffers: RenderBuffers, look: LayerLook): LayerOutcome {
    this.remove(id);
    const layer = this.make(buffers, look);
    if (layer === undefined) {
      return 'unsupported';
    }
    this.layers.set(id, layer);
    if (layer.step !== undefined) {
      this.building.add(id);
    }
    this.container.add(layer.object);
    return 'drawn';
  }

  /** Takes the layer away and frees what it held. `false` if there was none. */
  remove(id: string): boolean {
    const layer = this.layers.get(id);
    if (layer === undefined) {
      return false;
    }
    this.layers.delete(id);
    this.container.remove(layer.object);
    layer.dispose();
    return true;
  }

  /** Changes how a layer looks. `false` if there is no such layer. */
  setLook(id: string, look: LayerLook): boolean {
    const layer = this.layers.get(id);
    layer?.setLook(look);
    return layer !== undefined;
  }

  /** Tells every layer what is true of the screen and the theme for the frame that is about to be drawn. */
  prepareFrame(info: FrameInfo): void {
    for (const layer of this.layers.values()) {
      layer.prepareFrame(info);
    }
  }

  has(id: string): boolean {
    return this.layers.has(id);
  }

  /** The ids of the layers, in the order they were put. */
  ids(): string[] {
    return [...this.layers.keys()];
  }

  get size(): number {
    return this.layers.size;
  }

  /** Does the next part of every layer that is still being built, and says whether any is left to do. */
  step(): boolean {
    for (const id of [...this.building]) {
      if (this.layers.get(id)?.step?.() !== true) {
        this.building.delete(id);
      }
    }
    return this.building.size > 0;
  }

  /** Takes every layer away and frees it. */
  clear(): void {
    for (const id of this.ids()) {
      this.remove(id);
    }
  }
}
