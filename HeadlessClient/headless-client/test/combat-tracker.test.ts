import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ConditionEffectBits,
  EnemyHitPacket,
  EnemyShootPacket,
  OtherHitPacket,
  Packet,
  PlayerHitPacket,
  PlayerShootPacket,
  ServerPlayerShootPacket,
  StatType,
  SquareHitPacket,
} from 'realmlib';
import {
  CombatDataProvider,
  CombatObjectDefinition,
  CombatProjectileDefinition,
  CombatProjectileSnapshot,
  CombatTracker,
  CombatWorldSnapshot,
  isNonlinearProjectile,
  predictProjectilePosition,
} from '../src/combat-tracker';

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
};

test('isNonlinearProjectile flags each of the five nonlinear-motion attributes', () => {
  assert.equal(isNonlinearProjectile(projectile), false,
    'baseline projectile fixture has every nonlinear flag off — must return false');
  assert.equal(isNonlinearProjectile({ ...projectile, wavy: true }), true);
  assert.equal(isNonlinearProjectile({ ...projectile, parametric: true }), true);
  assert.equal(isNonlinearProjectile({ ...projectile, boomerang: true }), true);
  assert.equal(isNonlinearProjectile({ ...projectile, amplitude: 1 }), true);
  assert.equal(isNonlinearProjectile({ ...projectile, acceleration: 200 }), true);
});

test('enemy projectile reports PLAYERHIT once when it reaches the local player', () => {
  const sent: Packet[] = [];
  const tracker = new CombatTracker(data(), (packet) => sent.push(packet));
  const shot = enemyShot();

  tracker.trackEnemyShoot(shot, 100, 0);
  tracker.update(600, world({ playerPos: { x: 5, y: 1 } }));
  tracker.update(800, world({ playerPos: { x: 5, y: 1 } }));

  assert.equal(sent.length, 1);
  assert.ok(sent[0] instanceof PlayerHitPacket);
  assert.equal(sent[0].bulletId, 7);
  assert.equal(sent[0].objectId, 20);
  assert.equal(tracker.size, 0);
});

test('enemy projectile interception suppresses PLAYERHIT before reconnecting', () => {
  const sent: Packet[] = [];
  const intercepted: number[] = [];
  const tracker = new CombatTracker(
    data(),
    (packet) => sent.push(packet),
    (hit) => {
      intercepted.push(hit.damage);
      return true;
    },
  );
  const shot = enemyShot();
  shot.damage = 275;

  tracker.trackEnemyShoot(shot, 100, 0);
  tracker.update(600, world({ playerPos: { x: 5, y: 1 } }));

  assert.deepEqual(intercepted, [275]);
  assert.equal(sent.length, 0);
  assert.equal(tracker.size, 0);
});

test('own projectile reports ENEMYHIT with kill false', () => {
  const sent: Packet[] = [];
  const tracker = new CombatTracker(data(), (packet) => sent.push(packet));
  tracker.trackOwnShoot(ownShot(), 0);

  tracker.update(600, world({
    entities: [{ objectId: 30, type: 100, x: 5, y: 1 }],
  }));

  assert.equal(sent.length, 1);
  assert.ok(sent[0] instanceof EnemyHitPacket);
  assert.equal(sent[0].targetId, 30);
  assert.equal(sent[0].kill, false);
  assert.equal(sent[0].shooterId, 10);
  assert.equal(sent[0].mainId, 10);
});

test('own projectile collision uses the interpolated entity position', () => {
  const sent: Packet[] = [];
  const tracker = new CombatTracker(data(), (packet) => sent.push(packet));
  tracker.trackOwnShoot(ownShot(), 0);

  tracker.update(600, world({
    entities: [{ objectId: 30, type: 100, x: 9, y: 1 }],
    resolveEntityPosition: () => ({ x: 5, y: 1 }),
  }));

  assert.equal(sent.length, 1);
  assert.ok(sent[0] instanceof EnemyHitPacket);
  assert.equal(sent[0].targetId, 30);
});

