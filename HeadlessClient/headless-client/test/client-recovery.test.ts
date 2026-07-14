import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Packet } from 'realmlib';
import { backoffDelay, classifyFailure, Client } from '../src/client';
import { ClientLifecycleState } from '../src/client-lifecycle';

test('classifyFailure distinguishes rate-limit, auth, fatal, and transient failures', () => {
  assert.equal(classifyFailure('You are banned for abuse'), 'rate-limited');
  assert.equal(classifyFailure('Too many connections, try again later'), 'rate-limited');
  assert.equal(classifyFailure('Access token not verified'), 'auth');
  assert.equal(classifyFailure('Invalid account credentials'), 'auth');
  assert.equal(classifyFailure('Your client is out of date, please upgrade'), 'fatal');
  assert.equal(classifyFailure('Unexpected server error'), 'transient');
  assert.equal(classifyFailure(''), 'transient');
});

test('backoffDelay stays within [base, min(base*2^attempt, max)] and respects the ceiling', () => {
  const base = 1000;
  const max = 60_000;
  for (let attempt = 0; attempt < 12; attempt++) {
    const ceiling = Math.min(base * 2 ** attempt, max);
    for (let i = 0; i < 50; i++) {
      const delay = backoffDelay(attempt, base, max);
      assert.ok(delay >= base, `delay ${delay} below base at attempt ${attempt}`);
      assert.ok(delay <= ceiling + 1e-9, `delay ${delay} above ceiling ${ceiling} at attempt ${attempt}`);
    }
  }
});

test('backoffDelay first attempt has no jitter room and equals the base', () => {
  assert.equal(backoffDelay(0, 1000, 60_000), 1000);
});

test('socket reconnects do not reset the gameplay clock', async () => {
  const client = new Client({
    alias: 'clock-test',
    accessToken: '',
    clientToken: '',
    charId: 1,
    needsNewChar: false,
    host: '127.0.0.1',
  });
  const state = client as unknown as {
    connectStart: number;
    lifecycle: {
      nextGeneration(): number;
      transition(next: ClientLifecycleState): void;
    };
    socket: { destroyed: boolean };
    io: { send(packet: Packet): void };
    time(): number;
    handleSocketConnected(generation: number): Promise<void>;
  };
  state.connectStart = Date.now() - 5_000;
  const generation = state.lifecycle.nextGeneration();
  state.lifecycle.transition(ClientLifecycleState.Connecting);
  state.socket = { destroyed: false };
  state.io = { send: () => undefined };

  const beforeReconnect = state.time();
  await state.handleSocketConnected(generation);
  const afterReconnect = state.time();

  assert.ok(beforeReconnect >= 4_900);
  assert.ok(afterReconnect >= beforeReconnect);
});

test('emergency nexus forces a fresh connection to the Nexus game id', () => {
  const client = new Client({
    alias: 'emergency-nexus-test',
    accessToken: '',
    clientToken: '',
    charId: 1,
    needsNewChar: false,
    host: 'realm.example',
  });
  const state = client as unknown as {
    socket: { destroyed: boolean };
    host: string;
    nexusHost: string;
    gameId: number;
    key: number[];
    keyTime: number;
    connect(): void;
  };
  let connects = 0;
  Object.assign(state, {
    socket: { destroyed: false },
    host: 'realm.example',
    nexusHost: 'nexus.example',
    gameId: 1234,
    key: [1, 2, 3],
    keyTime: 99,
    connect: () => { connects++; },
  });

  assert.equal(client.nexusImmediately('test autonexus'), true);
  assert.equal(connects, 1);
  assert.equal(state.host, 'nexus.example');
  assert.equal(state.gameId, -2);
  assert.deepEqual(state.key, []);
  assert.equal(state.keyTime, -1);
});
