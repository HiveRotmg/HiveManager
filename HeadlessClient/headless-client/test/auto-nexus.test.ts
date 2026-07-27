import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  AutoNexusMonitor,
  calculateAutoNexusDamage,
  isAutoNexusSafeMap,
  predictAutoNexusRouteDamage,
  type AutoNexusTrigger,
} from '../src/auto-nexus';
import type {
  CombatProjectileDefinition,
  CombatProjectileSnapshot,
} from '../src/combat-tracker';

test('autonexus defaults on at ProdMafia\'s 15 percent threshold', () => {
  const triggers: AutoNexusTrigger[] = [];
  const monitor = new AutoNexusMonitor((trigger) => triggers.push(trigger));
  monitor.setSafeMap(false);
  monitor.reconcileServerHp(151, 1000, true);
  monitor.reconcileServerHp(150, 1000);

  assert.equal(triggers.length, 1);
  assert.equal(monitor.getState().enabled, true);
  assert.equal(monitor.getState().thresholdPercent, 15);
});

test('authoritative HP at or below the configured percentage triggers once', () => {
  const triggers: AutoNexusTrigger[] = [];
  const monitor = new AutoNexusMonitor((trigger) => triggers.push(trigger));
  monitor.configure({ enabled: true, thresholdPercent: 25 });
  monitor.setSafeMap(false);
  monitor.reconcileServerHp(251, 1000, true);
  monitor.reconcileServerHp(250, 1000);
  monitor.reconcileServerHp(100, 1000);

  assert.equal(triggers.length, 1);
  assert.equal(triggers[0]?.source, 'server');
  assert.equal(triggers[0]?.hp, 250);
});

test('predicted projectile damage triggers before the server HP update', () => {
  const triggers: AutoNexusTrigger[] = [];
  const monitor = new AutoNexusMonitor((trigger) => triggers.push(trigger));
  monitor.configure({ enabled: true, thresholdPercent: 30 });
  monitor.setSafeMap(false);
  monitor.reconcileServerHp(500, 1000, true);

  assert.equal(monitor.applyDamage(200, 'projectile'), true);
  assert.equal(triggers[0]?.hp, 300);
  assert.equal(triggers[0]?.source, 'projectile');
});

test('predicted ground damage uses the same pre-acknowledgement trigger', () => {
  const triggers: AutoNexusTrigger[] = [];
  const monitor = new AutoNexusMonitor((trigger) => triggers.push(trigger));
  monitor.configure({ enabled: true, thresholdPercent: 20 });
  monitor.setSafeMap(false);
  monitor.reconcileServerHp(250, 1000, true);

  assert.equal(monitor.applyDamage(50, 'ground'), true);
  assert.equal(triggers[0]?.source, 'ground');
  assert.equal(triggers[0]?.hp, 200);
});

test('safe maps suppress triggers and re-arm the monitor for the next dangerous map', () => {
  let count = 0;
  const monitor = new AutoNexusMonitor(() => { count++; });
  monitor.configure({ enabled: true, thresholdPercent: 50 });
  monitor.reconcileServerHp(100, 1000, true);
  assert.equal(count, 0);

  monitor.setSafeMap(false);
  assert.equal(count, 1);
  monitor.setSafeMap(true);
  monitor.reset(800, 1000);
  monitor.setSafeMap(false);
  monitor.applyDamage(400, 'aoe');
  assert.equal(count, 2);
});

test('damage calculation respects defense conditions and minimum damage', () => {
  assert.equal(calculateAutoNexusDamage({ baseDamage: 100, defense: 40 }), 60);
  assert.equal(calculateAutoNexusDamage({ baseDamage: 100, defense: 200 }), 15);
  assert.equal(calculateAutoNexusDamage({ baseDamage: 100, defense: 40, armored: true }), 40);
  assert.equal(calculateAutoNexusDamage({ baseDamage: 100, defense: 40, armorBroken: true }), 100);
  assert.equal(calculateAutoNexusDamage({ baseDamage: 100, defense: 40, invincible: true }), 0);
  assert.equal(calculateAutoNexusDamage({ baseDamage: 100, defense: 40, exposed: true }), 80);
  assert.equal(calculateAutoNexusDamage({ baseDamage: 100, defense: 40, petrified: true }), 54);
  assert.equal(calculateAutoNexusDamage({ baseDamage: 100, defense: 40, cursed: true }), 75);
});

test('zero disables the threshold and values outside zero through one hundred are rejected', () => {
  const monitor = new AutoNexusMonitor(() => {});
  monitor.setThreshold(0);
  assert.equal(monitor.getState().thresholdPercent, 0);
  assert.throws(() => monitor.setThreshold(-1), RangeError);
  assert.throws(() => monitor.setThreshold(101), RangeError);
});

