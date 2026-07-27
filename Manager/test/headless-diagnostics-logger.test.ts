import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { HeadlessDiagnosticsLogger } from '../src/headless/HeadlessDiagnosticsLogger.js';

test('persists settings and writes complete packet and dodge JSON lines', async () => {
  const root = mkdtempSync(join(tmpdir(), 'hive-diagnostics-'));
  try {
    const logger = new HeadlessDiagnosticsLogger(root);
    assert.deepEqual(logger.getSettings(), { dodge: false, packets: false });
    logger.setSettings({ dodge: true, packets: true });

    logger.logPacket(
      { accountId: 'account-1', alias: 'Test', serverName: 'USWest', sessionId: 'account-1:1' },
      {
        timestamp: 1,
        direction: 'incoming',
        id: 7,
        size: 3,
        payload: Buffer.from([0x01, 0x02, 0xff]),
        connectionGeneration: 1,
        dodgeCorrelation: {
          sequence: 3,
          decisionSequence: 2,
          tickId: 40,
          recordTime: 1,
          position: { x: 1, y: 2 },
        },
      },
    );
    logger.logDodge(
      { accountId: 'account-1', alias: 'Test', serverName: 'USWest', sessionId: 'account-1:1' },
      {
        kind: 'authoritative_rebase',
        sequence: 4,
        connectionGeneration: 1,
        timestamp: 2,
        mapName: 'Realm',
        localPosition: { x: 1, y: 2 },
        serverPosition: { x: 1.1, y: 2 },
        positionDrift: 0.1,
        player: null,
        movement: {
          dt: 16,
          locked: false,
          snapshot: {} as never,
          intendedVelocity: { x: 0, y: 0 },
          goal: null,
          dodgeIntent: null,
          navigationStatus: 'idle',
          previousDodgeDecision: null,
          navigationPath: [],
          routeRevision: 0,
        },
        environment: {
          collisionRevision: 1,
          enemyRevision: 2,
        },
        state: { decision: 'hold' } as never,
        dodgeEnabled: true,
        availability: { controller: true, combat: true, collisionWorld: true, aoeTracker: true },
        projectiles: [],
        aoes: [],
        lastMove: {
          sequence: 3,
          decisionSequence: 2,
          tickId: 40,
          recordTime: 1,
          position: { x: 1, y: 2 },
        },
        correction: {
          source: 'newtick',
          from: { x: 1, y: 2 },
          to: { x: 1.1, y: 2 },
          drift: 0.1,
          maximumExpectedDrift: 1,
          tickId: 40,
          tickTime: 200,
        },
      },
    );
    logger.close();
    await new Promise((resolve) => setTimeout(resolve, 50));

    const packet = JSON.parse(readFileSync(logger.packetsFile, 'utf8'));
    const dodge = JSON.parse(readFileSync(logger.dodgeFile, 'utf8'));
    assert.equal(packet.payloadHex, '0102ff');
    assert.equal(packet.direction, 'incoming');
    assert.equal(packet.dodgeCorrelation.decisionSequence, 2);
    assert.equal(packet.connectionGeneration, 1);
    assert.equal(dodge.state.decision, 'hold');
    assert.equal(dodge.correction.source, 'newtick');

    const reloaded = new HeadlessDiagnosticsLogger(root);
    assert.deepEqual(reloaded.getSettings(), { dodge: true, packets: true });
    reloaded.close();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
