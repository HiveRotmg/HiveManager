import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MovementController, movementSpeed } from '../src/movement-controller';
import { createStaticPassabilityStore } from '../src/static-passability-store';

const SINK_TILE = 40;
const NOWALK_SINK_TILE = 41;
const PLAIN_TILE = 42;
const DAMAGING_TILE = 43;

/**
 * Mirrors GameDataLoader after the Sink fix: `<Sink />` no longer participates in
 * tileIsBlockingWalk, which reports `<NoWalk />` only (ProdMafia Square.as:154-156).
 */
const tileData = {
  tileIsBlockingWalk: (type: number) => type === NOWALK_SINK_TILE,
  tileIsSink: (type: number) => type === SINK_TILE || type === NOWALK_SINK_TILE,
  getTileDamage: (type: number) => (type === DAMAGING_TILE ? 100 : 0),
};

test('a Sink tile without NoWalk is walkable unless safeWalk asks to avoid it', () => {
  const store = createStaticPassabilityStore(tileData);
  store.setMapBounds(8, 8);
  store.observeTile(3, 3, SINK_TILE);

  assert.equal(
    store.isTileStaticallyBlocked(3, 3, { consumer: 'dodge', safeWalk: false }),
    false,
    'water and lava-floor tiles must be steppable, as they are in ProdMafia',
  );
  assert.equal(
    store.isTileStaticallyBlocked(3, 3, { consumer: 'dodge', safeWalk: true }),
    true,
    'safeWalk still prefers to keep the body out of the water',
  );
});

test('Sink participates in pathfinding reachability instead of walling the map off', () => {
  const store = createStaticPassabilityStore(tileData);
  store.setMapBounds(8, 8);
  store.observeTile(3, 3, SINK_TILE);
  store.observeTile(4, 4, NOWALK_SINK_TILE);

  assert.equal(
    store.isTileStaticallyBlocked(3, 3, { consumer: 'pathfinding' }),
    false,
    'the 205 Sink-but-not-NoWalk ground types are routable terrain',
  );
  assert.equal(
    store.isTileStaticallyBlocked(4, 4, { consumer: 'pathfinding' }),
    true,
    'the 27 types that also carry NoWalk stay impassable',
  );
});

test('damaging ground keeps its existing safeWalk semantics after the Sink change', () => {
  const store = createStaticPassabilityStore(tileData);
  store.setMapBounds(8, 8);
  store.observeTile(2, 2, DAMAGING_TILE);
  store.observeTile(1, 1, PLAIN_TILE);

  assert.equal(store.isTileStaticallyBlocked(2, 2, { consumer: 'dodge', safeWalk: false }), false);
  assert.equal(store.isTileStaticallyBlocked(2, 2, { consumer: 'dodge', safeWalk: true }), true);
  assert.equal(store.isTileStaticallyBlocked(1, 1, { consumer: 'dodge', safeWalk: true }), false);
});

test('pathfinding can price Abyss lava instead of walling it under hazardTraversal cost', () => {
  const ABYSS_LAVA = 44;
  const store = createStaticPassabilityStore({
    ...tileData,
    tileIsSink: (type: number) => type === SINK_TILE || type === ABYSS_LAVA,
    getTileDamage: (type: number) => {
      if (type === DAMAGING_TILE) return 100;
      if (type === ABYSS_LAVA) return 60;
      return 0;
    },
  });
  store.setMapBounds(8, 8);
  store.observeTile(2, 2, ABYSS_LAVA);
  store.observeTile(3, 3, SINK_TILE);

  assert.equal(
    store.isTileStaticallyBlocked(2, 2, { consumer: 'pathfinding' }),
    true,
    'default pathfinding still walls MaxDamage floors',
  );
  assert.equal(
    store.isTileStaticallyBlocked(2, 2, { consumer: 'pathfinding', hazardTraversal: 'cost' }),
    false,
    'cost policy opens lava for a priced crossing',
  );
  assert.equal(
    store.isTileStaticallyBlocked(3, 3, { consumer: 'pathfinding' }),
    false,
    'pure Sink stays walkable without opting into cost',
  );
  assert.ok(
    store.getTileTraversalPenalty(2, 2) > store.getTileTraversalPenalty(3, 3),
    'MaxDamage=60 lava costs more than undamaging Sink water',
  );
  assert.equal(
    store.isTileStaticallyBlocked(2, 2, { consumer: 'dodge', safeWalk: true }),
    true,
    'dodge safeWalk is unchanged',
  );
});

/**
 * ProdMafia Player.as:4215-4217 —
 * `moveMultiplier_ = 0.1 + (1 - sinkLevel / 18) * (speed_ - 0.1)`.
 */
