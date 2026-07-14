import type { ClientConnection } from '../../../proxy/ClientConnection.js';
import type { BridgeDeps } from '../BridgeDeps.js';
import { GameId } from '../../../constants/GameId.js';
import { StatType } from '../../../constants/StatType.js';
import { Logger } from '../../../util/Logger.js';

/** Stable RotMG objectType for the main vault chest. */
export const VAULT_CHEST_OBJECT_TYPE = 1284;

/** One physical container represented by a VAULTCONTENT packet chunk. */
export interface ChestChunk {
  objectId: number;
  /** Item type ids in this object's wire-local slot order. */
  contents: number[];
  /** Raw enchantment metadata for this physical container, when published. */
  enchantments: string;
}

/** One logical storage section, flattened across its physical containers. */
export interface ChestDb {
  /** First physical container id, retained for compatibility. */
  objectId: number;
  /** Item type ids per slot; -1 = empty. */
  contents: number[];
  chunks: ChestChunk[];
}

export interface ChestSlotLocation {
  /** Index in the flattened logical storage section. */
  logicalSlotId: number;
  /** Map-scoped physical container id used by INVSWAP. */
  objectId: number;
  /** Slot index local to the physical container, used by INVSWAP. */
  slotId: number;
  objectType: number;
}

/** Full account-storage snapshot, updated from authoritative server packets. */
export interface VaultContentState {
  /** Time of the latest VAULTCONTENT baseline. */
  capturedAt: number;
  /** Time of the latest baseline or live slot patch. */
  updatedAt: number;
  /** Monotonic version for consumers that cache derived views. */
  revision: number;
  /** True only after VAULTCONTENT on the current map. */
  active: boolean;
  /** Whether the server marked the baseline as its final vault packet. */
  lastVaultUpdate: boolean;
  vault: ChestDb;
  material: ChestDb;
  gift: ChestDb;
  potion: ChestDb;
  seasonalSpoils: ChestDb;
  vaultUpgradeCost: number;
  materialUpgradeCost: number;
  seasonalSpoilUpgradeCost: number;
  potionUpgradeCost: number;
  currentPotionMax: number;
  nextPotionMax: number;
  vaultChestEnchants: string;
  giftChestEnchants: string;
  spoilsChestEnchants: string;
}

const stores = new WeakMap<ClientConnection, VaultContentState>();
let hooksInstalled = false;

function toIntArr(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((value) => {
    const parsed = Math.trunc(Number(value));
    return Number.isFinite(parsed) ? parsed : -1;
  });
}

function toInt(raw: unknown, fallback = 0): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

/** Last known snapshot for this client, including inactive map snapshots. */
export function getVaultStore(client: ClientConnection): VaultContentState | null {
  return stores.get(client) ?? null;
}

export function getVaultStoreChests(state: VaultContentState): ChestDb[] {
  return [state.vault, state.material, state.gift, state.potion, state.seasonalSpoils];
}

/** Every flattened slot with the physical wire address needed for a swap. */
export function getChestSlots(chest: ChestDb): ChestSlotLocation[] {
  let logicalSlotId = 0;
  return chest.chunks.flatMap((chunk) => chunk.contents.map((objectType, slotId) => ({
    logicalSlotId: logicalSlotId++,
    objectId: chunk.objectId,
    slotId,
    objectType,
  })));
}

export function resolveChestSlot(chest: ChestDb, logicalSlotId: number): ChestSlotLocation | null {
  if (!Number.isInteger(logicalSlotId) || logicalSlotId < 0) return null;
  return getChestSlots(chest).find((slot) => slot.logicalSlotId === logicalSlotId) ?? null;
}

function markChanged(state: VaultContentState): void {
  state.updatedAt = Date.now();
  state.revision += 1;
}

function emptyChest(): ChestDb {
  return { objectId: -1, contents: [], chunks: [] };
}

function rebuildChest(chest: ChestDb): void {
  chest.objectId = chest.chunks.find((chunk) => chunk.objectId > 0)?.objectId ?? -1;
  chest.contents = chest.chunks.flatMap((chunk) => chunk.contents);
}

function addChestChunk(
  chest: ChestDb,
  objectId: number,
  contents: number[],
  enchantments = '',
): void {
  if (objectId <= 0 && contents.length === 0 && !enchantments) return;
  const existing = objectId > 0
    ? chest.chunks.findIndex((chunk) => chunk.objectId === objectId)
    : -1;
  const chunk = { objectId, contents, enchantments };
  if (existing >= 0) chest.chunks[existing] = chunk;
  else chest.chunks.push(chunk);
  rebuildChest(chest);
}

function patchChestChunk(chunk: ChestChunk, slotId: number, objectType: number): boolean {
  if (slotId < 0) return false;
  const value = objectType < 0 ? -1 : Math.trunc(objectType);
  if (slotId < chunk.contents.length && chunk.contents[slotId] === value) return false;
  while (chunk.contents.length <= slotId) chunk.contents.push(-1);
  chunk.contents[slotId] = value;
  return true;
}