test('own projectile ignores permanently invincible enemy-tagged objects', () => {
  const sent: Packet[] = [];
  const tracker = new CombatTracker(data(), (packet) => sent.push(packet));
  tracker.trackOwnShoot(ownShot(), 0);

  tracker.update(600, world({
    entities: [
      { objectId: 31, type: 101, x: 3, y: 1 },
      { objectId: 30, type: 100, x: 5, y: 1 },
    ],
  }));

  assert.equal(sent.length, 1);
  assert.ok(sent[0] instanceof EnemyHitPacket);
  assert.equal(sent[0].targetId, 30);
});

test('own projectile ignores dead, stasis, and runtime-invincible enemies', () => {
  const sent: Packet[] = [];
  const tracker = new CombatTracker(data(), (packet) => sent.push(packet));
  tracker.trackOwnShoot(ownShot(), 0);

  tracker.update(600, world({
    entities: [
      { objectId: 31, type: 100, x: 2, y: 1, rawStats: { [StatType.HP_STAT]: 0 } },
      { objectId: 32, type: 100, x: 3, y: 1, rawStats: { [StatType.CONDITION_STAT]: ConditionEffectBits.STASIS } },
      { objectId: 33, type: 100, x: 4, y: 1, rawStats: { [StatType.CONDITION_STAT]: ConditionEffectBits.INVINCIBLE } },
      { objectId: 30, type: 100, x: 5, y: 1, rawStats: { [StatType.HP_STAT]: 100 } },
    ],
  }));

  assert.equal(sent.length, 1);
  assert.ok(sent[0] instanceof EnemyHitPacket);
  assert.equal(sent[0].targetId, 30);
});

test('server shot echo does not replace the locally tracked subattack projectile', () => {
  const sent: Packet[] = [];
  const localProjectile = { ...projectile, speed: 100 };
  const echoedProjectile = { ...projectile, speed: 10 };
  const base = data();
  const tracker = new CombatTracker({
    getObject: base.getObject,
    getProjectile: (type, id) => type === 500
      ? id === 1 ? localProjectile : id === 0 ? echoedProjectile : undefined
      : undefined,
  }, (packet) => sent.push(packet));
  const localShot = new PlayerShootPacket();
  localShot.bulletId = 8;
  localShot.containerType = 500;
  localShot.startingPos.x = 0;
  localShot.startingPos.y = 1;
  localShot.angle = 0;

  tracker.trackPlayerShoot(10, localShot, 0, 1);
  tracker.trackOwnShoot(ownShot(), 0);
  tracker.update(600, world({
    entities: [{ objectId: 30, type: 100, x: 5, y: 1 }],
  }));

  assert.equal(sent.length, 1);
  assert.ok(sent[0] instanceof EnemyHitPacket);
  assert.equal(sent[0].targetId, 30);
});

test('lifetime multipliers do not stretch a parametric projectile path', () => {
  const sent: Packet[] = [];
  const parametricProjectile = {
    ...projectile,
    speed: 0,
    parametric: true,
    magnitude: 3,
  };
  const base = data();
  const tracker = new CombatTracker({
    getObject: base.getObject,
    getProjectile: (type, id) => type === 500 && id === 0 ? parametricProjectile : undefined,
  }, (packet) => sent.push(packet));
  const shot = new PlayerShootPacket();
  shot.bulletId = 8;
  shot.containerType = 500;
  shot.startingPos.x = 10;
  shot.startingPos.y = 10;
  shot.angle = 0;

  tracker.trackPlayerShoot(10, shot, 0, 0, 1, 2);
  tracker.update(300, world({
    entities: [{ objectId: 30, type: 100, x: 7, y: 10 }],
  }));

  assert.equal(sent.length, 1);
  assert.ok(sent[0] instanceof EnemyHitPacket);
  assert.equal(sent[0].targetId, 30);
});

