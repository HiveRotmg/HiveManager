import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MovementController, resolveMovementCollision } from '../src/movement-controller';

test('MovementController steps from authoritative server position when available', () => {
  const movement = new MovementController();
  movement.setTarget({ x: 10, y: 0 }, 0.1);
  const update = movement.update(
    {
      localPos: { x: 9, y: 0 },
      serverPos: { x: 0, y: 0 },
      playerSpeed: 0,
      playerSpeedBoost: 0,
    },
    1000,
  );

  assert.equal(update.reached, undefined);
  assert.ok(update.pos.x > 3.9 && update.pos.x < 4.1);
  assert.equal(update.pos.y, 0);
});
test('MovementController emits reached target and clears target state', () => {
  const movement = new MovementController();
  movement.setTarget({ x: 1, y: 1 }, 0.1);
  const update = movement.update(
    {
      localPos: { x: 0, y: 0 },
      playerSpeed: 75,
      playerSpeedBoost: 0,
    },
    1000,
  );

  assert.deepEqual(update.reached, { x: 1, y: 1 });
  assert.equal(movement.hasTarget(), false);
});

test('MovementController waits for authoritative position before confirming a waypoint', () => {
  const movement = new MovementController();
  movement.setTarget({ x: 1, y: 0 }, 0.1);

  const predicted = movement.update(
    {
      localPos: { x: 0, y: 0 },
      serverPos: { x: 0, y: 0 },
      playerSpeed: 75,
      playerSpeedBoost: 0,
    },
    1000,
  );
  assert.deepEqual(predicted.pos, { x: 1, y: 0 });
  assert.equal(predicted.reached, undefined);
  assert.equal(movement.hasTarget(), true);

  const confirmed = movement.update(
    {
      localPos: predicted.pos,
      serverPos: { x: 1, y: 0 },
      playerSpeed: 75,
      playerSpeedBoost: 0,
    },
    100,
  );
  assert.deepEqual(confirmed.reached, { x: 1, y: 0 });
  assert.equal(movement.hasTarget(), false);
});

test('MovementController confirms arrival from local prediction while integrating locally', () => {
  const movement = new MovementController();
  movement.setTarget({ x: 1, y: 0 }, 0.1);

  const update = movement.update(
    {
      localPos: { x: 0, y: 0 },
      serverPos: { x: 0, y: 0 },
      playerSpeed: 75,
      playerSpeedBoost: 0,
    },
    1000,
    { integrateFromLocal: true },
  );
  assert.deepEqual(update.pos, { x: 1, y: 0 });
  assert.deepEqual(update.reached, { x: 1, y: 0 });
  assert.equal(movement.hasTarget(), false);
});

test('MovementController keeps steering from local prediction when server lags behind the waypoint', () => {
  const movement = new MovementController();
  movement.setTarget({ x: 2, y: 0 }, 0.35);

  const velocity = movement.getIntendedVelocity(
    {
      localPos: { x: 1.1, y: 0 },
      serverPos: { x: 0.5, y: 0 },
      playerSpeed: 75,
      playerSpeedBoost: 0,
    },
    true,
  );
  assert.ok(velocity.x > 0);
  assert.equal(velocity.y, 0);
});

test('MovementController follows successive path waypoints without zero-velocity gaps', () => {
  const movement = new MovementController();
  let pos = { x: 0.5, y: 0.5 };
  const waypoints = [
    { x: 1.5, y: 0.5 },
    { x: 2.5, y: 0.5 },
    { x: 3.5, y: 0.5 },
  ];
  let waypointIndex = 0;
  movement.setTarget(waypoints[0]!, 0);

  const displacements: number[] = [];
  for (let frame = 0; frame < 120; frame++) {
    while (
      waypointIndex < waypoints.length
      && Math.hypot(pos.x - waypoints[waypointIndex]!.x, pos.y - waypoints[waypointIndex]!.y) <= Math.sqrt(0.20)
    ) {
      waypointIndex++;
      if (waypointIndex < waypoints.length) {
        movement.setTarget(waypoints[waypointIndex]!, 0);
      } else {
        movement.clear();
      }
    }
    if (!movement.hasTarget()) break;
    const before = { ...pos };
    const update = movement.update(
      {
        localPos: pos,
        serverPos: { x: pos.x - 0.4, y: pos.y },
        playerSpeed: 75,
        playerSpeedBoost: 0,
      },
      16,
      { integrateFromLocal: true },
    );
    pos = update.pos;
    displacements.push(Math.hypot(pos.x - before.x, pos.y - before.y));
  }

  assert.ok(pos.x > 3.0, `expected to progress past x=3, got ${pos.x}`);
  assert.equal(displacements.some((distance) => distance < 1e-6), false);
});