function patchStorageSlot(
  state: VaultContentState,
  objectId: number,
  slotId: number,
  objectType: number,
): boolean {
  if (objectId <= 0 || slotId < 0) return false;
  for (const chest of getVaultStoreChests(state)) {
    const chunk = chest.chunks.find((candidate) => candidate.objectId === objectId);
    if (!chunk) continue;
    const changed = patchChestChunk(chunk, slotId, objectType);
    if (changed) rebuildChest(chest);
    return changed;
  }
  return false;
}

function patchPlayerSlot(
  client: ClientConnection,
  objectId: number,
  slotId: number,
  objectType: number,
): boolean {
  const playerObjectId = client.playerData.ownerObjectId || client.objectId;
  if (objectId !== playerObjectId || slotId < 0 || slotId >= 28) return false;
  const value = objectType < 0 ? -1 : Math.trunc(objectType);
  const target = slotId < 12 ? client.playerData.inventory : client.playerData.backpack;
  const index = slotId < 12 ? slotId : slotId - 12;
  if (target[index] === value) return false;
  target[index] = value;
  return true;
}

function syncLegacyVaultState(client: ClientConnection, state: VaultContentState): void {
  client.playerData.vaultChestObjectId = state.vault.objectId;
  client.playerData.vaultContent = state.vault.contents.slice();
}

function syncSectionEnchantments(state: VaultContentState, chest: ChestDb): void {
  const first = chest.chunks.find((chunk) => chunk.enchantments)?.enchantments ?? '';
  if (chest === state.vault) state.vaultChestEnchants = first;
  else if (chest === state.gift) state.giftChestEnchants = first;
  else if (chest === state.seasonalSpoils) state.spoilsChestEnchants = first;
}

function patchStorageStatus(state: VaultContentState, status: unknown): boolean {
  if (!status || typeof status !== 'object') return false;
  const raw = status as { objectId?: unknown; data?: unknown };
  const objectId = toInt(raw.objectId, -1);
  const chest = getVaultStoreChests(state).find(
    (candidate) => candidate.chunks.some((chunk) => chunk.objectId === objectId),
  );
  const chunk = chest?.chunks.find((candidate) => candidate.objectId === objectId);
  if (!chest || !chunk || !Array.isArray(raw.data)) return false;

  let changed = false;
  for (const stat of raw.data as Array<{ id?: unknown; value?: unknown }>) {
    const statId = toInt(stat?.id, -1);
    if (statId === StatType.Enchantments) {
      const value = String(stat.value ?? '');
      if (chunk.enchantments !== value) {
        chunk.enchantments = value;
        syncSectionEnchantments(state, chest);
        changed = true;
      }
      continue;
    }
    if (statId < StatType.Inventory0 || statId > StatType.Inventory11) continue;
    const slotChanged = patchChestChunk(chunk, statId - StatType.Inventory0, toInt(stat.value, -1));
    if (slotChanged) rebuildChest(chest);
    changed = slotChanged || changed;
  }
  return changed;
}

function createVaultState(previous: VaultContentState | undefined, now: number): VaultContentState {
  return {
    capturedAt: now,
    updatedAt: now,
    revision: (previous?.revision ?? 0) + 1,
    active: true,
    lastVaultUpdate: false,
    vault: emptyChest(),
    material: emptyChest(),
    gift: emptyChest(),
    potion: emptyChest(),
    seasonalSpoils: emptyChest(),
    vaultUpgradeCost: 0,
    materialUpgradeCost: 0,
    seasonalSpoilUpgradeCost: 0,
    potionUpgradeCost: 0,
    currentPotionMax: 0,
    nextPotionMax: 0,
    vaultChestEnchants: '',
    giftChestEnchants: '',
    spoilsChestEnchants: '',
  };
}

