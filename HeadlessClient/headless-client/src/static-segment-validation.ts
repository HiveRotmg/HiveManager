/**
 * Commit 5.3 — Shared supercover segment validation (no corner-cutting).
 *
 * Used by route smoothing (ExplorativePathfinder.traceSegment) and dodge static
 * swept checks (DodgeTrajectoryPlanner.staticSegmentOpen static portion).
 */

import type {
  StaticOccupancyQuery,
  StaticPassabilityModel,
  StaticTileQuery,
} from './static-passability-model';

export interface StaticSegmentPoint {
  x: number;
  y: number;
}

export interface StaticSegmentTile {
  x: number;
  y: number;
}

export interface StaticSegmentTrace {
  /** Tiles whose centers lie on the segment supercover (inclusive endpoints). */
  travelTiles: StaticSegmentTile[];
  /** travelTiles plus diagonal corner-adjacent tiles at exact corner crossings. */
  corridorTiles: StaticSegmentTile[];
}

/** Whether an integer tile blocks segment traversal. Receives segment endpoints for sub-tile sampling. */
export type StaticSegmentTileBlocked = (
  tileX: number,
  tileY: number,
  from: StaticSegmentPoint,
  to: StaticSegmentPoint,
) => boolean;

/** Representative point where a segment crosses an integer tile. */
export function segmentMidpointInTile(
  from: StaticSegmentPoint,
  to: StaticSegmentPoint,
  tileX: number,
  tileY: number,
): StaticSegmentPoint {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const tValues: number[] = [0, 1];
  const addBoundary = (t: number) => {
    if (t >= 0 && t <= 1) tValues.push(t);
  };
  if (Math.abs(dx) > 1e-12) {
    addBoundary((tileX - from.x) / dx);
    addBoundary((tileX + 1 - from.x) / dx);
  }
  if (Math.abs(dy) > 1e-12) {
    addBoundary((tileY - from.y) / dy);
    addBoundary((tileY + 1 - from.y) / dy);
  }
  const tMin = Math.min(...tValues);
  const tMax = Math.max(...tValues);
  const t = (tMin + tMax) * 0.5;
  return { x: from.x + dx * t, y: from.y + dy * t };
}

/**
 * Occupancy sample for supercover tile checks. Uses the segment midpoint when
 * the segment crosses the tile; otherwise falls back to tile center so corridor
 * side tiles at diagonal corners are evaluated correctly.
 */
export function segmentOccupancySampleInTile(
  from: StaticSegmentPoint,
  to: StaticSegmentPoint,
  tileX: number,
  tileY: number,
): StaticSegmentPoint {
  const sample = segmentMidpointInTile(from, to, tileX, tileY);
  if (Math.floor(sample.x) !== tileX || Math.floor(sample.y) !== tileY) {
    return { x: tileX + 0.5, y: tileY + 0.5 };
  }
  return sample;
}

/**
 * Supercover walk from `from` to `to` with no corner-cutting.
 * Returns undefined when the segment is blocked or invalid.
 */
export function traceStaticSegmentSupercover(
  from: StaticSegmentPoint,
  to: StaticSegmentPoint,
  isTileBlocked: StaticSegmentTileBlocked,
): StaticSegmentTrace | undefined {
  const blocked = (tileX: number, tileY: number): boolean =>
    isTileBlocked(tileX, tileY, from, to);

  let cellX = Math.floor(from.x);
  let cellY = Math.floor(from.y);
  const endX = Math.floor(to.x);
  const endY = Math.floor(to.y);
  if (blocked(cellX, cellY)) return undefined;

  const travelTiles: StaticSegmentTile[] = [{ x: cellX, y: cellY }];
  const corridorTiles: StaticSegmentTile[] = [{ x: cellX, y: cellY }];
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const stepX = Math.sign(dx);
  const stepY = Math.sign(dy);
  const tDeltaX = stepX === 0 ? Infinity : Math.abs(1 / dx);
  const tDeltaY = stepY === 0 ? Infinity : Math.abs(1 / dy);
  let tMaxX = stepX > 0
    ? (cellX + 1 - from.x) / dx
    : stepX < 0 ? (from.x - cellX) / -dx : Infinity;
  let tMaxY = stepY > 0
    ? (cellY + 1 - from.y) / dy
    : stepY < 0 ? (from.y - cellY) / -dy : Infinity;

  while (cellX !== endX || cellY !== endY) {
    if (Math.abs(tMaxX - tMaxY) <= 1e-10) {
      const sideX = { x: cellX + stepX, y: cellY };
      const sideY = { x: cellX, y: cellY + stepY };
      if (blocked(sideX.x, sideX.y) || blocked(sideY.x, sideY.y)) {
        return undefined;
      }
      corridorTiles.push(sideX, sideY);
      cellX += stepX;
      cellY += stepY;
      tMaxX += tDeltaX;
      tMaxY += tDeltaY;
    } else if (tMaxX < tMaxY) {
      cellX += stepX;
      tMaxX += tDeltaX;
    } else {
      cellY += stepY;
      tMaxY += tDeltaY;
    }

    if (blocked(cellX, cellY)) return undefined;
    const point = { x: cellX, y: cellY };
    travelTiles.push(point);
    corridorTiles.push(point);
  }

  return { travelTiles, corridorTiles };
}

export function isStaticSegmentSupercoverOpen(
  from: StaticSegmentPoint,
  to: StaticSegmentPoint,
  isTileBlocked: StaticSegmentTileBlocked,
): boolean {
  return traceStaticSegmentSupercover(from, to, isTileBlocked) !== undefined;
}

/** Integer-tile blocked predicate backed by StaticPassabilityModel.isTileStaticallyBlocked. */
export function staticPassabilityTileBlocked(
  passability: StaticPassabilityModel,
  query: StaticTileQuery,
): StaticSegmentTileBlocked {
  return (tileX, tileY) => passability.isTileStaticallyBlocked(tileX, tileY, query);
}

/** Tile-blocked predicate using canOccupyAt at the segment sample within each tile. */
export function staticPassabilityOccupancyBlocked(
  passability: StaticPassabilityModel,
  query: StaticOccupancyQuery,
): StaticSegmentTileBlocked {
  return (tileX, tileY, from, to) => {
    const sample = segmentOccupancySampleInTile(from, to, tileX, tileY);
    return !passability.canOccupyAt(sample.x, sample.y, query);
  };
}