function sinkingSpeedMultiplier(tileSpeed: number, sinkLevel: number): number {
  const level = Math.min(18, Math.max(0, sinkLevel));
  return 0.1 + (1 - level / 18) * (tileSpeed - 0.1);
}

test('sinking decay walks from the tile speed down to 0.1 over 18 moves', () => {
  // Quicksand, <Speed>0.6</Speed>.
  assert.equal(sinkingSpeedMultiplier(0.6, 0), 0.6);
  assert.ok(Math.abs(sinkingSpeedMultiplier(0.6, 9) - 0.35) < 1e-9, 'half sunk is the midpoint');
  assert.ok(Math.abs(sinkingSpeedMultiplier(0.6, 18) - 0.1) < 1e-9, 'fully sunk floors at 0.1');
  assert.ok(
    Math.abs(sinkingSpeedMultiplier(0.6, 25) - sinkingSpeedMultiplier(0.6, 18)) < 1e-9,
    'the level is capped, so deeper moves cannot slow the player further',
  );

  // The decay is monotonic, and never below the 0.1 floor even for a 1.0 tile.
  let previous = Infinity;
  for (let level = 0; level <= 18; level++) {
    const value = sinkingSpeedMultiplier(1, level);
    assert.ok(value < previous, `level ${level} must be slower than ${level - 1}`);
    assert.ok(value >= 0.1 - 1e-9, `level ${level} must not fall through the floor`);
    previous = value;
  }
});

test('a fully sunk player moves a fraction of the speed the dodge would command', () => {
  const base = {
    localPos: { x: 0, y: 0 },
    playerSpeed: 75,
    playerSpeedBoost: 0,
  };
  const dry = movementSpeed({ ...base, tileSpeed: 1 });
  const sunk = movementSpeed({ ...base, tileSpeed: sinkingSpeedMultiplier(0.6, 18) });

  assert.ok(sunk < dry * 0.11, 'quicksand at full depth is roughly a tenth of dry-land speed');
});

test('ice retains momentum and only blends the commanded direction in slowly', () => {
  const movement = new MovementController();
  const slideAmount = 0.95;
  movement.setTarget({ x: 100, y: 0 }, 0.1);

  const snapshot = (pos: { x: number; y: number }) => ({
    localPos: pos,
    playerSpeed: 75,
    playerSpeedBoost: 0,
    tileSpeed: 1,
    tileSlideAmount: slideAmount,
  });

  // Starting from rest, the first frame may only apply 1 - slideAmount of the
  // command, so the body accelerates instead of snapping to full speed.
  const topSpeed = movementSpeed(snapshot({ x: 0, y: 0 }));
  const first = movement.update(snapshot({ x: 0, y: 0 }), 16, { integrateFromLocal: true });
  const firstSpeed = Math.hypot(first.pos.x, first.pos.y) / 16;
  assert.ok(
    Math.abs(firstSpeed - topSpeed * (1 - slideAmount)) < 1e-9,
    'the first frame on ice moves at 1 - slideAmount of commanded speed',
  );

  // Momentum accumulates toward, but stays under, the commanded speed.
  let pos = first.pos;
  for (let frame = 0; frame < 40; frame++) {
    pos = movement.update(snapshot(pos), 16, { integrateFromLocal: true }).pos;
  }
  const settled = movement.getMomentumForTest();
  assert.ok(Math.hypot(settled.x, settled.y) > topSpeed * 0.5, 'ice eventually gets up to speed');
  assert.ok(
    Math.hypot(settled.x, settled.y) <= topSpeed + 1e-9,
    'the blend never exceeds the commanded top speed',
  );
});

test('ice carries the body past a stop command instead of halting instantly', () => {
  const movement = new MovementController();
  const slideAmount = 0.95;
  const moving = (pos: { x: number; y: number }) => ({
    localPos: pos,
    playerSpeed: 75,
    playerSpeedBoost: 0,
    tileSpeed: 1,
    tileSlideAmount: slideAmount,
  });

  movement.setTarget({ x: 100, y: 0 }, 0.1);
  let pos = { x: 0, y: 0 };
  for (let frame = 0; frame < 40; frame++) {
    pos = movement.update(moving(pos), 16, { integrateFromLocal: true }).pos;
  }
  const carried = movement.getMomentumForTest();
  assert.ok(carried.x > 0, 'momentum points along the commanded direction');

  // Commanding a dead stop still drifts, because the retained vector decays
  // rather than zeroing (ProdMafia Player.as:1141).
  const stopped = movement.update(moving(pos), 16, {
    integrateFromLocal: true,
    velocityOverride: { x: 0, y: 0 },
  });
  assert.ok(stopped.pos.x > pos.x, 'the body keeps sliding for at least one frame');
  assert.ok(
    movement.getMomentumForTest().x < carried.x,
    'and the retained vector decays toward a stop',
  );
});

