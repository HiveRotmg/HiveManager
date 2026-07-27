import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  AoeAckPacket,
  AoePacket,
  EnemyShootPacket,
  Packet,
  PlayerData,
  PlayerHitPacket,
} from 'realmlib';
import { Client } from '../src/client';
import {
  CombatTracker,
  type CombatProjectileDefinition,
} from '../src/combat-tracker';
import { ClientEvent } from '../src/events';
import {
  AUTO_SYNC_CLIENT_HP_DELTA,
  AUTO_SYNC_CLIENT_HP_TICKS,
  AutoSyncClientHpTracker,
  calculateIgnoreBitmasks,
  damageIsLethal,
  DEFAULT_IGNORE_DEBUFF_OPTIONS,
  playerHitSuppressionReason,
  projectileMatchesIgnoredDebuff,
  shouldSuppressStrategicHit,
} from '../src/hit-suppression';

test('calculateIgnoreBitmasks matches Options.calculateIgnoreBitmask defaults', () => {
  const defaults = calculateIgnoreBitmasks();
  // Client-sided defaults: Blind/Hallucinating/Drunk/Confused/Darkness on.
  assert.equal(defaults.ccdebuffBitmask, (256 | 512 | 1024 | 2048 | 0x80000000) >>> 0);
  assert.equal(defaults.ssdebuffBitmask, 0);
  assert.equal(defaults.ssdebuffBitmask2, 0);

  const allServer = calculateIgnoreBitmasks({
    ...DEFAULT_IGNORE_DEBUFF_OPTIONS,
    ignoreQuiet: true,
    ignoreWeak: true,
    ignoreSlowed: true,
    ignoreSick: true,
    ignoreDazed: true,
    ignoreStunned: true,
    ignoreParalyzed: true,
    ignoreBleeding: true,
    ignoreArmorBroken: true,
    ignorePetStasis: true,
    ignorePetrified: true,
    ignoreSilenced: true,
    ignoreBlind: false,
    ignoreHallucinating: false,
    ignoreDrunk: false,
    ignoreConfused: false,
    ignoreUnstable: false,
    ignoreDarkness: false,
  });
  assert.equal(allServer.ssdebuffBitmask, (4 | 8 | 16 | 32 | 64 | 128 | 16384 | 65536 | 134217728) >>> 0);
  assert.equal(allServer.ssdebuffBitmask2, (32 | 8 | 65536) >>> 0);
  assert.equal(allServer.ccdebuffBitmask, 0);
});

test('projectileMatchesIgnoredDebuff uses 1<<index layout for Quiet', () => {
  const masks = calculateIgnoreBitmasks({ ignoreQuiet: true });
  assert.equal(projectileMatchesIgnoredDebuff([2], masks), true);
  assert.equal(projectileMatchesIgnoredDebuff([3], masks), false);
  const petrified = calculateIgnoreBitmasks({ ignorePetrified: true });
  assert.equal(projectileMatchesIgnoredDebuff([35], petrified), true);
  assert.equal(projectileMatchesIgnoredDebuff([2], petrified), false);
});

test('damageIsLethal ignores unset zero figures', () => {
  assert.equal(damageIsLethal(50, { predictedHp: 100, serverHp: 0, syncedHp: 0 }), false);
  assert.equal(damageIsLethal(100, { predictedHp: 100, serverHp: 120, syncedHp: 110 }), true);
  assert.equal(damageIsLethal(1, { predictedHp: 0, serverHp: 0, syncedHp: 0 }), true);
});

test('shouldSuppressStrategicHit uses threshold percent of max HP', () => {
  // 10% of 1000 = 100
  assert.equal(shouldSuppressStrategicHit(99, 500, 1000, 10), false);
  assert.equal(shouldSuppressStrategicHit(100, 500, 1000, 10), true);
  assert.equal(shouldSuppressStrategicHit(50, 50, 1000, 10), true); // lethal
});

test('playerHitSuppressionReason priority is partial > buddha > strategic', () => {
  const base = {
    effectiveDamage: 200,
    partialGodMode: false,
    buddhaMode: true,
    strategicAckSuppression: true,
    autoDodgeActive: true,
    suppressThresholdPercent: 10,
    maxHp: 1000,
    predictedHp: 150,
    serverHp: 150,
    syncedHp: 150,
  };
  assert.equal(playerHitSuppressionReason({ ...base, partialGodMode: true }), 'partial_godmode');
  assert.equal(playerHitSuppressionReason(base), 'buddha');
  assert.equal(playerHitSuppressionReason({ ...base, buddhaMode: false }), 'strategic_ack');
  assert.equal(playerHitSuppressionReason({
    ...base,
    buddhaMode: false,
    effectiveDamage: 50,
  }), null);
  assert.equal(playerHitSuppressionReason({
    ...base,
    buddhaMode: false,
    autoDodgeActive: false,
  }), null);
});

