import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EnemyShootPacket, Packet, PlayerHitPacket } from 'realmlib';
import {
  CombatDataProvider,
  CombatObjectDefinition,
  CombatProjectileDefinition,
  CombatTracker,
  CombatWorldSnapshot,
  EnemyShootRecovery,
  EnemyShootRecoveryMode,
  EnemyShootResolveContext,
  MAX_PENDING_ENEMY_SHOOTS,
  PENDING_ENEMY_SHOOT_DISTANCE,
  PENDING_ENEMY_SHOOT_MS,
  PendingEnemyShoot,
  enemyShootObservation,
} from '../src/combat-tracker';

const WATCHER = 0x1000;
const WATCHLING = 0x1001;

const projectile: CombatProjectileDefinition = {
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
  turnRate: 0,
  turnRateDelay: 0,
  turnAcceleration: 0,
  turnAccelerationDelay: 0,
  turnClamp: 0,
  turnStopTime: 0,
  circleTurnAngle: 0,
  circleTurnDelay: 0,
  collisionMult: 1,
  laserDistance: 0,
};

test('a shot whose owner has not streamed is queued, then replayed once UPDATE registers it', () => {
  const { recovery, world } = harness();
  const shot = enemyShot();

  assert.equal(world.handle(shot, 0), 'deferred', 'no owner and nothing learned yet — must defer');
  assert.equal(recovery.pendingCount, 1);
  assert.equal(world.replays.length, 0);

  world.streamOwner(20, WATCHER);
  world.resolve(120);

  assert.equal(recovery.pendingCount, 0, 'the queue entry is consumed by the replay');
  assert.equal(world.replays.length, 1);
  assert.equal(world.replays[0]!.ownerType, WATCHER);
  assert.equal(world.replays[0]!.mode, 'deferred');
  assert.equal(world.replays[0]!.delayMs, 120);
  const stats = recovery.stats();
  assert.equal(stats.queued, 1);
  assert.equal(stats.recovered, 1);
  assert.equal(stats.unresolved, 0);
  assert.equal(stats.maxRecoveryDelayMs, 120);
});

test('a learned damage/count/spread signature resolves an owner that never streams', () => {
  const { recovery, world } = harness();

  // A live watcher fires first, which makes its signature type authority.
  recovery.observeLiveShot(WATCHER, enemyShootObservation(enemyShot({ ownerId: 20 })));

  // The same pattern now arrives from an owner id we have never seen.
  const stranger = enemyShot({ ownerId: 991, bulletId: 40 });
  assert.equal(world.handle(stranger, 500), 'tracked',
    'the signature resolves this immediately — it is never queued');
  assert.equal(recovery.pendingCount, 0);
  assert.equal(world.tracked.at(-1)!.ownerType, WATCHER);
  assert.equal(recovery.stats().bySignature, 1);
});

test('a queued shot is replayed via signature when a later live shot trains the pattern', () => {
  const { recovery, world } = harness();

  assert.equal(world.handle(enemyShot({ ownerId: 991 }), 0), 'deferred');
  assert.equal(recovery.pendingCount, 1);

  // A different owner of the same type fires while the first shot is still queued.
  recovery.observeLiveShot(WATCHER, enemyShootObservation(enemyShot({ ownerId: 20 })));
  world.resolve(80);

  assert.equal(recovery.pendingCount, 0);
  assert.equal(world.replays.length, 1);
  assert.equal(world.replays[0]!.ownerType, WATCHER);
  assert.equal(world.replays[0]!.mode, 'deferred_signature');
  assert.equal(recovery.stats().bySignature, 1);
});

test('Neo Forax built-in owner ids resolve as verified_map_source without streaming', () => {
  const recovery = new EnemyShootRecovery(neoForaxData());
  recovery.setMap('Neo Forax');
  const tracked: number[] = [];
  const ctx = (now: number): EnemyShootResolveContext => ({
    now,
    ownerType: () => -1,
    cacheObjectType: () => undefined,
    playerDistanceTo: () => 1,
    replay: () => undefined,
  });

  for (const [ownerId, ownerType] of [
    [4, 0xdcd0],
    [5, 0xdcd1],
    [15, 0xdcd1],
    [7, 0xdcd2],
    [10, 0xdcd3],
  ] as const) {
    const shot = enemyShootObservation(enemyShot({ ownerId }));
    const resolved = recovery.resolveOwnerType(shot, ctx(0));
    assert.equal(resolved.ownerType, ownerType, `owner ${ownerId}`);
    assert.equal(resolved.mode, 'verified_map_source', `owner ${ownerId}`);
    tracked.push(ownerId);
  }
  assert.equal(tracked.length, 5);
  assert.equal(recovery.stats().byMapSource, 5);

  // Wrong map name must not use the Neo Forax table.
  recovery.setMap('Wine Cellar');
  const elsewhere = recovery.resolveOwnerType(enemyShootObservation(enemyShot({ ownerId: 7 })), ctx(0));
  assert.equal(elsewhere.ownerType, -1);
});

