# ProdMafia dodge and pathfinding reference

This directory is a byte-for-byte snapshot of the ProdMafia source used to
build the `ProdMafiaDodge` comparison branch. The snapshot was copied from:

`C:\Users\trump\Downloads\ProdMafia-master\prodmafia`

All 16 copied ActionScript files were SHA-256 compared with their source after
copying and matched.

The canonical dodge implementation is:

- `objects/AutoDodgeController.as`
- `objects/autododge/*.as`
- the dodge collision hooks in `objects/Player.as` and `map/Map.as`

The canonical auto-play pathfinding implementation is embedded in:

- `game/GameSprite.as`

The active Node/TypeScript comparison adapters are:

- `src/prodmafia-auto-dodge.ts`
- `src/prodmafia-pathfinder.ts`

Those adapters preserve the Headless client interfaces while translating the
ProdMafia candidate-selection and bounded-BFS algorithms. Flash-only scene
graph and game-object dependencies remain represented in this untouched
ActionScript snapshot, which is the source of truth for line-by-line
comparison.
