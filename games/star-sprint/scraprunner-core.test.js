'use strict';

const assert = require('assert');
const ScrapRunner = require('./scraprunner-core.js');

function makeLoadedRun(zoneId = 'rust-yard', upgrades = {}) {
  const game = ScrapRunner.createGameState({ zoneId });
  const player = ScrapRunner.addPlayer(game, {
    id: 'player-1',
    name: 'Tester',
    profile: {
      uid: 'test-user',
      upgrades,
    },
  });
  player.scrap = player.cargo;
  player.kills = 999;
  player.score = 12345;
  player.x = game.extraction.x;
  player.y = game.extraction.y;
  return { game, player };
}

{
  const { game, player } = makeLoadedRun('rust-yard');
  const reward = ScrapRunner.calculateRunRewardCents(game, player);
  assert(reward > 0, 'reward should be positive for a loaded extraction');
  assert(reward <= game.zone.maxRewardCents, 'reward must be clamped by zone max');
}

{
  const base = makeLoadedRun('rust-yard');
  base.player.scrap = 50;
  base.player.kills = 2;
  const upgraded = makeLoadedRun('rust-yard', { coin: 4, scrap: 4 });
  upgraded.player.scrap = 50;
  upgraded.player.kills = 2;
  assert(
    ScrapRunner.calculateRunRewardCents(upgraded.game, upgraded.player)
      > ScrapRunner.calculateRunRewardCents(base.game, base.player),
    'coin and scrap upgrades should increase validated reward',
  );
}

{
  const { game } = makeLoadedRun('neon-wrecks');
  const result = ScrapRunner.tryExtract(game, 'player-1');
  assert.strictEqual(result.ok, true, 'player at extraction should extract');
  assert.strictEqual(result.run.zoneId, 'neon-wrecks');
  assert(result.run.rewardCents <= game.zone.maxRewardCents, 'extract result should respect max payout');
  const duplicate = ScrapRunner.tryExtract(game, 'player-1');
  assert.strictEqual(duplicate.ok, false, 'duplicate extraction should be rejected');
}

{
  const game = ScrapRunner.createGameState({ zoneId: 'rust-yard' });
  const player = ScrapRunner.addPlayer(game, {
    id: 'player-2',
    name: 'Too Far',
  });
  player.x = 100;
  player.y = 100;
  const result = ScrapRunner.tryExtract(game, 'player-2');
  assert.strictEqual(result.ok, false, 'server should reject extraction outside the ring');
}

console.log('ScrapRunner economy tests passed.');