test('MovementController applies a local dodge velocity without clearing navigation intent', () => {
  const movement = new MovementController();
  movement.setTarget({ x: 10, y: 0 }, 0.1);
  const update = movement.update(
    {
      localPos: { x: 2, y: 2 },
      serverPos: { x: 1, y: 1 },
      playerSpeed: 75,
      playerSpeedBoost: 0,
    },
    100,
    { integrateFromLocal: true, velocityOverride: { x: 0, y: 0.005 } },
  );

  assert.deepEqual(update.pos, { x: 2, y: 2.5 });
  assert.equal(movement.hasTarget(), true);
  assert.deepEqual(movement.getTarget(), { x: 10, y: 0, threshold: 0.1 });
});

test('MovementController can track path stalls while dodge owns safe goal movement', () => {
  const movement = new MovementController();
  movement.setTarget({ x: 10, y: 0 }, 0.1);
  const snapshot = {
    localPos: { x: 0, y: 0 },
    serverPos: { x: 0, y: 0 },
    playerSpeed: 75,
    playerSpeedBoost: 0,
  };

  const initial = movement.update(snapshot, 100, {
    velocityOverride: { x: 0.0096, y: 0 },
    trackTargetProgress: true,
  });
  assert.equal(initial.stalled, undefined);
  const stalled = movement.update(snapshot, 3100, {
    velocityOverride: { x: 0.0096, y: 0 },
    trackTargetProgress: true,
  });
  assert.deepEqual(stalled.stalled, { distance: 10 });
});

test('MovementController can dodge from standstill without creating a walk target', () => {
  const movement = new MovementController();
  const update = movement.update(
    {
      localPos: { x: 2, y: 2 },
      playerSpeed: 75,
      playerSpeedBoost: 0,
    },
    100,
    { integrateFromLocal: true, velocityOverride: { x: -0.005, y: 0 } },
  );

  assert.deepEqual(update.pos, { x: 1.5, y: 2 });
  assert.equal(movement.hasTarget(), false);
});

test('resolveMovementCollision prevents movement from tunneling through a wall', () => {
  const resolved = resolveMovementCollision(
    { x: 0.5, y: 0.5 },
    { x: 2.5, y: 0.5 },
    (x) => x < 1 || x >= 2,
  );

  assert.ok(resolved.x > 0.99 && resolved.x < 1);
  assert.equal(resolved.y, 0.5);
});

test('resolveMovementCollision slides diagonal movement along a blocked axis', () => {
  const resolved = resolveMovementCollision(
    { x: 0.5, y: 0.5 },
    { x: 1.5, y: 1.5 },
    (x) => x < 1,
  );

  assert.ok(resolved.x > 0.99 && resolved.x < 1);
  assert.ok(resolved.y > 1.49 && resolved.y <= 1.5);
});

test('MovementController reports collision-adjusted dodge movement', () => {
  const movement = new MovementController();
  const update = movement.update(
    {
      localPos: { x: 0.5, y: 0.5 },
      playerSpeed: 75,
      playerSpeedBoost: 0,
    },
    200,
    {
      integrateFromLocal: true,
      velocityOverride: { x: 0.005, y: 0 },
      resolvePosition: (from, intended) => resolveMovementCollision(
        from,
        intended,
        (x) => x < 1,
      ),
    },
  );

  assert.ok(update.pos.x > 0.99 && update.pos.x < 1);
  assert.ok(update.collision);
  assert.equal(update.collision.requestedDistance, 1);
  assert.ok(update.collision.appliedDistance < 0.5);
});
