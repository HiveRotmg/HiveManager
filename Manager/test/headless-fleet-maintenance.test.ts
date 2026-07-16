import assert from 'node:assert/strict';
import test from 'node:test';
import type { Client } from 'headless-client';
import type { GameDataLoader } from '../src/game-data/GameDataLoader.js';
import { HeadlessFleet } from '../src/headless/HeadlessFleet.js';

test('server maintenance disconnects every client and emits one popup event', () => {
  const fleet = new HeadlessFleet({} as GameDataLoader);
  const stopped: string[] = [];
  const fakeClient = (id: string) => ({
    stop: (reason: string) => stopped.push(`${id}:${reason}`),
  }) as unknown as Client;
  const state = fleet as unknown as {
    entries: Map<string, {
      account: { id: string };
      client: Client;
      serverName: string;
      stopping: boolean;
      connectedAt: number;
      damage: unknown;
    }>;
    handleServerMaintenance(accountId: string, serverName: string): void;
  };
  state.entries.set('one', {
    account: { id: 'one' },
    client: fakeClient('one'),
    serverName: 'USWest',
    stopping: false,
    connectedAt: 0,
    damage: {},
  });
  state.entries.set('two', {
    account: { id: 'two' },
    client: fakeClient('two'),
    serverName: 'USEast',
    stopping: false,
    connectedAt: 0,
    damage: {},
  });

  const maintenance: Array<{ accountId: string; serverName: string }> = [];
  fleet.on('maintenance', (accountId, serverName) => maintenance.push({ accountId, serverName }));

  state.handleServerMaintenance('one', 'USWest');
  state.handleServerMaintenance('two', 'USEast');

  assert.deepEqual(maintenance, [{ accountId: 'one', serverName: 'USWest' }]);
  assert.deepEqual(stopped.sort(), [
    'one:server maintenance',
    'two:server maintenance',
  ]);
  assert.equal(fleet.size, 0);
});