test('ProdMafia safe maps suppress combat-map health checks', () => {
  assert.equal(isAutoNexusSafeMap('Nexus'), true);
  assert.equal(isAutoNexusSafeMap('Guild Hall 5'), true);
  assert.equal(isAutoNexusSafeMap('Daily Login Room'), true);
  assert.equal(isAutoNexusSafeMap('Pet Yard 3'), true);
  assert.equal(isAutoNexusSafeMap('Realm of the Mad God'), false);
});

test('unacknowledged projectile damage expires after ProdMafia\'s 600 ms window', () => {
  let now = 1_000;
  const monitor = new AutoNexusMonitor(() => {}, () => now);
  monitor.setSafeMap(false);
  monitor.reconcileServerHp(500, 1000, true);
  monitor.applyDamage(100, 'projectile');
  assert.equal(monitor.getState().predictedHp, 400);
  assert.equal(monitor.getState().pendingDamage, 100);

  now = 1_599;
  monitor.tick();
  assert.equal(monitor.getState().predictedHp, 400);
  now = 1_600;
  monitor.tick();
  assert.equal(monitor.getState().predictedHp, 500);
  assert.equal(monitor.getState().pendingDamage, 0);
});

test('server HP loss consumes pending damage without charging it twice', () => {
  const monitor = new AutoNexusMonitor(() => {});
  monitor.setSafeMap(false);
  monitor.reconcileServerHp(500, 1000, true);
  monitor.applyDamage(100, 'projectile');
  monitor.reconcileServerHp(400, 1000);

  const state = monitor.getState();
  assert.equal(state.serverHp, 400);
  assert.equal(state.predictedHp, 400);
  assert.equal(state.pendingDamage, 0);
});

test('observed damage margin matches ProdMafia\'s two-second rate and 12 percent cap', () => {
  let now = 10_000;
  const triggers: AutoNexusTrigger[] = [];
  const monitor = new AutoNexusMonitor((trigger) => triggers.push(trigger), () => now);
  monitor.configure({ thresholdPercent: 15, observedDamageMargin: true });
  monitor.setSafeMap(false);
  monitor.reconcileServerHp(250, 1000, true);
  monitor.noteUnattributedDamage(600);

  assert.equal(monitor.getState().unattributedDps, 300);
  assert.equal(monitor.getState().effectiveThresholdHp, 255);
  assert.equal(monitor.tick(), true);
  assert.equal(triggers[0]?.effectiveThresholdHp, 255);
});

test('predictive nexus uses safest-route damage only inside the 180 ms lead window', () => {
  const triggers: AutoNexusTrigger[] = [];
  const monitor = new AutoNexusMonitor((trigger) => triggers.push(trigger));
  monitor.setSafeMap(false);
  monitor.reconcileServerHp(300, 1000, true);

  assert.equal(monitor.checkPredictive({ predictedDamage: 151, impactMs: 181 }), false);
  assert.equal(monitor.checkPredictive({
    predictedDamage: 150,
    impactMs: 180,
    candidate: 3,
    threats: 2,
    decision: 'least_risk',
  }), true);
  assert.equal(triggers[0]?.source, 'predictive');
  assert.equal(triggers[0]?.candidate, 3);
});

test('route prediction counts an unavoidable projectile and rejects one cleared by the safest path', () => {
  const definition: CombatProjectileDefinition = {
    speed: 100,
    lifetimeMs: 1_000,
    multiHit: false,
    passesCover: false,
    amplitude: 0,
    frequency: 1,
    magnitude: 0,
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
  const shot: CombatProjectileSnapshot = {
    side: 'enemy',
    bulletId: 1,
    bulletType: 0,
    ownerId: 2,
    containerType: 3,
    startX: -1,
    startY: 0,
    angle: 0,
    startTime: 1_000,
    definition,
    damage: 100,
    hitObjects: new Set(),
  };
  const common = {
    now: 1_000,
    playerId: 1,
    position: { x: 0, y: 0 },
    projectiles: [shot],
    aoes: [],
    calculateDamage: (damage: number) => damage,
  };

  assert.deepEqual(predictAutoNexusRouteDamage({
    ...common,
    trajectory: null,
  }), { predictedDamage: 100, impactMs: 40 });
  assert.deepEqual(predictAutoNexusRouteDamage({
    ...common,
    trajectory: {
      createdAt: 1_000,
      waypoints: [{ timeOffsetMs: 180, x: 0, y: 2, speed: 0.01 }],
    },
  }), { predictedDamage: 0, impactMs: -1 });
});

test('route prediction includes learned thrown-AOE damage inside the lead window', () => {
  const result = predictAutoNexusRouteDamage({
    now: 1_000,
    playerId: 1,
    position: { x: 0, y: 0 },
    trajectory: null,
    projectiles: [],
    aoes: [{
      x: 0,
      y: 0,
      radius: 1,
      landingTime: 1_120,
      damage: 75,
      armorPiercing: true,
    }],
    calculateDamage: (damage, armorPiercing) => damage + (armorPiercing ? 1 : 0),
  });
  assert.deepEqual(result, { predictedDamage: 76, impactMs: 120 });
});
