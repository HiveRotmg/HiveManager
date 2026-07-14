import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  IncomingPartyMemberInfoPacket,
  PartyActionPacket,
  PartyMemberAddedPacket,
  PlayerData,
} from 'realmlib';
import { Client } from '../src/client';

interface PartyHarness {
  player: PlayerData;
  handlePartyRoster(packet: IncomingPartyMemberInfoPacket): void;
  handlePartyMemberAdded(packet: PartyMemberAddedPacket): void;
  handlePartyAction(packet: PartyActionPacket): void;
}

test('Client retains party state before an SDK script first accesses it', () => {
  const client = new Client({
    alias: 'party-test',
    accessToken: '',
    clientToken: '',
    charId: 1,
    needsNewChar: false,
    host: '127.0.0.1',
  });
  const state = client as unknown as PartyHarness;
  state.player = { name: 'LocalPlayer' } as PlayerData;

  const roster = new IncomingPartyMemberInfoPacket();
  roster.partyId = 42;
  roster.partyPlayers = [
    { playerId: 8, name: 'LocalPlayer', classId: 782, skinId: 0 },
    { playerId: 9, name: 'PartyMate', classId: 768, skinId: 0 },
  ];
  state.handlePartyRoster(roster);

  assert.equal(client.getPartyId(), 42);
  assert.equal(client.getLocalPartyPlayerId(), 8);
  assert.deepEqual(client.getPartyMembers(), [
    { playerId: 8, playerName: 'LocalPlayer', classId: 782 },
    { playerId: 9, playerName: 'PartyMate', classId: 768 },
  ]);

  const added = new PartyMemberAddedPacket();
  added.playerId = 10;
  added.name = 'LateJoiner';
  added.classId = 775;
  state.handlePartyMemberAdded(added);
  assert.equal(client.getPartyMembers().at(-1)?.playerName, 'LateJoiner');

  const memberLeft = new PartyActionPacket();
  memberLeft.actionId = 6;
  memberLeft.playerId = 9;
  state.handlePartyAction(memberLeft);
  assert.equal(client.getPartyMembers().some((member) => member.playerId === 9), false);

  const localLeft = new PartyActionPacket();
  localLeft.actionId = 6;
  localLeft.playerId = 8;
  state.handlePartyAction(localLeft);
  assert.equal(client.getPartyId(), null);
  assert.deepEqual(client.getPartyMembers(), []);
});