test('cover resolves an own projectile with OTHERHIT before an enemy target', () => {
  const sent: Packet[] = [];
  const tracker = new CombatTracker(data(), (packet) => sent.push(packet));
  tracker.trackOwnShoot(ownShot(), 0);

  tracker.update(600, world({
    entities: [
      { objectId: 40, type: 200, x: 3, y: 1 },
      { objectId: 30, type: 100, x: 5, y: 1 },
    ],
  }));

  assert.equal(sent.length, 1);
  assert.ok(sent[0] instanceof OtherHitPacket);
  assert.equal(sent[0].targetId, 40);
});

test('projectile noclip lets a local projectile pass cover and hit an enemy', () => {
  const sent: Packet[] = [];
  const tracker = new CombatTracker(data(), (packet) => sent.push(packet));
  assert.equal(tracker.isProjectileNoclipEnabled(), false);
  tracker.setProjectileNoclip(true);
  tracker.clear();
  assert.equal(tracker.isProjectileNoclipEnabled(), true);
  const shot = new PlayerShootPacket();
  shot.bulletId = 8;
  shot.containerType = 500;
  shot.startingPos.x = 0;
  shot.startingPos.y = 1;
  shot.angle = 0;
  tracker.trackPlayerShoot(10, shot, 0, 0);

  tracker.update(600, world({
    entities: [
      { objectId: 40, type: 200, x: 3, y: 1 },
      { objectId: 30, type: 100, x: 5, y: 1 },
    ],
  }));

  assert.equal(sent.length, 1);
  assert.ok(sent[0] instanceof EnemyHitPacket);
  assert.equal(sent[0].targetId, 30);
});

test('projectile noclip does not let enemy projectiles pass cover', () => {
  const sent: Packet[] = [];
  const tracker = new CombatTracker(data(), (packet) => sent.push(packet));
  tracker.setProjectileNoclip(true);
  tracker.trackEnemyShoot(enemyShot(), 100, 0);

  tracker.update(600, world({
    playerPos: { x: 5, y: 1 },
    entities: [{ objectId: 40, type: 200, x: 3, y: 1 }],
  }));

  assert.equal(sent.length, 1);
  assert.ok(sent[0] instanceof OtherHitPacket);
  assert.equal(sent[0].targetId, 40);
});

test('projectile noclip does not bypass map bounds', () => {
  const sent: Packet[] = [];
  const tracker = new CombatTracker(data(), (packet) => sent.push(packet));
  tracker.setProjectileNoclip(true);
  const shot = ownShot();
  shot.startingPos.x = 9;
  tracker.trackOwnShoot(shot, 0);

  tracker.update(300, world({ mapWidth: 10 }));

  assert.equal(sent.length, 1);
  assert.ok(sent[0] instanceof SquareHitPacket);
  assert.equal(sent[0].objectId, 10);
});

test('multi-hit projectiles keep accuracy within a 0-1 fraction', () => {
  const multiHit = { ...projectile, multiHit: true };
  const base = data();
  const tracker = new CombatTracker({
    getObject: base.getObject,
    getProjectile: (type, id) => type === 500 && id === 0 ? multiHit : undefined,
  }, () => undefined);
  const shot = new PlayerShootPacket();
  shot.bulletId = 9;
  shot.containerType = 500;
  shot.startingPos.x = 0;
  shot.startingPos.y = 1;
  shot.angle = 0;
  tracker.trackPlayerShoot(10, shot, 0);

  tracker.update(800, world({
    entities: [
      { objectId: 30, type: 100, x: 3, y: 1 },
      { objectId: 31, type: 100, x: 6, y: 1 },
    ],
  }));

  assert.equal(tracker.accuracy(), 1);
});

test('predictProjectilePosition advances unclamped-accelerated projectiles across mid-flight samples', () => {
  const accelDef: CombatProjectileDefinition = {
    ...projectile,
    speed: 100,
    lifetimeMs: 2000,
    acceleration: 200,
    accelerationDelay: 0,
    speedClamp: -1,
  };
  const shot: CombatProjectileSnapshot = {
    side: 'enemy', bulletId: 42, bulletType: 0, ownerId: 20, containerType: 100,
    startX: 0, startY: 5, angle: 0, startTime: 0,
    definition: accelDef, damage: 100, hitObjects: new Set(),
  };
  const p500 = predictProjectilePosition(shot, 500);
  const p1000 = predictProjectilePosition(shot, 1000);
  assert.ok(Math.abs(p500.x - 7.5) < 1e-6,
    `expected x approx 7.5 at t=500 (integrated 500 ms of quadratic motion), got ${p500.x}`);
  assert.ok(Math.abs(p1000.x - 20) < 1e-6,
    `expected x approx 20 at t=1000 (integrated 1000 ms of quadratic motion), got ${p1000.x}`);
  assert.notEqual(p500.x, p1000.x);
});