test('AutoSyncClientHpTracker syncs after ticksOff > 3', () => {
  const tracker = new AutoSyncClientHpTracker();
  const predicted = 100;
  const server = predicted + AUTO_SYNC_CLIENT_HP_DELTA + 1;
  const results = [
    tracker.noteSample(predicted, server, true),
    tracker.noteSample(predicted, server, true),
    tracker.noteSample(predicted, server, true),
    tracker.noteSample(predicted, server, true),
    tracker.noteSample(predicted, server, true),
  ];
  assert.deepEqual(results, [false, false, false, false, true]);
  assert.equal(AUTO_SYNC_CLIENT_HP_TICKS, 3);
});

test('Buddha Mode drops only lethal projectile hits', () => {
  const { client, sent, damage, tracker } = projectileHarness();
  client.setBuddhaModeEnabled(true);
  const nexus = (client as unknown as {
    autoNexus: { reset(hp: number, maxHp: number): void };
  }).autoNexus;
  nexus.reset(100, 100);

  // Non-lethal 40 damage lands normally.
  fireEnemyShot(tracker, 40);
  tracker.update(600, worldAtPlayer());
  assert.equal(sent.some((packet) => packet instanceof PlayerHitPacket), true);
  assert.deepEqual(damage, [40]);
  assert.equal(client.getAutoNexusState().predictedHp, 60);

  sent.length = 0;
  damage.length = 0;
  // Lethal 60 damage is suppressed symmetrically.
  fireEnemyShot(tracker, 60, 8);
  tracker.update(700, worldAtPlayer());
  assert.equal(sent.some((packet) => packet instanceof PlayerHitPacket), false);
  assert.deepEqual(damage, []);
  assert.equal(client.getAutoNexusState().predictedHp, 60);
  assert.equal(client.getCombatProtectionState().lastSuppressionReason, 'buddha');
});

test('Strategic Ack Suppression drops large hits only while Auto Dodge is on', () => {
  const { client, sent, damage, tracker } = projectileHarness();
  client.configureHitSuppression({
    strategicAckSuppression: true,
    suppressThresholdPercent: 10,
    buddhaMode: false,
  });
  const nexus = (client as unknown as {
    autoNexus: { reset(hp: number, maxHp: number): void };
  }).autoNexus;
  nexus.reset(1000, 1000);

  // Without dodge: large hit still lands.
  fireEnemyShot(tracker, 150);
  tracker.update(600, worldAtPlayer());
  assert.equal(sent.some((packet) => packet instanceof PlayerHitPacket), true);
  assert.deepEqual(damage, [150]);

  sent.length = 0;
  damage.length = 0;
  assert.equal(client.enableAutoDodge(), true);
  fireEnemyShot(tracker, 150, 8);
  tracker.update(700, worldAtPlayer());
  assert.equal(sent.some((packet) => packet instanceof PlayerHitPacket), false);
  assert.deepEqual(damage, []);
  assert.equal(client.getCombatProtectionState().lastSuppressionReason, 'strategic_ack');
});

test('Strategic AoE Suppression withholds AOEACK for large unavoidable bombs', () => {
  const { client, sent } = projectileHarness();
  const damage: number[] = [];
  client.on(ClientEvent.DamageTaken, (event) => damage.push(event.amount));
  client.configureHitSuppression({
    strategicAoeSuppression: true,
    suppressThresholdPercent: 10,
  });
  const nexus = (client as unknown as {
    autoNexus: { reset(hp: number, maxHp: number): void; setSafeMap(safe: boolean): void };
  }).autoNexus;
  nexus.reset(1000, 1000);
  nexus.setSafeMap(true);
  assert.equal(client.enableAutoDodge(), true);

  Object.assign(client as unknown as Record<string, unknown>, {
    pos: { x: 4, y: 6 },
    posKnown: true,
    time: () => 456,
  });
  const aoe = new AoePacket();
  aoe.pos.x = 4;
  aoe.pos.y = 6;
  aoe.radius = 1;
  aoe.damage = 150;
  (client as unknown as { handleAoe(p: AoePacket): void }).handleAoe(aoe);

  assert.equal(sent.some((packet) => packet instanceof AoeAckPacket), false);
  assert.deepEqual(damage, []);
  assert.equal(client.getCombatProtectionState().lastSuppressionReason, 'strategic_ack');
});

test('Debuff-ignore withholds PLAYERHIT but still charges predicted HP', () => {
  const definition = ordinaryProjectileDefinition();
  (definition as CombatProjectileDefinition & {
    conditionEffects: Array<{ effect: number }>;
  }).conditionEffects = [{ effect: 2 }]; // Quiet
  const client = new Client({
    alias: 'debuff-ignore-test',
    accessToken: '',
    clientToken: '',
    charId: 1,
    needsNewChar: false,
    host: '127.0.0.1',
    combatData: {
      getObject: (type) => type === 100
        ? { isEnemy: true, occupySquare: false }
        : undefined,
      getProjectile: (type, bulletType) => type === 100 && bulletType === 0
        ? definition
        : undefined,
    },
  });
  const sent: Packet[] = [];
  Object.assign(client as unknown as Record<string, unknown>, {
    io: { send: (packet: Packet) => sent.push(packet) },
    objectId: 10,
    player: {
      hp: 100,
      maxHP: 100,
      def: 0,
      condition: 0,
      condition2: 0,
    } as PlayerData,
  });
  client.configureHitSuppression({ ignoreDebuffs: { ignoreQuiet: true } });
  const nexus = (client as unknown as {
    autoNexus: { reset(hp: number, maxHp: number): void };
  }).autoNexus;
  nexus.reset(100, 100);
  const damage: number[] = [];
  client.on(ClientEvent.DamageTaken, (event) => damage.push(event.amount));

  const tracker = (client as unknown as { combat: CombatTracker }).combat;
  fireEnemyShot(tracker, 25);
  tracker.update(600, worldAtPlayer());

  assert.equal(sent.some((packet) => packet instanceof PlayerHitPacket), false);
  assert.deepEqual(damage, [25]);
  assert.equal(client.getAutoNexusState().predictedHp, 75);
  assert.equal(client.getCombatProtectionState().lastSuppressionReason, 'debuff_ignore');
});

