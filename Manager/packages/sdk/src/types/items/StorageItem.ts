import type { Item } from './Item';
import type { InventoryStorageContainer } from '../../inventory';

/** Item metadata paired with its logical slot in an account storage container. */
export interface StorageItem extends Item {
  objectType: number;
  container: InventoryStorageContainer;
  slotIndex: number;
  /** Eight-slot chest index for flattened storage views such as the main vault. */
  chestIndex: number;
}
