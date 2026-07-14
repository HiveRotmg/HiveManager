import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  Classes,
  ConvertSeasonalCharacterPacket,
  CreatePacket,
  FailurePacket,
  Packet,
  PacketType,
} from 'realmlib';
import { Client } from '../src/client';
import { ClientEvent } from '../src/events';

test('Client.createCharacter sends configurable class and seasonal fields', () => {
  const client = makeClient();
  const sent: Packet[] = [];
  (client as unknown as { io: { send(packet: Packet): void } }).io = { send: (packet) => sent.push(packet) };

  client.createCharacter({ classType: Classes.Rogue, seasonal: true });

  assert.equal(sent.length, 1);
  assert.ok(sent[0] instanceof CreatePacket);
  assert.equal(sent[0].classType, Classes.Rogue);
  assert.equal(sent[0].skinType, 0);
  assert.equal(sent[0].isSeasonal, true);
  assert.equal(sent[0].isChallenger, false);
  assert.equal(sent[0].unknownByte, 1);
});

test('Client.createCharacter uses configured defaults and permits overrides', () => {
  const client = makeClient({
    createClassType: Classes.Archer,
    createSkin: 7,
    createSeasonal: true,
    createChallenger: true,
  });
  const sent: CreatePacket[] = [];
  (client as unknown as { io: { send(packet: Packet): void } }).io = {
    send: (packet) => sent.push(packet as CreatePacket),
  };

  client.createCharacter();
  client.createCharacter({ classType: Classes.Wizard, seasonal: false });

  assert.deepEqual(
    sent.map((packet) => [packet.classType, packet.skinType, packet.isSeasonal, packet.isChallenger]),
    [
      [Classes.Archer, 7, true, true],
      [Classes.Wizard, 7, false, true],
    ],
  );
});

test('Client supports positional creation and seasonal conversion helpers', () => {
  const client = makeClient();
  const sent: Packet[] = [];
  (client as unknown as { io: { send(packet: Packet): void } }).io = { send: (packet) => sent.push(packet) };

  client.createCharacter(Classes.Wizard, true);
  client.sendSeasonalConversion();

  assert.ok(sent[0] instanceof CreatePacket);
  assert.equal(sent[0].classType, Classes.Wizard);
  assert.equal(sent[0].isSeasonal, true);
  assert.ok(sent[1] instanceof ConvertSeasonalCharacterPacket);
  assert.equal(sent[1].type, PacketType.CONVERT_SEASONAL_CHARACTER);
});

test('Client switches character selection and waits for CreateSuccess', async () => {
  const client = makeClient({ charId: 3 });
  let connectCalls = 0;
  client.connect = () => {
    connectCalls++;
    queueMicrotask(() => client.emit(ClientEvent.Ready, 101));
  };

  await client.switchCharacter(8, 100);

  assert.equal(client.getCharacterId(), 8);
  assert.equal(connectCalls, 1);
});

test('Client restores the prior character after a failed switch', async () => {
  const client = makeClient({ charId: 3 });
  let connectCalls = 0;
  client.connect = () => {
    connectCalls++;
    if (connectCalls !== 1) return;
    queueMicrotask(() => {
      const failure = new FailurePacket();
      failure.errorId = 5;
      failure.errorDescription = 'Character not found';
      client.emit(ClientEvent.Failure, failure);
    });
  };

  await assert.rejects(() => client.switchCharacter(999, 100), /Character not found/);

  assert.equal(client.getCharacterId(), 3);
  assert.equal(connectCalls, 2);
});

test('Client rejects invalid character ids without reconnecting', async () => {
  const client = makeClient();
  let connected = false;
  client.connect = () => { connected = true; };

  await assert.rejects(() => client.switchCharacter(0), /Invalid character id/);
  assert.equal(connected, false);
});

function makeClient(overrides: Partial<ConstructorParameters<typeof Client>[0]> = {}): Client {
  return new Client({
    alias: 'character-test',
    accessToken: 'access-token',
    clientToken: 'client-token',
    charId: 1,
    needsNewChar: false,
    host: '127.0.0.1',
    ...overrides,
  });
}