test('AutoSync ClientHP forces prediction onto server after sustained divergence', () => {
  const client = new Client({
    alias: 'autosync-test',
    accessToken: '',
    clientToken: '',
    charId: 1,
    needsNewChar: false,
    host: '127.0.0.1',
  });
  const player = {
    hp: 500,
    maxHP: 1000,
    def: 0,
    condition: 0,
    condition2: 0,
  } as PlayerData;
  Object.assign(client as unknown as Record<string, unknown>, { player });
  client.configureHitSuppression({ autoSyncClientHp: true });
  const nexus = (client as unknown as {
    autoNexus: {
      reset(hp: number, maxHp: number): void;
      applyDamage(amount: number, source: string): boolean;
      getState(): { predictedHp: number | null; serverHp: number | null };
    };
  }).autoNexus;
  nexus.reset(500, 1000);
  // Create a local prediction deficit the server has not confirmed.
  nexus.applyDamage(100, 'projectile');
  assert.equal(nexus.getState().predictedHp, 400);

  const reconcile = (client as unknown as {
    reconcilePlayerHealth(player: PlayerData, full?: boolean): boolean;
  }).reconcilePlayerHealth.bind(client);

  for (let i = 0; i < 4; i++) {
    player.hp = 500;
    reconcile(player, false);
    assert.equal(nexus.getState().predictedHp, 400);
  }
  // Fifth diverged sample trips AutoSync (ticksOff > 3).
  player.hp = 500;
  reconcile(player, false);
  assert.equal(nexus.getState().predictedHp, 500);
  assert.equal(nexus.getState().serverHp, 500);
});

function projectileHarness(): {
  client: Client;
  sent: Packet[];
  damage: number[];
  tracker: CombatTracker;
} {
  const client = new Client({
    alias: 'hit-suppression-test',
    accessToken: '',
    clientToken: '',
    charId: 1,
    needsNewChar: false,
    host: '127.0.0.1',
    combatData: {
      getObject: (type) => type === 100
        ? { isEnemy: true, occupySquare: false }
        : undefined,
      getProjectile: (type, bulletType) => type === 100 && bulletType === 0
        ? ordinaryProjectileDefinition()
        : undefined,
    },
  });
  const sent: Packet[] = [];
  Object.assign(client as unknown as Record<string, unknown>, {
    io: { send: (packet: Packet) => sent.push(packet) },
    objectId: 10,
    lastFrameTime: 123,
    time: () => 456,
    posKnown: true,
    pos: { x: 5, y: 1 },
    player: {
      hp: 1000,
      maxHP: 1000,
      def: 0,
      condition: 0,
      condition2: 0,
    } as PlayerData,
  });
  const damage: number[] = [];
  client.on(ClientEvent.DamageTaken, (event) => damage.push(event.amount));
  const tracker = (client as unknown as { combat: CombatTracker }).combat;
  return { client, sent, damage, tracker };
}

function fireEnemyShot(tracker: CombatTracker, damage: number, bulletId = 7): void {
  const shot = new EnemyShootPacket();
  shot.ownerId = 20;
  shot.bulletId = bulletId;
  shot.bulletType = 0;
  shot.startingPos.x = 0;
  shot.startingPos.y = 1;
  shot.angle = 0;
  shot.damage = damage;
  tracker.trackEnemyShoot(shot, 100, 0);
}

function worldAtPlayer() {
  return {
    playerId: 10,
    playerPos: { x: 5, y: 1 },
    mapWidth: 100,
    mapHeight: 100,
    entities: [] as [],
    tiles: [] as [],
  };
}

function ordinaryProjectileDefinition(): CombatProjectileDefinition {
  return {
    speed: 100,
    lifetimeMs: 1000,
    multiHit: false,
    passesCover: false,
    amplitude: 0,
    frequency: 1,
    magnitude: 3,
    wavy: false,
    parametric: false,
    boomerang: false,
    acceleration: 0,
    accelerationDelay: 0,
    speedClamp: -1,
    laserDistance: 0,
    turnRate: 0,
    turnRateDelay: 0,
    turnAcceleration: 0,
    turnAccelerationDelay: 0,
    turnClamp: 0,
    turnStopTime: 0,
    circleTurnAngle: 0,
    circleTurnDelay: 0,
    collisionMult: 1,
  };
}