test('predictProjectilePosition respects speedClamp for clamped-accelerated projectiles', () => {
  const clampedDef: CombatProjectileDefinition = {
    ...projectile,
    speed: 100,
    lifetimeMs: 2000,
    acceleration: 200,
    accelerationDelay: 0,
    speedClamp: 200,
  };
  const shot: CombatProjectileSnapshot = {
    side: 'enemy', bulletId: 43, bulletType: 0, ownerId: 20, containerType: 100,
    startX: 0, startY: 5, angle: 0, startTime: 0,
    definition: clampedDef, damage: 100, hitObjects: new Set(),
  };
  const p1000 = predictProjectilePosition(shot, 1000);
  assert.ok(Math.abs(p1000.x - 17.5) < 1e-6,
    `expected x approx 17.5 at t=1000 (500 ms accel to clamp + 500 ms cruise at clamped speed), got ${p1000.x}`);
});

test('predictProjectilePosition treats pre-delay time as pure linear motion, then accelerates', () => {
  const delayedDef: CombatProjectileDefinition = {
    ...projectile,
    speed: 100,
    lifetimeMs: 2000,
    acceleration: 200,
    accelerationDelay: 400,
    speedClamp: -1,
  };
  const shot: CombatProjectileSnapshot = {
    side: 'enemy', bulletId: 44, bulletType: 0, ownerId: 20, containerType: 100,
    startX: 0, startY: 5, angle: 0, startTime: 0,
    definition: delayedDef, damage: 100, hitObjects: new Set(),
  };
  const p200 = predictProjectilePosition(shot, 200);
  assert.ok(Math.abs(p200.x - 2) < 1e-6,
    `expected x approx 2 at t=200 (linear before delay), got ${p200.x}`);
  const p600 = predictProjectilePosition(shot, 600);
  assert.ok(Math.abs(p600.x - 6.4) < 1e-6,
    `expected x approx 6.4 at t=600 (delay linear + 200 ms of quadratic accel), got ${p600.x}`);
});

function data(): CombatDataProvider {
  const objects = new Map<number, CombatObjectDefinition>([
    [100, { isEnemy: true, occupySquare: false }],
    [101, { isEnemy: true, invincible: true, occupySquare: false }],
    [200, { isEnemy: false, occupySquare: true }],
    [300, { isEnemy: false, isPlayer: true, occupySquare: false }],
  ]);
  return {
    getObject: (type) => objects.get(type),
    getProjectile: (type, id) => (type === 100 || type === 500) && id === 0 ? projectile : undefined,
  };
}

function enemyShot(): EnemyShootPacket {
  const shot = new EnemyShootPacket();
  shot.bulletId = 7;
  shot.ownerId = 20;
  shot.bulletType = 0;
  shot.startingPos.x = 0;
  shot.startingPos.y = 1;
  shot.angle = 0;
  shot.numShots = 1;
  return shot;
}

function ownShot(): ServerPlayerShootPacket {
  const shot = new ServerPlayerShootPacket();
  shot.bulletId = 8;
  shot.ownerId = 10;
  shot.containerType = 500;
  shot.startingPos.x = 0;
  shot.startingPos.y = 1;
  shot.angle = 0;
  return shot;
}

function world(overrides: Partial<CombatWorldSnapshot> = {}): CombatWorldSnapshot {
  return {
    playerId: 10,
    playerPos: { x: 50, y: 50 },
    mapWidth: 100,
    mapHeight: 100,
    entities: [],
    tiles: [],
    ...overrides,
  };
}
