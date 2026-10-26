# karmania-map-viewer

Karmania is an open-source engine for geoscience map data, in the spirit of the Monaco editor: a reusable core that other software can embed. It takes data in six standard shapes (points, lines, polygons, meshes, regular grids and block models), validates it, does a small amount of deterministic processing, renders 2D and 3D maps with map furniture, and exports PNG images. It never invents values: every number it shows is either one it was given or a deterministic restatement of one. Phase 1 (data entry and validation) is in progress; nothing is drawn yet.

## Building

Rust (stable, pinned in `rust-toolchain.toml`) and Node (pinned in `.nvmrc`) with pnpm are needed. The WebAssembly module is built with [wasm-pack](https://github.com/drager/wasm-pack) (`cargo install wasm-pack`):

```
pnpm install
pnpm build:wasm   # writes crates/karmania-wasm/pkg, which is not committed
pnpm check        # formatting, lints and every test
```
