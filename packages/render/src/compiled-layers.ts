/**
 * Which layers have their shader programs compiled. A layer that has not is not drawn yet: its programs are compiled meanwhile, off the
 * thread of the page, and a frame is asked for when they are. This is only what is known, and the renderer does the compiling.
 *
 * A layer that is put in place of another of the same kind keeps its mark, since three keeps the programs it has linked and the new layer
 * finds them there (a layer that was marked again would be missing for the frame or two that it takes). One of another kind has other
 * programs, and a context that the card gave back has none.
 */
export class CompiledLayers {
  private readonly compiled = new Set<string>();
  /** The layers whose programs are being compiled, and what for: a layer that is replaced meanwhile is compiled again for the new one. */
  private readonly compiling = new Map<string, object>();
  private readonly kinds = new Map<string, string>();

  /** Whether the programs of the layer are compiled. */
  has(id: string): boolean {
    return this.compiled.has(id);
  }

  /** The layer was drawn, so its programs are linked, whether they were compiled ahead or not. */
  add(id: string): void {
    this.compiled.add(id);
  }

  /** A layer of `kind` is now under `id`: in place of one of the same kind, whose mark it keeps, or of another, or of none. */
  put(id: string, kind: string): void {
    if (this.kinds.get(id) !== kind) {
      this.compiled.delete(id);
      this.compiling.delete(id);
    }
    this.kinds.set(id, kind);
  }

  /** The layer is gone. */
  remove(id: string): void {
    this.compiled.delete(id);
    this.compiling.delete(id);
    this.kinds.delete(id);
  }

  /** Whether to start compiling `scene`, the one of the layer now: not if it is being compiled already. */
  start(id: string, scene: object): boolean {
    if (this.compiling.get(id) === scene) {
      return false;
    }
    this.compiling.set(id, scene);
    return true;
  }

  /**
   * Says that the compiling of `scene` has ended. `current` is whether it is still the scene of the layer. `true` if the layer is compiled now,
   * which is when a frame is to be asked for; an end that is not of the compiling that was started last (the layer was replaced or removed, or the
   * context was lost, meanwhile) says nothing.
   */
  finish(id: string, scene: object, current: boolean): boolean {
    if (this.compiling.get(id) !== scene) {
      return false;
    }
    this.compiling.delete(id);
    if (!current) {
      return false;
    }
    this.compiled.add(id);
    return true;
  }

  /** Nothing is compiled any more (the card gave the context back, and its programs are gone), and what was being compiled is let go. */
  reset(): void {
    this.compiled.clear();
    this.compiling.clear();
  }
}