export function installVaultStoreHooks(deps: BridgeDeps): void {
  if (hooksInstalled) return;
  hooksInstalled = true;

  // Full baseline sent on vault entry and whenever the server refreshes storage.
  deps.proxy.hookPacket('VAULTCONTENT', (client, packet) => {
    if (!packet.isDefined || !packet.data) return;
    const data = packet.data as Record<string, unknown>;
    const now = Date.now();
    const previous = stores.get(client);
    const startsBaseline = !previous?.active || previous.lastVaultUpdate;
    const state = startsBaseline ? createVaultState(previous, now) : previous!;
    if (!startsBaseline) markChanged(state);

    addChestChunk(
      state.vault,
      toInt(data.vaultChestObjectId, -1),
      toIntArr(data.vaultContents),
      String(data.vaultChestEnchants ?? ''),
    );
    addChestChunk(
      state.material,
      toInt(data.materialChestObjectId, -1),
      toIntArr(data.materialContents),
    );
    addChestChunk(
      state.gift,
      toInt(data.giftChestObjectId, -1),
      toIntArr(data.giftContents),
      String(data.giftChestEnchants ?? ''),
    );
    addChestChunk(
      state.potion,
      toInt(data.potionStorageObjectId, -1),
      toIntArr(data.potionContents),
    );
    addChestChunk(
      state.seasonalSpoils,
      toInt(data.seasonalSpoilChestObjectId, -1),
      toIntArr(data.seasonalSpoilContent),
      String(data.spoilsChestEnchants ?? ''),
    );
    state.active = true;
    state.lastVaultUpdate = Boolean(data.lastVaultUpdate);
    state.vaultUpgradeCost = toInt(data.vaultUpgradeCost, state.vaultUpgradeCost);
    state.materialUpgradeCost = toInt(data.materialUpgradeCost, state.materialUpgradeCost);
    state.seasonalSpoilUpgradeCost = toInt(data.seasonalSpoilUpgradeCost, state.seasonalSpoilUpgradeCost);
    state.potionUpgradeCost = toInt(data.potionUpgradeCost, state.potionUpgradeCost);
    state.currentPotionMax = toInt(data.currentPotionMax, state.currentPotionMax);
    state.nextPotionMax = toInt(data.nextPotionMax, state.nextPotionMax);
    syncSectionEnchantments(state, state.vault);
    syncSectionEnchantments(state, state.gift);
    syncSectionEnchantments(state, state.seasonalSpoils);

    syncLegacyVaultState(client, state);
    stores.set(client, state);
    Logger.log(
      'VaultStore',
      `VAULTCONTENT: vault=${state.vault.contents.length} gift=${state.gift.contents.length} ` +
      `potion=${state.potion.contents.length} material=${state.material.contents.length} ` +
      `spoils=${state.seasonalSpoils.contents.length}`,
    );
  });

  // A successful swap acknowledgement carries post-swap values for both slots.
  // ack type 1 is USEITEM and its null destination does not prove consumption.
  deps.proxy.hookPacket('INVRESULT', (client, packet) => {
    if (!packet.isDefined || !packet.data) return;
    if ((client.state?.gameId ?? -999) !== GameId.Vault) return;
    const state = stores.get(client);
    if (!state?.active) return;
    if (!Boolean(packet.data.unknownBool) || toInt(packet.data.unknownByte, -1) !== 0) return;

    const from = packet.data.fromSlot as { objectId?: unknown; slotId?: unknown; objectType?: unknown } | undefined;
    const to = packet.data.toSlot as { objectId?: unknown; slotId?: unknown; objectType?: unknown } | undefined;
    if (!from || !to) return;

    const fromObjectId = toInt(from.objectId, -1);
    const fromSlotId = toInt(from.slotId, -1);
    const fromType = toInt(from.objectType, -1);
    const toObjectId = toInt(to.objectId, -1);
    const toSlotId = toInt(to.slotId, -1);
    const toType = toInt(to.objectType, -1);
    const storageChanged = [
      patchStorageSlot(state, fromObjectId, fromSlotId, fromType),
      patchStorageSlot(state, toObjectId, toSlotId, toType),
    ].some(Boolean);
    patchPlayerSlot(client, fromObjectId, fromSlotId, fromType);
    patchPlayerSlot(client, toObjectId, toSlotId, toType);
    if (storageChanged) {
      syncLegacyVaultState(client, state);
      markChanged(state);
    }
  });

  // Container status deltas cover direct item consumption and server-side edits.
  deps.proxy.hookPacket('UPDATE', (client, packet) => {
    if (!packet.isDefined || !Array.isArray(packet.data.newObjs)) return;
    const state = stores.get(client);
    if (!state?.active) return;
    let changed = false;
    for (const entity of packet.data.newObjs as Array<{ status?: unknown }>) {
      changed = patchStorageStatus(state, entity.status) || changed;
    }
    if (changed) {
      syncLegacyVaultState(client, state);
      markChanged(state);
    }
  });

  deps.proxy.hookPacket('NEWTICK', (client, packet) => {
    if (!packet.isDefined || !Array.isArray(packet.data.statuses)) return;
    const state = stores.get(client);
    if (!state?.active) return;
    let changed = false;
    for (const status of packet.data.statuses) {
      changed = patchStorageStatus(state, status) || changed;
    }
    if (changed) {
      syncLegacyVaultState(client, state);
      markChanged(state);
    }
  });

  // Preserve last-known contents, but invalidate map-scoped ids until the next baseline.
  deps.proxy.hookPacket('MAPINFO', (client) => {
    const state = stores.get(client);
    if (!state) return;
    state.active = false;
    for (const chest of getVaultStoreChests(state)) {
      for (const chunk of chest.chunks) chunk.objectId = -1;
      rebuildChest(chest);
    }
    markChanged(state);
    client.playerData.vaultChestObjectId = -1;
  });
}