test('a push tile offsets movement by the tile animation velocity', () => {
  const movement = new MovementController();
  // Whirlpool: <Animate dx="2.5" />, so ProdMafia applies -2.5 * 0.001 tiles/ms.
  const push = { dx: -0.0025, dy: 0 };
  movement.setTarget({ x: 100, y: 0 }, 0.1);

  const withPush = movement.update(
    {
      localPos: { x: 0, y: 0 },
      playerSpeed: 75,
      playerSpeedBoost: 0,
      tileSpeed: 1,
      tilePushVelocity: push,
    },
    16,
    { integrateFromLocal: true },
  );

  const plain = new MovementController();
  plain.setTarget({ x: 100, y: 0 }, 0.1);
  const withoutPush = plain.update(
    {
      localPos: { x: 0, y: 0 },
      playerSpeed: 75,
      playerSpeedBoost: 0,
      tileSpeed: 1,
    },
    16,
    { integrateFromLocal: true },
  );

  assert.ok(
    Math.abs((withoutPush.pos.x + push.dx * 16) - withPush.pos.x) < 1e-9,
    'the push is a constant per-ms offset on top of the commanded step',
  );
  assert.ok(withPush.pos.x < withoutPush.pos.x, 'an opposing whirlpool loses ground');
});

test('a push tile carries a stationary player against no commanded movement', () => {
  const movement = new MovementController();
  movement.setTarget({ x: 100, y: 0 }, 0.1);
  const update = movement.update(
    {
      localPos: { x: 0, y: 0 },
      playerSpeed: 75,
      playerSpeedBoost: 0,
      tileSpeed: 1,
      tilePushVelocity: { dx: -0.0025, dy: 0 },
    },
    16,
    { integrateFromLocal: true, velocityOverride: { x: 0, y: 0 } },
  );

  assert.ok(
    Math.abs(update.pos.x - -0.0025 * 16) < 1e-9,
    'holding still in a whirlpool still drifts, which a dodge hold must account for',
  );
});

test('a push tile eats most of a minimum-speed characters progress', () => {
  const movement = new MovementController();
  movement.setTarget({ x: 100, y: 0 }, 0.1);
  // Strongest push in tiles.xml is <Animate dx="3" />, i.e. 0.003 tiles/ms, just
  // under the 0.004 floor speed — so a walking player is slowed hard but never
  // fully reversed.
  const update = movement.update(
    {
      localPos: { x: 0, y: 0 },
      playerSpeed: 0,
      playerSpeedBoost: 0,
      tileSpeed: 1,
      tilePushVelocity: { dx: -0.003, dy: 0 },
    },
    16,
    { integrateFromLocal: true },
  );

  const commanded = 0.004 * 16;
  assert.ok(update.pos.x > 0, 'the floor speed still beats the strongest push');
  assert.ok(
    update.pos.x < commanded * 0.3,
    'but over 70% of the commanded escape distance is cancelled by the current',
  );
});

test('momentum resets after an authoritative position snap', () => {
  const movement = new MovementController();
  movement.setTarget({ x: 100, y: 0 }, 0.1);
  let pos = { x: 0, y: 0 };
  for (let frame = 0; frame < 20; frame++) {
    pos = movement.update(
      {
        localPos: pos,
        playerSpeed: 75,
        playerSpeedBoost: 0,
        tileSpeed: 1,
        tileSlideAmount: 0.95,
      },
      16,
      { integrateFromLocal: true },
    ).pos;
  }
  assert.ok(Math.hypot(...Object.values(movement.getMomentumForTest())) > 0);

  movement.resetMomentum();
  assert.deepEqual(movement.getMomentumForTest(), { x: 0, y: 0 });
});

test('non-sliding tiles keep the plain commanded step untouched', () => {
  const movement = new MovementController();
  movement.setTarget({ x: 1, y: 0 }, 0.01);
  const update = movement.update(
    {
      localPos: { x: 0, y: 0 },
      playerSpeed: 75,
      playerSpeedBoost: 0,
      tileSpeed: 1,
      tileSlideAmount: 0,
    },
    16,
    { integrateFromLocal: true },
  );

  const expected = movementSpeed({
    localPos: { x: 0, y: 0 },
    playerSpeed: 75,
    playerSpeedBoost: 0,
    tileSpeed: 1,
  }) * 16;
  assert.ok(Math.abs(update.pos.x - expected) < 1e-9, 'ordinary ground is unaffected');
});
