import { Position } from './Position';

export interface MapTile {
    type: number;
    name: string;
    position: Position;
    /** NoWalk, Sink, or space tile per tiles.xml (impassable / hazardous). */
    isBlocking: boolean;
    /** True if a world entity currently occupies this tile cell. */
    isOccupied: boolean;
    /** True when known ground is walkable, non-damaging, and has no condition effect. */
    isSafe: boolean;
    /** `<Speed>` multiplier from tiles.xml; `1` if default. */
    speedMultiplier: number;
    /** True when this tile deals HP damage per tick (`MinDamage` / `MaxDamage` in tiles.xml). */
    damaging: boolean;
    /** Damage per tick when damaging, otherwise `0`. */
    damagePerTick: number;
    /** True when tiles.xml defines `<ConditionEffect>` on this ground type. */
    hasConditionEffect: boolean;
}
