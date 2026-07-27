import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Classes, type PlayerData } from 'realmlib';
import {
  AutoCombatController,
  PRODMAFIA_AUTO_ABILITY_DEFAULTS,
  TOMB_BOSS_CYCLE,
  type AutoAbilityOptions,
  type AutoCombatSnapshot,
} from '../src/auto-combat';
import type {
  CombatDataProvider,
  CombatObjectDefinition,
  CombatProjectileDefinition,
} from '../src/combat-tracker';

const projectile: CombatProjectileDefinition = {
  speed: 100,
  lifetimeMs: 1_000,
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

test('auto aim prioritizes a visible boss and supports maxHp selection', () => {
  const controller = new AutoCombatController(data());
  const shots: Array<{ x: number; y: number }> = [];
  controller.enableAutoAim({ leadTargets: false });
  controller.update(1_000, snapshot(), {
    shootAt: (target) => { shots.push(target); return true; },
    useAbilityAt: () => false,
  });
  assert.deepEqual(shots[0], { x: 7, y: 0 });
  assert.equal(controller.getState().targetObjectId, 3);

  controller.configureAutoAim({ mode: 'maxHp', bossPriority: false, leadTargets: false });
  controller.update(1_100, snapshot(), {
    shootAt: (target) => { shots.push(target); return true; },
    useAbilityAt: () => false,
  });
  assert.deepEqual(shots[1], { x: 5, y: 0 });
  assert.equal(controller.getState().targetObjectId, 2);
});

test('ProdMafia boss priority includes every Quest target, not only high-HP quests', () => {
  const provider = data();
  const objects = providerObjects(provider);
  objects.set(104, { isEnemy: true, occupySquare: false, maxHp: 50, quest: true });
  const controller = new AutoCombatController(provider);
  const state = snapshot();
  state.objects = [
    { objectId: 1, type: 101, x: 2, y: 0, rawStats: { '0': 1_000, '1': 900 } },
    { objectId: 4, type: 104, x: 4, y: 0, rawStats: { '0': 50, '1': 50 } },
  ];
  const shots: Array<{ x: number; y: number }> = [];
  controller.enableAutoAim({ leadTargets: false });
  controller.update(1_000, state, {
    shootAt: (target) => { shots.push(target); return true; },
    useAbilityAt: () => false,
  });
  assert.deepEqual(shots, [{ x: 4, y: 0 }]);
  assert.equal(controller.getState().targetObjectId, 4);
});

test('closestToAim reproduces ProdMafia cursor-mode bounding selection', () => {
  const controller = new AutoCombatController(data());
  const shots: Array<{ x: number; y: number }> = [];
  controller.enableAutoAim({
    mode: 'closestToAim',
    aimPoint: { x: 5.1, y: 0 },
    boundingDistance: 2,
    bossPriority: false,
    leadTargets: false,
  });
  controller.update(1_000, snapshot(), {
    shootAt: (target) => { shots.push(target); return true; },
    useAbilityAt: () => false,
  });
  assert.deepEqual(shots, [{ x: 5, y: 0 }]);
  assert.equal(controller.getState().targetObjectId, 2);
});

test('ProdMafia target filters skip walls and honour ignored/exception type lists', () => {
  const provider = data();
  const objects = providerObjects(provider);
  objects.set(104, { isEnemy: true, occupySquare: true, isCharacter: false, maxHp: 9_999 });
  objects.set(105, { isEnemy: true, occupySquare: false, isCharacter: true, maxHp: 400 });
  const state = snapshot();
  state.objects = [
    { objectId: 4, type: 104, x: 1, y: 0, rawStats: { '0': 9_999, '1': 9_999 } },
    { objectId: 1, type: 101, x: 2, y: 0, rawStats: { '0': 1_000, '1': 900 } },
    { objectId: 5, type: 105, x: 3, y: 0, rawStats: { '0': 400, '1': 400 } },
  ];
  const shots: Array<{ x: number; y: number }> = [];
  const controller = new AutoCombatController(provider);
  controller.enableAutoAim({ leadTargets: false, bossPriority: false, ignoredTypes: [101] });
  controller.update(1_000, state, {
    shootAt: (target) => { shots.push(target); return true; },
    useAbilityAt: () => false,
  });
  assert.deepEqual(shots, [{ x: 3, y: 0 }], 'the nearer wall and ignored enemy are skipped');

  controller.configureAutoAim({ onlyExcepted: true, exceptedTypes: [101], includeIgnored: true });
  controller.update(1_100, state, {
    shootAt: (target) => { shots.push(target); return true; },
    useAbilityAt: () => false,
  });
  assert.deepEqual(shots[1], { x: 2, y: 0 });
});

test('fixed target overrides automatic selection until aiming stops', () => {
  const controller = new AutoCombatController(data());
  const shots: Array<{ x: number; y: number }> = [];
  assert.equal(controller.aimAt(1), true);
  controller.update(1_000, snapshot(), {
    shootAt: (target) => { shots.push(target); return true; },
    useAbilityAt: () => false,
  });
  assert.deepEqual(shots[0], { x: 2, y: 0 });
  controller.stopAiming();
  controller.update(1_100, snapshot(), {
    shootAt: (target) => { shots.push(target); return true; },
    useAbilityAt: () => false,
  });
  assert.equal(shots.length, 1);
});

test('target leading expires velocity after an enemy stops moving', () => {
  const controller = new AutoCombatController(data());
  const shots: Array<{ x: number; y: number }> = [];
  const state = snapshot();
  const enemy = { objectId: 1, type: 101, x: 2, y: 0, rawStats: { '0': 1_000, '1': 900 } };
  state.objects = [enemy];
  controller.enableAutoAim({ bossPriority: false, leadTargets: true });
  const actions = {
    shootAt: (target: { x: number; y: number }) => { shots.push(target); return true; },
    useAbilityAt: () => false,
  };

  controller.update(1_000, state, actions);
  enemy.x = 3;
  controller.update(1_200, state, actions);
  controller.update(2_000, state, actions);

  assert.ok(shots[1]!.x > 3);
  assert.deepEqual(shots[2], { x: 3, y: 0 });
});

test('target leading uses the player projectile speed multiplier', () => {
  const normal = movingTargetShot(projectile, 1);
  const accelerated = movingTargetShot(projectile, 2);

  assert.ok(normal.y > accelerated.y);
  assert.ok(accelerated.y > 1);
});

test('target leading accounts for projectile acceleration', () => {
  const constant = movingTargetShot({ ...projectile, speed: 100, lifetimeMs: 1_500 }, 1);
  const accelerating = movingTargetShot({
    ...projectile,
    speed: 100,
    lifetimeMs: 1_500,
    acceleration: 200,
    accelerationDelay: 0,
    speedClamp: 300,
  }, 1);

  assert.ok(constant.y > accelerating.y);
  assert.ok(accelerating.y > 1);
});

test('ProdMafia auto aim uses only the weapon first-projectile definition', () => {
  const provider = data();
  const requestedProjectileIds: number[] = [];
  provider.getProjectile = (type, id) => {
    if (type !== 1_000) return undefined;
    requestedProjectileIds.push(id);
    return id === 0 || id === 2 ? projectile : undefined;
  };
  const controller = new AutoCombatController(provider);
  const state = snapshot();
  state.objects = [
    { objectId: 1, type: 101, x: 5, y: 0, rawStats: { '0': 1_000, '1': 900 } },
  ];
  const shots: Array<{ x: number; y: number }> = [];
  controller.enableAutoAim({ bossPriority: false, leadTargets: true });
  controller.update(1_000, state, {
    previewWeaponAim: () => ({
      projectileId: 2,
      bulletId: 6,
      angleOffset: Math.PI / 6,
      spawnDistance: 0.3,
      spawnOffsetX: 0.2,
    }),
    shootAt: (target) => { shots.push(target); return true; },
    useAbilityAt: () => false,
  });

  assert.deepEqual(requestedProjectileIds, [0]);
  const baseAngle = Math.atan2(shots[0]!.y, shots[0]!.x);
  assert.equal(baseAngle, 0);
});

test('auto ability skips teleport abilities unless explicitly allowed', () => {
  const controller = new AutoCombatController(data(true));
  let uses = 0;
  controller.enableAutoAbility({ minMpPercent: 50 });
  controller.update(1_000, snapshot(), {
    shootAt: () => false,
    useAbilityAt: () => { uses++; return true; },
  });
  assert.equal(uses, 0);

  controller.configureAutoAbility({ allowTeleport: true });
  controller.update(2_000, snapshot(), {
    shootAt: () => false,
    useAbilityAt: () => { uses++; return true; },
  });
  assert.equal(uses, 1);
});

/** Oryx the Mad God 3, source `Player.as:2610`. */
const ORYX3_TYPE = 0xb133;

test('auto aim stops firing at Oryx 3 while his guard sprite is up', () => {
  const provider = data();
  const objects = providerObjects(provider);
  objects.set(ORYX3_TYPE, { isEnemy: true, occupySquare: false, maxHp: 200_000, boss: true });
  const controller = new AutoCombatController(provider);
  const state = snapshot();
  const oryx = {
    objectId: 9,
    type: ORYX3_TYPE,
    x: 3,
    y: 0,
    // Non-player objects carry their alt-texture id in the BXP stat slot.
    rawStats: { '0': 200_000, '1': 200_000, '61': 0 } as Record<string, number>,
  };
  state.objects = [oryx];
  const shots: Array<{ x: number; y: number }> = [];
  const actions = {
    shootAt: (target: { x: number; y: number }) => { shots.push(target); return true; },
    useAbilityAt: () => false,
  };

  controller.enableAutoAim({ leadTargets: false, o3GuardAltTextureIds: [7] });
  controller.update(1_000, state, actions);
  assert.equal(shots.length, 1, 'O3 is a normal target outside the guard');

  oryx.rawStats['61'] = 7;
  controller.update(1_100, state, actions);
  assert.equal(shots.length, 1, 'the guard sprite suppresses further shots');
  assert.equal(controller.getState().targetObjectId, null);

  controller.configureAutoAim({ avoidO3Shield: false });
  controller.update(1_200, state, actions);
  assert.equal(shots.length, 2, 'the suppression is opt-out');
});

test('the O3 guard filter stays inert until the guard sprite ids are known', () => {
  const provider = data();
  const objects = providerObjects(provider);
  objects.set(ORYX3_TYPE, { isEnemy: true, occupySquare: false, maxHp: 200_000, boss: true });
  const controller = new AutoCombatController(provider);
  const state = snapshot();
  state.objects = [
    { objectId: 9, type: ORYX3_TYPE, x: 3, y: 0, rawStats: { '0': 200_000, '1': 200_000, '61': 7 } },
  ];
  const shots: Array<{ x: number; y: number }> = [];

  controller.enableAutoAim({ leadTargets: false });
  assert.equal(controller.getState().autoAim.avoidO3Shield, true);
  controller.update(1_000, state, {
    shootAt: (target) => { shots.push(target); return true; },
    useAbilityAt: () => false,
  });
  assert.deepEqual(shots, [{ x: 3, y: 0 }]);
});

test('the Tomb cycle rotates Bes, Nut then Geb and ignores the other two bosses', () => {
  const controller = new AutoCombatController(data());

  assert.deepEqual(TOMB_BOSS_CYCLE.map((phase) => phase.name), ['Bes', 'Nut', 'Geb']);
  assert.equal(controller.getTombBoss(), null);

  const names = [
    controller.cycleTombBoss().name,
    controller.cycleTombBoss().name,
    controller.cycleTombBoss().name,
    controller.cycleTombBoss().name,
  ];
  assert.deepEqual(names, ['Bes', 'Nut', 'Geb', 'Bes'], 'the rotation wraps back to Bes');
  assert.equal(controller.getState().tombBoss, 'Bes');
  // Bes is attackable, so only the Attacker and Defender pairs stay ignored.
  assert.deepEqual([...controller.getState().autoAim.ignoredTypes].sort((a, b) => a - b),
    [3367, 3368, 32693, 32694]);

  controller.clearTombBossCycle();
  assert.deepEqual(controller.getState().autoAim.ignoredTypes, []);
  assert.equal(controller.getState().tombBoss, null);
});

test('the Tomb cycle keeps auto aim on the one attackable boss', () => {
  const provider = data();
  const objects = providerObjects(provider);
  for (const type of [3366, 3367, 3368]) {
    objects.set(type, { isEnemy: true, occupySquare: false, maxHp: 40_000, boss: true });
  }
  const controller = new AutoCombatController(provider);
  const state = snapshot();
  state.objects = [
    { objectId: 6, type: 3366, x: 6, y: 0, rawStats: { '0': 40_000, '1': 40_000 } },
    { objectId: 7, type: 3367, x: 4, y: 0, rawStats: { '0': 40_000, '1': 40_000 } },
    { objectId: 8, type: 3368, x: 2, y: 0, rawStats: { '0': 40_000, '1': 40_000 } },
  ];
  const shots: Array<{ x: number; y: number }> = [];
  const actions = {
    shootAt: (target: { x: number; y: number }) => { shots.push(target); return true; },
    useAbilityAt: () => false,
  };
  controller.enableAutoAim({ leadTargets: false });

  controller.cycleTombBoss();
  controller.update(1_000, state, actions);
  assert.deepEqual(shots[0], { x: 6, y: 0 }, 'Bes, despite the other two being closer');

  controller.cycleTombBoss();
  controller.update(1_100, state, actions);
  assert.deepEqual(shots[1], { x: 4, y: 0 }, 'Nut');

  controller.cycleTombBoss();
  controller.update(1_200, state, actions);
  assert.deepEqual(shots[2], { x: 2, y: 0 }, 'Geb');

  // Source `damageIgnored`: including ignored types releases the whole rotation.
  controller.configureAutoAim({ includeIgnored: true });
  controller.update(1_300, state, actions);
  assert.deepEqual(shots[3], { x: 2, y: 0 }, 'the closest boss wins once nothing is ignored');
});

test('the single-target HP threshold only gates spellbomb-style classes', () => {
  assert.deepEqual(abilityTarget(Classes.Wizard, {}), { x: 7, y: 0 });
  assert.deepEqual(
    abilityTarget(Classes.Wizard, { singleTargetHpThreshold: 9_000 }),
    { x: 5, y: 0 },
    'the 8k quest boss is below the threshold, so the 20k enemy is taken',
  );
  assert.deepEqual(abilityTarget(Classes.Archer, { singleTargetHpThreshold: 9_000 }), { x: 5, y: 0 });
  assert.deepEqual(abilityTarget(Classes.Knight, { singleTargetHpThreshold: 9_000 }), { x: 5, y: 0 });
  assert.deepEqual(
    abilityTarget(Classes.Priest, { singleTargetHpThreshold: 9_000 }),
    { x: 7, y: 0 },
    'a class with no single-target ability keeps the generic path',
  );
});

test('the AoE HP threshold is separate from the single-target one', () => {
  // A low-HP quest boss the thresholds reject, and a plain enemy they accept.
  const mixed = [
    { objectId: 1, type: 103, x: 1, y: 0, rawStats: { '0': 500, '1': 500 } },
    { objectId: 2, type: 101, x: 5, y: 0, rawStats: { '0': 5_000, '1': 5_000 } },
  ];

  assert.deepEqual(abilityTarget(Classes.Sorcerer, { aoeHpThreshold: 1_000 }, mixed), { x: 5, y: 0 });
  assert.deepEqual(
    abilityTarget(Classes.Sorcerer, { singleTargetHpThreshold: 1_000 }, mixed),
    { x: 1, y: 0 },
    'the Sorcerer scepter reads the AoE threshold only',
  );
  assert.deepEqual(abilityTarget(Classes.Wizard, { singleTargetHpThreshold: 1_000 }, mixed), { x: 5, y: 0 });
  assert.deepEqual(
    abilityTarget(Classes.Wizard, { aoeHpThreshold: 1_000 }, mixed),
    { x: 1, y: 0 },
    'the spellbomb reads the single-target threshold only',
  );
});

test('AoE classes fire at the biggest enemy cluster instead of one target', () => {
  const clustered = [
    { objectId: 1, type: 101, x: 5, y: 0, rawStats: { '0': 1_000, '1': 900 } },
    { objectId: 2, type: 101, x: 5.5, y: 0, rawStats: { '0': 1_000, '1': 900 } },
    { objectId: 3, type: 101, x: 6, y: 0, rawStats: { '0': 1_000, '1': 900 } },
    { objectId: 4, type: 103, x: 1, y: 0, rawStats: { '0': 8_000, '1': 8_000 } },
  ];
  const options = { aoeMinTargets: 2, aoeRadius: 2 };

  for (const playerClass of [Classes.Necromancer, Classes.Assassin, Classes.Huntress]) {
    assert.deepEqual(abilityTarget(playerClass, options, clustered), { x: 5, y: 0 },
      'the lone 8k quest boss loses to the cluster of three');
  }
  assert.deepEqual(
    abilityTarget(Classes.Wizard, options, clustered),
    { x: 1, y: 0 },
    'a Wizard keeps single-target boss priority',
  );
});

test('a cluster must strictly exceed the minimum target count', () => {
  const pair = [
    { objectId: 1, type: 101, x: 5, y: 0, rawStats: { '0': 1_000, '1': 900 } },
    { objectId: 2, type: 101, x: 5.5, y: 0, rawStats: { '0': 1_000, '1': 900 } },
  ];
  assert.deepEqual(abilityTarget(Classes.Necromancer, { aoeMinTargets: 1, aoeRadius: 2 }, pair),
    { x: 5, y: 0 });
  assert.deepEqual(
    abilityTarget(Classes.Necromancer, { aoeMinTargets: 2, aoeRadius: 2 }, pair),
    { x: 0, y: 0 },
    'the Necromancer still raises its summons in place when no cluster qualifies',
  );
  assert.equal(
    abilityTarget(Classes.Assassin, { aoeMinTargets: 2, aoeRadius: 2 }, pair),
    null,
    'the other AoE classes simply hold',
  );
});

test('the AoE HP threshold also filters cluster members', () => {
  const mixed = [
    { objectId: 1, type: 101, x: 5, y: 0, rawStats: { '0': 1_000, '1': 900 } },
    { objectId: 2, type: 101, x: 5.5, y: 0, rawStats: { '0': 1_000, '1': 900 } },
    { objectId: 3, type: 102, x: 6, y: 0, rawStats: { '0': 20_000, '1': 20_000 } },
  ];
  assert.deepEqual(abilityTarget(Classes.Huntress, { aoeMinTargets: 2, aoeRadius: 2 }, mixed),
    { x: 5, y: 0 });
  assert.equal(
    abilityTarget(Classes.Huntress, { aoeMinTargets: 2, aoeRadius: 2, aoeHpThreshold: 8_000 }, mixed),
    null,
    'only the 20k enemy clears the threshold, leaving a cluster of one',
  );
});

test('the Mystic only stasises groups when asked to', () => {
  const clustered = [
    { objectId: 1, type: 101, x: 5, y: 0, rawStats: { '0': 1_000, '1': 900 } },
    { objectId: 2, type: 101, x: 5.5, y: 0, rawStats: { '0': 1_000, '1': 900 } },
    { objectId: 3, type: 101, x: 6, y: 0, rawStats: { '0': 1_000, '1': 900 } },
    { objectId: 4, type: 103, x: 1, y: 0, rawStats: { '0': 8_000, '1': 8_000 } },
  ];
  const options = { aoeMinTargets: 2, aoeRadius: 2 };

  assert.deepEqual(
    abilityTarget(Classes.Mystic, { ...options, mysticStasisGroup: true }, clustered),
    { x: 5, y: 0 },
    'the orb targets the group',
  );
  assert.deepEqual(
    abilityTarget(Classes.Mystic, options, clustered),
    { x: 1, y: 0 },
    'group stasis is off by default, so the generic boss-priority path stands',
  );
});

test('Trickster prisms are spammed in place once enough enemies are near', () => {
  // The default snapshot holds three enemies, all inside the 15 tile radius.
  assert.equal(abilityTarget(Classes.Trickster, { spamPrismTargets: 3 }), null,
    'the count must strictly exceed the configured number');
  assert.deepEqual(abilityTarget(Classes.Trickster, { spamPrismTargets: 2 }), { x: 0, y: 0 },
    'the prism is thrown at the player, never led at a target');
  assert.deepEqual(
    abilityTarget(Classes.Trickster, {}),
    { x: 7, y: 0 },
    'zero leaves the generic targeted path untouched',
  );
});

test('prism spam never fires a teleporting prism, even with teleports allowed', () => {
  assert.equal(
    abilityTarget(Classes.Trickster, { spamPrismTargets: 1, allowTeleport: true }, undefined, true),
    null,
  );
  assert.deepEqual(
    abilityTarget(Classes.Trickster, { allowTeleport: true }, undefined, true),
    { x: 7, y: 0 },
    'the ordinary teleport path is unaffected',
  );
});

test('the ProdMafia ability defaults stay opt-in', () => {
  const controller = new AutoCombatController(data());
  const shipped = controller.getState().autoAbility;

  assert.equal(shipped.singleTargetHpThreshold, 0);
  assert.equal(shipped.aoeHpThreshold, 0);
  assert.equal(shipped.aoeMinTargets, 0);
  assert.equal(shipped.spamPrismTargets, 0);
  assert.equal(shipped.mysticStasisGroup, false);

  controller.configureAutoAbility(PRODMAFIA_AUTO_ABILITY_DEFAULTS);
  assert.deepEqual(controller.getState().autoAbility, {
    ...shipped,
    ...PRODMAFIA_AUTO_ABILITY_DEFAULTS,
  });

  // The source choice lists cap these at 20000, 8000 and 10 respectively.
  controller.configureAutoAbility({
    singleTargetHpThreshold: 999_999,
    aoeHpThreshold: 999_999,
    aoeMinTargets: 99,
    spamPrismTargets: 99,
  });
  const clamped = controller.getState().autoAbility;
  assert.equal(clamped.singleTargetHpThreshold, 20_000);
  assert.equal(clamped.aoeHpThreshold, 8_000);
  assert.equal(clamped.aoeMinTargets, 10);
  assert.equal(clamped.spamPrismTargets, 10);
});

/**
 * Runs one auto ability frame for `playerClass` and returns where the ability
 * was aimed, or null when the class path declined to fire.
 */
function abilityTarget(
  playerClass: Classes,
  options: AutoAbilityOptions,
  objects?: AutoCombatSnapshot['objects'],
  teleport = false,
): { x: number; y: number } | null {
  const controller = new AutoCombatController(data(teleport));
  const state = snapshot();
  state.player!.class = playerClass;
  if (objects) state.objects = objects;
  const uses: Array<{ x: number; y: number }> = [];
  controller.configureAutoAim({ leadTargets: false });
  controller.enableAutoAbility(options);
  controller.update(1_000, state, {
    shootAt: () => false,
    useAbilityAt: (target) => { uses.push(target); return true; },
  });
  return uses[0] ?? null;
}

function data(teleport = false): CombatDataProvider {
  const objects = new Map<number, CombatObjectDefinition>([
    [1_000, { isEnemy: false, occupySquare: false, rateOfFire: 1 }],
    [2_000, {
      isEnemy: false,
      occupySquare: false,
      usable: true,
      mpCost: 50,
      cooldownMs: 550,
      activateEffects: teleport ? ['Teleport'] : ['Shoot'],
    }],
    [101, { isEnemy: true, occupySquare: false, maxHp: 1_000 }],
    [102, { isEnemy: true, occupySquare: false, maxHp: 20_000 }],
    [103, { isEnemy: true, occupySquare: false, maxHp: 8_000, quest: true }],
  ]);
  return {
    getObject: (type) => objects.get(type),
    getProjectile: (type, id) => (type === 1_000 || type === 2_000) && id === 0 ? projectile : undefined,
  };
}

function providerObjects(provider: CombatDataProvider): Map<number, CombatObjectDefinition> {
  // Test providers intentionally use this small in-memory catalog. Keep the
  // production-facing interface read-only while allowing focused target tests
  // to add exactly the object definitions they exercise.
  const getObject = provider.getObject;
  const known = new Map<number, CombatObjectDefinition>();
  for (const type of [1_000, 2_000, 101, 102, 103]) {
    const definition = getObject(type);
    if (definition) known.set(type, definition);
  }
  provider.getObject = (type) => known.get(type);
  return known;
}

function snapshot(): AutoCombatSnapshot {
  const player = {
    inventory: [1_000, 2_000],
    mp: 100,
    maxMP: 100,
    condition: 0,
    condition2: 0,
  } as PlayerData;
  return {
    inWorld: true,
    safeMap: false,
    player,
    playerPos: { x: 0, y: 0 },
    objects: [
      { objectId: 1, type: 101, x: 2, y: 0, rawStats: { '0': 1_000, '1': 900 } },
      { objectId: 2, type: 102, x: 5, y: 0, rawStats: { '0': 20_000, '1': 10_000 } },
      { objectId: 3, type: 103, x: 7, y: 0, rawStats: { '0': 8_000, '1': 7_000 } },
    ],
  };
}

function movingTargetShot(
  shotProjectile: CombatProjectileDefinition,
  speedMultiplier: number,
): { x: number; y: number } {
  const provider = data();
  provider.getProjectile = (type, id) => type === 1_000 && id === 0 ? shotProjectile : undefined;
  const controller = new AutoCombatController(provider);
  const enemy = { objectId: 1, type: 101, x: 5, y: 0, rawStats: { '0': 1_000, '1': 900 } };
  const state = snapshot();
  state.player!.projSpeedMult = speedMultiplier;
  state.player!.projLifeMult = 1;
  state.objects = [enemy];
  const shots: Array<{ x: number; y: number }> = [];
  const actions = {
    shootAt: (target: { x: number; y: number }) => { shots.push(target); return true; },
    useAbilityAt: () => false,
  };
  controller.enableAutoAim({ bossPriority: false, leadTargets: true });
  controller.update(1_000, state, actions);
  enemy.y = 1;
  controller.update(1_200, state, actions);
  return shots[1]!;
}