test('a signature claimed by two object types is poisoned rather than guessed', () => {
  const { recovery, world } = harness();
  recovery.observeLiveShot(WATCHER, enemyShootObservation(enemyShot({ ownerId: 20 })));
  recovery.observeLiveShot(WATCHLING, enemyShootObservation(enemyShot({ ownerId: 21 })));

  assert.equal(world.handle(enemyShot({ ownerId: 991 }), 0), 'deferred',
    'an ambiguous signature must not resolve to either type');
  assert.equal(recovery.stats().learnedSignatures, 0);
  assert.equal(recovery.stats().ambiguousSignatures, 1);
});

test('a per-map objectId association resolves a shooter that streams late on re-entry', () => {
  const { recovery, world } = harness();
  recovery.setMap('Wine Cellar');

  // First entry: the shooter is live, so id 7 -> watcher at (40, 40) is learned.
  recovery.observeLiveShot(WATCHER, enemyShootObservation(enemyShot({ ownerId: 7 })));

  // Re-entry into the same map: same id, same launch square, still unstreamed.
  // Signatures were dropped by setMap, so only the association can answer.
  recovery.setMap('Wine Cellar');
  assert.equal(recovery.stats().learnedSignatures, 0, 'setMap drops the signature table');
  assert.equal(world.handle(enemyShot({ ownerId: 7 }), 0), 'tracked');
  assert.equal(world.tracked.at(-1)!.ownerType, WATCHER);
  assert.equal(recovery.stats().byMapSource, 1);
});

test('an association is not reused when the same id shoots from a different square', () => {
  const { recovery, world } = harness();
  recovery.setMap('Wine Cellar');
  recovery.observeLiveShot(WATCHER, enemyShootObservation(enemyShot({ ownerId: 7 })));
  recovery.setMap('Wine Cellar');

  assert.equal(world.handle(enemyShot({ ownerId: 7, startX: 60, startY: 60 }), 0), 'deferred',
    'the launch-position check is what makes id reuse safe');
  assert.equal(recovery.stats().byMapSource, 0);
});

test('learned tables do not leak across a map change', () => {
  const { recovery, world } = harness();
  recovery.setMap('Wine Cellar');
  recovery.observeLiveShot(WATCHER, enemyShootObservation(enemyShot({ ownerId: 7 })));

  recovery.setMap('Undead Lair');

  assert.equal(world.handle(enemyShot({ ownerId: 7 }), 0), 'deferred',
    'the association is keyed by map name, so it cannot answer in another map');
  assert.equal(world.handle(enemyShot({ ownerId: 991 }), 0), 'deferred',
    'the signature table was cleared on entry');
  assert.equal(recovery.stats().bySignature, 0);
  assert.equal(recovery.stats().byMapSource, 0);

  // Going back re-scopes the key to the map it was learned in.
  recovery.setMap('Wine Cellar');
  assert.equal(world.handle(enemyShot({ ownerId: 7 }), 0), 'tracked');
  assert.equal(recovery.stats().byMapSource, 1);
});

test('a map change empties the pending queue', () => {
  const { recovery, world } = harness();
  world.handle(enemyShot(), 0);
  assert.equal(recovery.pendingCount, 1);

  recovery.setMap('Undead Lair');

  assert.equal(recovery.pendingCount, 0);
  world.resolve(100);
  assert.equal(world.replays.length, 0, 'a dropped queue entry must not replay into the new map');
});

test('the nearest live enemy to the launch point resolves an unknown owner id', () => {
  const { recovery, world } = harness();
  world.enemies.set(555, { type: WATCHER, x: 40.1, y: 40.1 });

  assert.equal(world.handle(enemyShot({ ownerId: 991 }), 0), 'tracked');
  assert.equal(world.tracked.at(-1)!.ownerType, WATCHER);
  assert.equal(recovery.stats().byLaunchPosition, 1);
  assert.equal(recovery.stats().learnedMapSources, 0,
    'a launch-square match is not owner-id authority and must not train the caches');
});

