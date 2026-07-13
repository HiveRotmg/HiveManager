import { GameObject } from './GameObject';
import type { LootItem, LootRarity } from '../loot';

/**
 * A world container instance — anything the game classifies as a `Container`
 * (loot bags of every rarity, vault chests, gift chests, and other
 * pickup-able stashes).
 *
 * Returned by `Objects.getContainers()`, `Objects.getNearestContainer()`,
 * and `Objects.findContainer(name)`.
 */
export interface Container extends GameObject {
    /** True only for dropped loot objects (`<Loot />` in game data). */
    isLoot: boolean;
    /** Current non-empty slots known for this world container. */
    items: LootItem[];
    /**
     * Lowercase bag rarity token when the game-data loader can infer one
     * from the object id (e.g. `'white'`, `'cyan'`, `'purple'`, `'orange'`,
     * `'pink'`, `'brown'`). Undefined for non-bag containers (chests, etc.).
     */
    rarity?: LootRarity;
    ownerName?: string;
    /** Account id supplied by OWNER_ACCOUNT_ID_STAT when present. */
    ownerAccountId?: string;
}
