import assert from 'node:assert/strict';
import test from 'node:test';
import { GameId } from '../src/constants/GameId.js';
import type { ClientConnection } from '../src/proxy/ClientConnection.js';
import type { BridgeDeps } from '../src/scripts/bridge/BridgeDeps.js';
import {
  getChestSlots,
  getVaultStore,
  installVaultStoreHooks,
  resolveChestSlot,
} from '../src/scripts/bridge/inventory/VaultStore.js';
import { depositToVault, withdrawFromVault } from '../src/scripts/bridge/inventory/vaultTransfer.js';
import { PlayerData } from '../src/state/PlayerData.js';

type PacketHandler = (client: ClientConnection, packet: {
  isDefined: boolean;
  data: Record<string, any>;
}) => void;

test('VaultStore maintains an authoritative snapshot for every account storage section', () => {
  const handlers = new Map<string, PacketHandler>();
  const deps = {
    proxy: {
      hookPacket(name: string, handler: PacketHandler): void {
        handlers.set(name, handler);
      },
    },
  } as unknown as BridgeDeps;
  installVaultStoreHooks(deps);

  const playerData = new PlayerData();
  playerData.ownerObjectId = 500;
  const client = {
    objectId: 500,
    state: { gameId: GameId.Vault },
    playerData,
  } as unknown as ClientConnection;

  emit(handlers, 'VAULTCONTENT', client, {
    lastVaultUpdate: true,
    vaultChestObjectId: 1001,
    materialChestObjectId: 1002,
    giftChestObjectId: 1003,
    potionStorageObjectId: 1004,
    seasonalSpoilChestObjectId: 1005,
    vaultContents: [101, -1],
    materialContents: [201, -1],
    giftContents: [301, -1],
    potionContents: [401, -1],
    seasonalSpoilContent: [501, -1],
    vaultUpgradeCost: 10,
    materialUpgradeCost: 20,
    seasonalSpoilUpgradeCost: 30,
    potionUpgradeCost: 40,
    currentPotionMax: 64,
    nextPotionMax: 80,
    vaultChestEnchants: 'vault-enchants',
    giftChestEnchants: 'gift-enchants',
    spoilsChestEnchants: 'spoils-enchants',
  });

  const baseline = getVaultStore(client);
  assert.ok(baseline);
  assert.equal(baseline.active, true);
  assert.equal(baseline.lastVaultUpdate, true);
  assert.deepEqual(
    [baseline.vault.objectId, baseline.material.objectId, baseline.gift.objectId,
      baseline.potion.objectId, baseline.seasonalSpoils.objectId],
    [1001, 1002, 1003, 1004, 1005],
  );
  assert.deepEqual(baseline.seasonalSpoils.contents, [501, -1]);
  assert.equal(baseline.seasonalSpoilUpgradeCost, 30);
  assert.deepEqual(playerData.vaultContent, [101, -1]);

  const baselineRevision = baseline.revision;
  emit(handlers, 'INVRESULT', client, {
    unknownBool: true,
    unknownByte: 0,
    fromSlot: { objectId: 1005, slotId: 0, objectType: -1 },
    toSlot: { objectId: 500, slotId: 4, objectType: 501 },
  });
  assert.equal(baseline.seasonalSpoils.contents[0], -1);
  assert.equal(playerData.inventory[4], 501);
  assert.equal(baseline.revision, baselineRevision + 1);

  const storageRevision = baseline.revision;
  emit(handlers, 'INVRESULT', client, {
    unknownBool: true,
    unknownByte: 0,
    fromSlot: { objectId: 500, slotId: 4, objectType: -1 },
    toSlot: { objectId: 500, slotId: 5, objectType: 501 },
  });
  assert.equal(playerData.inventory[4], -1);
  assert.equal(playerData.inventory[5], 501);
  assert.equal(baseline.revision, storageRevision, 'player-only swaps do not revise storage');

  emit(handlers, 'INVRESULT', client, {
    unknownBool: true,
    unknownByte: 1,
    fromSlot: { objectId: 1003, slotId: 0, objectType: 301 },
    toSlot: { objectId: 0, slotId: 0, objectType: 0 },
  });
  assert.equal(baseline.gift.contents[0], 301, 'USEITEM acknowledgements are not consumption proof');
  assert.equal(baseline.revision, storageRevision);

  emit(handlers, 'UPDATE', client, {
    newObjs: [{ status: {
      objectId: 1003,
      data: [{ id: 8, value: 302 }, { id: 80, value: 'gift-enchants-live' }],
    } }],
  });
  assert.equal(baseline.gift.contents[0], 302);
  assert.equal(baseline.giftChestEnchants, 'gift-enchants-live');
  assert.equal(baseline.revision, storageRevision + 1);

  emit(handlers, 'UPDATE', client, {
    newObjs: [{ status: {
      objectId: 1003,
      data: [{ id: 8, value: 302 }, { id: 80, value: 'gift-enchants-live' }],
    } }],
  });
  assert.equal(baseline.revision, storageRevision + 1, 'unchanged tick data does not churn revisions');

  emit(handlers, 'NEWTICK', client, {
    statuses: [{ objectId: 1004, data: [{ id: 8, value: -1 }] }],
  });
  assert.equal(baseline.potion.contents[0], -1);

  const contentsBeforeExit = baseline.gift.contents.slice();
  emit(handlers, 'MAPINFO', client, {});
  assert.equal(baseline.active, false);
  assert.deepEqual(baseline.gift.contents, contentsBeforeExit);
  assert.deepEqual(
    [baseline.vault.objectId, baseline.material.objectId, baseline.gift.objectId,
      baseline.potion.objectId, baseline.seasonalSpoils.objectId],
    [-1, -1, -1, -1, -1],
  );
  assert.equal(playerData.vaultChestObjectId, -1);

  emit(handlers, 'VAULTCONTENT', client, {
    lastVaultUpdate: false,
    vaultChestObjectId: 1101,
    vaultContents: [601, -1],
    vaultChestEnchants: 'vault-chunk-one',
  });
  const chunked = getVaultStore(client);
  assert.ok(chunked);
  assert.equal(chunked.lastVaultUpdate, false);
  assert.deepEqual(chunked.vault.contents, [601, -1]);
  let sentSwap: { data: Record<string, any> } | undefined;
  Object.assign((deps as any).proxy, {
    packetFactory: { createByName: () => ({ data: {} }) },
  });
  (deps as any).clientRef = { current: client };
  Object.assign(client as any, {
    connected: true,
    time: 123,
    sendToServer: (packet: { data: Record<string, any> }) => { sentSwap = packet; },
  });
  assert.equal(withdrawFromVault(deps, 0, 'container'), false, 'transfers wait for the final baseline packet');
  assert.equal(sentSwap, undefined);

  emit(handlers, 'VAULTCONTENT', client, {
    lastVaultUpdate: true,
    vaultChestObjectId: 1102,
    vaultContents: [602, -1],
    vaultChestEnchants: 'vault-chunk-two',
  });
  assert.equal(getVaultStore(client), chunked, 'packet chunks update one in-progress baseline');
  assert.equal(chunked.lastVaultUpdate, true);
  assert.deepEqual(chunked.vault.contents, [601, -1, 602, -1]);
  assert.deepEqual(
    getChestSlots(chunked.vault).map((slot) => [slot.logicalSlotId, slot.objectId, slot.slotId, slot.objectType]),
    [
      [0, 1101, 0, 601],
      [1, 1101, 1, -1],
      [2, 1102, 0, 602],
      [3, 1102, 1, -1],
    ],
  );
  assert.deepEqual(resolveChestSlot(chunked.vault, 2), {
    logicalSlotId: 2,
    objectId: 1102,
    slotId: 0,
    objectType: 602,
  });

  assert.equal(withdrawFromVault(deps, 2, 'container'), true);
  assert.deepEqual(sentSwap?.data.slotObject1, { objectId: 1102, slotId: 0, objectType: 602 });
  assert.equal(depositToVault(deps, 3, 'container'), true);
  assert.deepEqual(sentSwap?.data.slotObject2, { objectId: 1102, slotId: 1, objectType: -1 });

  const chunkRevision = chunked.revision;
  emit(handlers, 'INVRESULT', client, {
    unknownBool: true,
    unknownByte: 0,
    fromSlot: { objectId: 1102, slotId: 0, objectType: -1 },
    toSlot: { objectId: 500, slotId: 6, objectType: 602 },
  });
  assert.deepEqual(chunked.vault.contents, [601, -1, -1, -1]);
  assert.equal(chunked.revision, chunkRevision + 1);
});

function emit(
  handlers: Map<string, PacketHandler>,
  name: string,
  client: ClientConnection,
  data: Record<string, any>,
): void {
  const handler = handlers.get(name);
  assert.ok(handler, `${name} hook installed`);
  handler(client, { isDefined: true, data });
}
