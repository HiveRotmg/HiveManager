import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  AoePacket,
  ShowEffectPacket,
  VisualEffect,
} from 'realmlib';
import { Client } from '../src/client';
import {
  DodgeAoeThreatTracker,
  MovingAoeEmitterTracker,
  beamAoeDamage,
  beamAoeRadius,
  beamAoeWarningMs,
} from '../src/predictive-auto-dodge';
import {
  collectTelegraphLasers,
  type DodgeTelegraphLaser,
} from '../src/prodmafia-auto-dodge';
import type {
  CombatDataProvider,
  CombatProjectileDefinition,
  CombatProjectileSnapshot,
} from '../src/combat-tracker';

function invoke(client: Client, method: string, ...args: unknown[]): void {
  (client as unknown as Record<string, (...methodArgs: unknown[]) => void>)[method]!(...args);
}

function baseProjectile(
  overrides: Partial<CombatProjectileDefinition> = {},
): CombatProjectileDefinition {
  return {
    speed: 0,
    lifetimeMs: 800,
    multiHit: false,
    passesCover: false,
    amplitude: 0,
    frequency: 0,
    magnitude: 0,
    wavy: false,
    parametric: false,
    boomerang: false,
    acceleration: 0,
    accelerationDelay: 0,
    speedClamp: 0,
    turnRate: 0,
    turnRateDelay: 0,
    turnAcceleration: 0,
    turnAccelerationDelay: 0,
    turnClamp: 0,
    turnStopTime: 0,
    circleTurnAngle: 0,
    circleTurnDelay: 0,
    collisionMult: 1,
    ...overrides,
  };
}

test('DodgeAoeThreatTracker retains recent AoEs with repeating + conditionEffects', () => {
  const tracker = new DodgeAoeThreatTracker();
  // Known cadence origin (51058 / damage 40) is repeating from the first pulse.
  tracker.recordAoe({ x: 10, y: 10 }, 2, 1000, 0.5, 40, false, 51058, 0, 1);
  const recent = tracker.getRecentAoes(1050);
  assert.equal(recent.length, 1);
  assert.equal(recent[0]!.repeating, true);
  assert.equal(recent[0]!.damage, 40);
  assert.ok((recent[0]!.until - 1000) > 90);

  tracker.recordAoe({ x: 20, y: 20 }, 1.5, 2000, 1, 80, false, 1, 14, 2);
  const paralyzed = tracker.getRecentAoes(2010);
  const hit = paralyzed.find((entry) => entry.x === 20);
  assert.ok(hit);
  assert.deepEqual(hit!.conditionEffects, [{ effect: 14, durationSec: 1 }]);
});

test('DodgeAoeThreatTracker records Holy/Chaos beam telegraphs', () => {
  const tracker = new DodgeAoeThreatTracker();
  const sourceType = 0x1AF3; // O3 cleric beam
  tracker.recordTelegraphedAoe({
    x: 5,
    y: 6,
    radius: beamAoeRadius(sourceType),
    now: 100,
    impactTime: 100 + beamAoeWarningMs(sourceType),
    targetId: 42,
    effectType: VisualEffect.HOLY_BEAM,
    sourceType,
    damage: beamAoeDamage(sourceType),
    armorPiercing: true,
  });
  const telegraphs = tracker.getTelegraphedAoes(150);
  assert.equal(telegraphs.length, 1);
  assert.equal(telegraphs[0]!.radius, 1.4);
  assert.equal(telegraphs[0]!.damage, 200);
  assert.equal(telegraphs[0]!.impactTime, 300);

  // Matching AOE resolves the telegraph.
  tracker.recordAoe({ x: 5.1, y: 6 }, 1.4, 300, 0.2, 200, true, sourceType, 0, 0);
  assert.equal(tracker.getTelegraphedAoes(310).length, 0);
});