test('a shot that never resolves is counted as unresolved and evicted at the deferral deadline', () => {
  const { recovery, world } = harness();
  world.handle(enemyShot(), 0);

  world.resolve(PENDING_ENEMY_SHOOT_MS - 1);
  assert.equal(recovery.pendingCount, 1, 'still inside the recovery window');
  assert.equal(recovery.stats().unresolved, 0);

  world.resolve(PENDING_ENEMY_SHOOT_MS);

  assert.equal(recovery.pendingCount, 0, 'evicted — the queue is bounded in time as well as size');
  assert.equal(recovery.stats().unresolved, 1);
  assert.equal(recovery.stats().recovered, 0);
  assert.match(String(recovery.stats().unresolvedProfiles), /^0:50:1:0x1$/,
    'the unresolved bullet/damage/count/spread profile is reported, not silently dropped');
});

test('a launch point beyond the deferral distance is skipped instead of taking a queue slot', () => {
  const { recovery, world } = harness();
  const far = PENDING_ENEMY_SHOOT_DISTANCE + 5;

  world.handle(enemyShot({ startX: world.playerPos.x + far, startY: world.playerPos.y }), 0);

  assert.equal(recovery.pendingCount, 0);
  assert.equal(recovery.stats().distantSkipped, 1);
  assert.equal(recovery.stats().queued, 0);
});

test('the queue refuses entries past its bound and counts the overflow', () => {
  const { recovery, world } = harness();
  for (let index = 0; index <= MAX_PENDING_ENEMY_SHOOTS + 4; index++) {
    world.handle(enemyShot({ ownerId: 900 + index }), 0);
  }

  assert.equal(recovery.pendingCount, MAX_PENDING_ENEMY_SHOOTS);
  assert.equal(recovery.stats().queued, MAX_PENDING_ENEMY_SHOOTS);
  assert.equal(recovery.stats().queueOverflow, 5);
});

test('a shot resolved past its projectile lifetime is counted, not replayed as live danger', () => {
  const { recovery, world } = harness();
  world.handle(enemyShot(), 0);
  world.streamOwner(20, WATCHER);

  world.resolve(projectile.lifetimeMs + 10);

  assert.equal(world.replays.length, 0);
  assert.equal(recovery.pendingCount, 0);
  assert.equal(recovery.stats().tooLateToReplay, 1);
});

test('a resolved owner with no projectile definition for the bulletType is counted, not silent', () => {
  const { recovery, world } = harness();
  world.streamOwner(20, WATCHER);

  assert.equal(world.handle(enemyShot({ bulletType: 9 }), 0), 'undefined-projectile');
  assert.equal(recovery.stats().noProjectileDefinition, 1);
});

test('a replayed shot keeps its original shot time, so it is where it actually is now', () => {
  const sent: Packet[] = [];
  const tracker = new CombatTracker(data(), (packet) => sent.push(packet));
  // Fired at t=0 from x=0 along y=1 at 100 units of speed, i.e. one tile per
  // 100 ms; the player stands five tiles away, so it connects at t=500.
  const shot: PendingEnemyShoot = {
    ...enemyShootObservation(enemyShot({ startX: 0, startY: 1 })),
    shotTime: 0,
    queuedAt: 0,
  };

  // Resolved 200 ms late. Positioned for t=200 (two tiles out), not for a fresh spawn.
  assert.equal(tracker.trackDeferredEnemyShoot(shot, WATCHER, 200), 1);
  const live = [...tracker.getActiveProjectiles()];
  assert.equal(live.length, 1);
  assert.equal(live[0]!.startTime, 0, 'the shot time is the packet time, not the replay time');

  tracker.update(400, world({ playerPos: { x: 5, y: 1 } }));
  assert.equal(sent.length, 0, 'at t=400 the bullet is four tiles out and has not arrived');
  tracker.update(520, world({ playerPos: { x: 5, y: 1 } }));
  assert.equal(sent.length, 1, 'it connects on the same schedule the server used');
  assert.ok(sent[0] instanceof PlayerHitPacket);
});

test('a replay does not re-test the span it already flew against the current player position', () => {
  const sent: Packet[] = [];
  const tracker = new CombatTracker(data(), (packet) => sent.push(packet));
  const shot: PendingEnemyShoot = {
    ...enemyShootObservation(enemyShot({ startX: 0, startY: 1 })),
    shotTime: 0,
    queuedAt: 0,
  };

  // Resolved at t=800, by which point the bullet is eight tiles out — it passed
  // the player's tile at t=500. Catch-up stepping from zero would walk that span
  // against the player's present position and manufacture a hit the server never
  // claimed; the bullet is behind them now.
  tracker.trackDeferredEnemyShoot(shot, WATCHER, 800);
  tracker.update(800, world({ playerPos: { x: 5, y: 1 } }));

  assert.equal(sent.length, 0, 'no retroactive PLAYERHIT for a bullet that is already past');
});

