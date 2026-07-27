import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ALT_TEXTURE_STAT,
  O3GuardObserver,
  ORYX3_TYPE,
  conditionNames,
  isSilenced,
} from '../src/o3-guard';
import { parseAltTextureIds } from '../src/plugins/o3-guard-capture';
import { ConditionEffectBits2, StatType } from 'realmlib';

test('O3 type and ALT_TEXTURE_STAT match ProdMafia Player.as / StatData.as', () => {
  assert.equal(ORYX3_TYPE, 0xb133);
  assert.equal(ALT_TEXTURE_STAT, StatType.BXP_STAT);
});

test('parseAltTextureIds accepts comma lists and drops junk', () => {
  assert.deepEqual(parseAltTextureIds('7, 9, 7, -1, foo'), [7, 9]);
  assert.deepEqual(parseAltTextureIds(''), []);
});

test('condition helpers expose Silence and named bits', () => {
  assert.equal(isSilenced(ConditionEffectBits2.SILENCED), true);
  assert.equal(isSilenced(0), false);
  assert.ok(conditionNames(0, ConditionEffectBits2.SILENCED).includes('SILENCED'));
});

test('observer records damageRegistering from our hits vs HP movement', () => {
  const observer = new O3GuardObserver({
    stallMs: 1_000,
    minHits: 3,
    hitSettleMs: 100,
  });
  const base = {
    objectId: 42,
    hp: 100_000,
    maxHp: 100_000,
    altTexture: 0,
    condition: 0,
    condition2: 0,
    x: 1,
    y: 2,
  };

  let t = 1_000;
  observer.observe(t, base);
  observer.onEnemyHit(t + 10, 42);
  observer.onEnemyHit(t + 20, 42);
  const drop = observer.observe(t + 200, { ...base, hp: 99_500 });
  assert.equal(drop.damageRegistering, true);
  assert.equal(drop.hpDelta, -500);
  assert.equal(drop.damageBlocked, false);

  // Fresh fight episode on a single alt texture so the stall is attributable.
  observer.clear();
  t = 5_000;
  observer.observe(t, { ...base, hp: 99_500, altTexture: 7 });
  for (let i = 0; i < 4; i++) observer.onEnemyHit(t + i * 50, 42);
  const stalled = observer.observe(t + 1_500, { ...base, hp: 99_500, altTexture: 7 });
  assert.equal(stalled.damageBlocked, true);
  assert.equal(stalled.damageRegistering, false);
  assert.equal(stalled.altTexture, 7);
  assert.ok(stalled.settledHits >= 3);

  const status = observer.status();
  assert.equal(status.seen, true);
  assert.deepEqual(status.stallHintAltTextureIds, [7]);
});

test('hits against unknown object ids are ignored', () => {
  const observer = new O3GuardObserver();
  observer.onEnemyHit(1, 99);
  assert.equal(observer.status().totalHits, 0);
});

test('clear forgets fight state but parse helpers stay pure', () => {
  const observer = new O3GuardObserver({ stallMs: 100, minHits: 1, hitSettleMs: 0 });
  observer.observe(1, {
    objectId: 1,
    hp: 10,
    maxHp: 10,
    altTexture: 3,
    condition: 0,
    condition2: 0,
    x: 0,
    y: 0,
  });
  observer.onEnemyHit(2, 1);
  observer.observe(200, {
    objectId: 1,
    hp: 10,
    maxHp: 10,
    altTexture: 3,
    condition: 0,
    condition2: 0,
    x: 0,
    y: 0,
  });
  assert.equal(observer.status().seen, true);
  observer.clear();
  assert.equal(observer.status().seen, false);
  assert.deepEqual(observer.status().stallHintAltTextureIds, []);
});