test('MovingAoeEmitterTracker predicts next pulse from object + AOE packets', () => {
  const tracker = new MovingAoeEmitterTracker();
  const objectType = 0xB1DD; // O3 bomb artifact 1
  tracker.register(7, objectType, 8, 9, 0);
  // Unconfirmed emitters claim impactOffset 0 while proving themselves.
  let active = tracker.getActive(50);
  assert.equal(active.length, 1);
  assert.equal(active[0]!.impactOffsetMs, 0);
  assert.equal(active[0]!.radius, 2);
  assert.equal(active[0]!.damage, 200);

  tracker.update(7, 8.4, 9, 100);
  assert.equal(
    tracker.recordImpact(8.4, 9, 2, 200, 210, false, 0, 0, objectType),
    true,
  );
  active = tracker.getActive(250);
  assert.equal(active.length, 1);
  assert.ok(active[0]!.impactOffsetMs > 0);
  assert.equal(active[0]!.damage, 210);
});

test('collectTelegraphLasers keeps zero-damage lasers with damaging twins', () => {
  const telegraph = baseProjectile({
    laserDistance: 8,
    lifetimeMs: 500,
    maxDamage: 0,
    conditionEffects: [],
  });
  const twin = baseProjectile({
    laserDistance: 8,
    maxDamage: 180,
    collisionMult: 1.2,
  });
  const getProjectile = (containerType: number, projectileId: number) => {
    if (containerType !== 99) return undefined;
    if (projectileId === 0) return telegraph;
    if (projectileId === 1) return twin;
    return undefined;
  };
  const projectiles: CombatProjectileSnapshot[] = [{
    side: 'enemy',
    bulletId: 1,
    bulletType: 0,
    ownerId: 5,
    containerType: 99,
    startX: 1,
    startY: 2,
    angle: 0.5,
    startTime: 1000,
    definition: telegraph,
    damage: 0,
    hitObjects: new Set(),
  }];
  const lasers: DodgeTelegraphLaser[] = collectTelegraphLasers(
    projectiles,
    getProjectile,
    1100,
  );
  assert.equal(lasers.length, 1);
  assert.equal(lasers[0]!.length, 8);
  assert.equal(lasers[0]!.twinDamage, 180);
  assert.ok(Math.abs(lasers[0]!.dangerRadius - 0.5 * 1.2) < 1e-9);
  assert.equal(lasers[0]!.impactTime, 1500);
});

test('client SHOW_EFFECT + AOE populate telegraphed/recent/condition snapshot fields', () => {
  const combatData: CombatDataProvider = {
    getObject: () => undefined,
    getProjectile: () => undefined,
  };
  const client = new Client({
    alias: 'test',
    host: '127.0.0.1',
    accessToken: 'x',
    clientToken: 'y',
    charId: 1,
    needsNewChar: false,
    combatData,
  });
  Object.assign(client as unknown as Record<string, unknown>, {
    time: () => 1000,
    io: { send: () => undefined },
  });
  const internals = client as unknown as {
    aoeThreats: DodgeAoeThreatTracker;
    objects: Map<number, { objectId: number; type: number; x: number; y: number }>;
  };
  internals.objects.set(42, {
    objectId: 42,
    type: 0x1AF3,
    x: 12,
    y: 13,
  });

  const beam = new ShowEffectPacket();
  beam.effectType = VisualEffect.HOLY_BEAM;
  beam.targetObjectId = 42;
  beam.pos1.x = 0.2;
  invoke(client, 'handleShowEffect', beam);

  const telegraphs = internals.aoeThreats.getTelegraphedAoes(1000);
  assert.equal(telegraphs.length, 1);
  assert.equal(telegraphs[0]!.x, 12);
  assert.equal(telegraphs[0]!.damage, 200);

  const aoe = new AoePacket();
  aoe.pos.x = 30;
  aoe.pos.y = 31;
  aoe.radius = 2;
  aoe.damage = 40;
  aoe.effect = 14; // Paralyzed
  aoe.duration = 0.8;
  aoe.origType = 51058;
  aoe.color = 7;
  aoe.armorPiercing = false;
  invoke(client, 'handleAoe', aoe);

  const recent = internals.aoeThreats.getRecentAoes(1010);
  assert.ok(recent.some((entry) => (
    entry.x === 30
    && entry.repeating === true
    && entry.conditionEffects?.[0]?.effect === 14
  )));
});