/** Drives the resolver the way `Client.handleEnemyShoot` does. */
function harness() {
  const recovery = new EnemyShootRecovery(data());
  const replays: { ownerType: number; mode: EnemyShootRecoveryMode; delayMs: number }[] = [];
  const tracked: { ownerType: number; mode: EnemyShootRecoveryMode }[] = [];
  const streamed = new Map<number, number>();
  const enemies = new Map<number, { type: number; x: number; y: number }>();
  const playerPos = { x: 40, y: 40 };
  recovery.setMap('Wine Cellar');

  const context = (now: number): EnemyShootResolveContext => ({
    now,
    ownerType: (ownerId) => streamed.get(ownerId) ?? -1,
    staticHostileType: (x, y) => {
      let bestType = -1;
      let bestDistanceSq = 0.85 * 0.85;
      for (const enemy of enemies.values()) {
        const distanceSq = (enemy.x - x) ** 2 + (enemy.y - y) ** 2;
        if (distanceSq <= bestDistanceSq) {
          bestDistanceSq = distanceSq;
          bestType = enemy.type;
        }
      }
      return bestType;
    },
    cacheObjectType: (ownerId, ownerType) => streamed.set(ownerId, ownerType),
    playerDistanceTo: (x, y) => Math.hypot(x - playerPos.x, y - playerPos.y),
    replay: (_shot, ownerType, mode, delayMs) => replays.push({ ownerType, mode, delayMs }),
  });

  return {
    recovery,
    world: {
      replays,
      tracked,
      enemies,
      playerPos,
      streamOwner(ownerId: number, type: number) {
        streamed.set(ownerId, type);
      },
      /** Mirrors the live-packet branch of `handleEnemyShoot`. */
      handle(packet: EnemyShootPacket, now: number):
        'tracked' | 'deferred' | 'undefined-projectile' {
        const observation = enemyShootObservation(packet);
        const ctx = context(now);
        const live = streamed.get(packet.ownerId);
        let ownerType: number;
        let mode: EnemyShootRecoveryMode = 'live';
        if (live !== undefined) {
          recovery.observeLiveShot(live, observation);
          ownerType = live;
        } else {
          const resolved = recovery.resolveOwnerType(observation, ctx);
          if (resolved.ownerType < 0) {
            recovery.deferUnresolved(observation, now, ctx);
            return 'deferred';
          }
          ownerType = resolved.ownerType;
          mode = resolved.mode;
        }
        if (!data().getProjectile(ownerType, observation.bulletType)) {
          recovery.noteMissingDefinition();
          return 'undefined-projectile';
        }
        tracked.push({ ownerType, mode });
        return 'tracked';
      },
      resolve(now: number) {
        recovery.resolvePending(context(now));
      },
    },
  };
}

function data(): CombatDataProvider {
  const objects = new Map<number, CombatObjectDefinition>([
    [WATCHER, { isEnemy: true, occupySquare: false }],
    [WATCHLING, { isEnemy: true, occupySquare: false }],
  ]);
  return {
    getObject: (type) => objects.get(type),
    getProjectile: (type, id) =>
      (type === WATCHER || type === WATCHLING) && id === 0 ? projectile : undefined,
  };
}

/** Projectile defs for the five Neo Forax perimeter source object types. */
function neoForaxData(): CombatDataProvider {
  const types = new Set([0xdcd0, 0xdcd1, 0xdcd2, 0xdcd3]);
  return {
    getObject: (type) =>
      types.has(type) ? { isEnemy: true, occupySquare: false } : undefined,
    getProjectile: (type, id) => (types.has(type) && id === 0 ? projectile : undefined),
  };
}

function enemyShot(overrides: Partial<{
  ownerId: number;
  bulletId: number;
  bulletType: number;
  damage: number;
  numShots: number;
  angleInc: number;
  startX: number;
  startY: number;
}> = {}): EnemyShootPacket {
  const shot = new EnemyShootPacket();
  shot.ownerId = overrides.ownerId ?? 20;
  shot.bulletId = overrides.bulletId ?? 7;
  shot.bulletType = overrides.bulletType ?? 0;
  shot.damage = overrides.damage ?? 50;
  shot.numShots = overrides.numShots ?? 1;
  shot.angleInc = overrides.angleInc ?? 0;
  shot.angle = 0;
  shot.startingPos.x = overrides.startX ?? 40;
  shot.startingPos.y = overrides.startY ?? 40;
  return shot;
}

function world(overrides: Partial<CombatWorldSnapshot> = {}): CombatWorldSnapshot {
  return {
    playerId: 10,
    playerPos: { x: 50, y: 50 },
    mapWidth: 0,
    mapHeight: 0,
    entities: [],
    tiles: [],
    ...overrides,
  };
}
