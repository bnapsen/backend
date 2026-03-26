'use strict';

const SUITS = ['S', 'H', 'D', 'C'];
const VALUES = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
const STARTING_STACK = 1500;
const SMALL_BLIND = 10;
const BIG_BLIND = 20;
const MAX_SEATS = 10;
const MAX_LOG = 12;

function cloneCard(card) {
  return card ? { value: card.value, suit: card.suit } : null;
}

function createDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const value of VALUES) {
      deck.push({ value, suit });
    }
  }
  for (let index = deck.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [deck[index], deck[swapIndex]] = [deck[swapIndex], deck[index]];
  }
  return deck;
}

function createLogEntry(text, tone) {
  return {
    text,
    tone: tone || 'info',
  };
}

function pushLog(state, text, tone) {
  state.log.push(createLogEntry(text, tone));
  if (state.log.length > MAX_LOG) {
    state.log.splice(0, state.log.length - MAX_LOG);
  }
}

function createPlayer(id, name, seat) {
  return {
    id,
    name,
    seat,
    stack: STARTING_STACK,
    cards: [],
    folded: false,
    allIn: false,
    acted: false,
    bet: 0,
    totalContribution: 0,
    lastAction: 'Waiting',
    leaving: false,
  };
}

function createGameState() {
  return {
    title: 'Orbit Holdem Live',
    roomCode: '',
    stage: 'waiting',
    handNumber: 0,
    status: 'Host a table, invite players, and start a hand when at least two seats are filled.',
    dealerSeat: -1,
    smallBlindSeat: null,
    bigBlindSeat: null,
    actionSeat: null,
    smallBlind: SMALL_BLIND,
    bigBlind: BIG_BLIND,
    pot: 0,
    currentBet: 0,
    minRaise: BIG_BLIND,
    community: [],
    players: [],
    deck: [],
    log: [
      createLogEntry(
        'Orbit Holdem Live is ready. Host a room and seat between two and ten players.',
        'info'
      ),
    ],
  };
}

function seatedPlayers(state, options) {
  const includeLeavers = options && options.includeLeavers;
  return state.players
    .filter((player) => includeLeavers || !player.leaving)
    .sort((left, right) => left.seat - right.seat);
}

function playerAtSeat(state, seat) {
  return state.players.find((player) => player.seat === seat) || null;
}

function findPlayer(state, id) {
  return state.players.find((player) => player.id === id) || null;
}

function nextSeatPlayer(state, fromSeat, predicate) {
  for (let offset = 1; offset <= MAX_SEATS; offset += 1) {
    const seat = (fromSeat + offset + MAX_SEATS) % MAX_SEATS;
    const player = playerAtSeat(state, seat);
    if (player && predicate(player)) {
      return player;
    }
  }
  return null;
}

function dealEligiblePlayers(state) {
  return seatedPlayers(state).filter((player) => !player.leaving && player.stack > 0);
}

function handPlayers(state) {
  return state.players.filter((player) => player.cards.length === 2);
}

function contenders(state) {
  return handPlayers(state).filter((player) => !player.folded);
}

function actorsForStreet(state) {
  return contenders(state).filter((player) => !player.allIn);
}

function resetStreet(state, keepActions) {
  state.currentBet = 0;
  state.minRaise = state.bigBlind;
  state.players.forEach((player) => {
    player.bet = 0;
    player.acted = Boolean(keepActions && player.acted);
    if (!player.folded && player.cards.length === 2 && !player.allIn) {
      player.lastAction = '';
    }
  });
}

function cleanupLeavers(state) {
  state.players = state.players.filter((player) => !player.leaving || player.cards.length === 2);
}

function activeSeatCount(state) {
  return seatedPlayers(state).filter((player) => player.stack > 0 || player.cards.length === 2).length;
}

function placeBet(state, player, amount) {
  const paid = Math.max(0, Math.min(amount, player.stack));
  player.stack -= paid;
  player.bet += paid;
  player.totalContribution += paid;
  state.pot += paid;
  if (player.stack === 0) {
    player.allIn = true;
  }
  return paid;
}

function postBlind(state, player, amount, label) {
  const paid = placeBet(state, player, amount);
  player.lastAction = `${label} ${paid}`;
}

function dealHoleCards(state) {
  const players = dealEligiblePlayers(state);
  let first;
  if (players.length === 2 && state.dealerSeat >= 0) {
    first = playerAtSeat(state, state.dealerSeat);
  } else {
    first = nextSeatPlayer(state, state.dealerSeat, (player) => players.includes(player));
  }
  if (!first) {
    first = players[0];
  }
  const order = [];
  let current = first;
  while (current && !order.includes(current)) {
    order.push(current);
    current = nextSeatPlayer(state, current.seat, (player) => players.includes(player) && !order.includes(player));
  }

  for (let round = 0; round < 2; round += 1) {
    order.forEach((player) => {
      player.cards.push(state.deck.pop());
    });
  }
}

function burn(state) {
  state.deck.pop();
}

function revealStreet(state, stage) {
  burn(state);
  if (stage === 'flop') {
    state.community.push(state.deck.pop(), state.deck.pop(), state.deck.pop());
  } else if (stage === 'turn' || stage === 'river') {
    state.community.push(state.deck.pop());
  }
}

function detectStraight(valuesDescending) {
  const unique = [...new Set(valuesDescending)].sort((left, right) => right - left);
  if (unique.includes(14)) {
    unique.push(1);
  }
  let streak = 1;
  for (let index = 1; index < unique.length; index += 1) {
    if (unique[index] === unique[index - 1] - 1) {
      streak += 1;
      if (streak >= 5) {
        return unique[index - 4];
      }
    } else if (unique[index] !== unique[index - 1]) {
      streak = 1;
    }
  }
  return null;
}

function compareRank(left, right) {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const leftValue = left[index] || 0;
    const rightValue = right[index] || 0;
    if (leftValue > rightValue) {
      return 1;
    }
    if (leftValue < rightValue) {
      return -1;
    }
  }
  return 0;
}

function evaluateFive(cards) {
  const values = cards.map((card) => card.value).sort((left, right) => right - left);
  const suits = cards.map((card) => card.suit);
  const counts = {};
  values.forEach((value) => {
    counts[value] = (counts[value] || 0) + 1;
  });

  const groups = Object.entries(counts)
    .map(([value, count]) => ({ value: Number(value), count }))
    .sort((left, right) => right.count - left.count || right.value - left.value);

  const flush = suits.every((suit) => suit === suits[0]);
  const straightHigh = detectStraight(values);

  if (flush && straightHigh) {
    return [8, straightHigh];
  }
  if (groups[0].count === 4) {
    return [7, groups[0].value, groups[1].value];
  }
  if (groups[0].count === 3 && groups[1].count === 2) {
    return [6, groups[0].value, groups[1].value];
  }
  if (flush) {
    return [5, ...values];
  }
  if (straightHigh) {
    return [4, straightHigh];
  }
  if (groups[0].count === 3) {
    const kickers = groups.filter((group) => group.count === 1).map((group) => group.value).sort((left, right) => right - left);
    return [3, groups[0].value, ...kickers];
  }
  if (groups[0].count === 2 && groups[1].count === 2) {
    const highPair = Math.max(groups[0].value, groups[1].value);
    const lowPair = Math.min(groups[0].value, groups[1].value);
    const kicker = groups.find((group) => group.count === 1).value;
    return [2, highPair, lowPair, kicker];
  }
  if (groups[0].count === 2) {
    const kickers = groups.filter((group) => group.count === 1).map((group) => group.value).sort((left, right) => right - left);
    return [1, groups[0].value, ...kickers];
  }
  return [0, ...values];
}

function bestOfSeven(cards) {
  let best = null;
  for (let a = 0; a < cards.length - 4; a += 1) {
    for (let b = a + 1; b < cards.length - 3; b += 1) {
      for (let c = b + 1; c < cards.length - 2; c += 1) {
        for (let d = c + 1; d < cards.length - 1; d += 1) {
          for (let e = d + 1; e < cards.length; e += 1) {
            const rank = evaluateFive([cards[a], cards[b], cards[c], cards[d], cards[e]]);
            if (!best || compareRank(rank, best) > 0) {
              best = rank;
            }
          }
        }
      }
    }
  }
  return best;
}

function rankLabel(rank) {
  if (!rank) {
    return '';
  }
  switch (rank[0]) {
    case 8:
      return rank[1] === 14 ? 'Royal Flush' : 'Straight Flush';
    case 7:
      return 'Four of a Kind';
    case 6:
      return 'Full House';
    case 5:
      return 'Flush';
    case 4:
      return 'Straight';
    case 3:
      return 'Three of a Kind';
    case 2:
      return 'Two Pair';
    case 1:
      return 'One Pair';
    default:
      return 'High Card';
  }
}

function calculateSidePots(state) {
  const contributors = state.players.filter((player) => player.totalContribution > 0);
  const thresholds = [...new Set(contributors.map((player) => player.totalContribution))]
    .sort((left, right) => left - right);
  const sidePots = [];
  let previous = 0;
  thresholds.forEach((threshold) => {
    const inLayer = contributors.filter((player) => player.totalContribution >= threshold);
    const amount = (threshold - previous) * inLayer.length;
    const eligibleIds = inLayer
      .filter((player) => !player.folded && player.cards.length === 2)
      .map((player) => player.id);
    if (amount > 0) {
      sidePots.push({ amount, eligibleIds });
    }
    previous = threshold;
  });
  return sidePots;
}

function settleShowdown(state) {
  if (state.community.length < 5) {
    while (state.community.length < 5) {
      if (state.community.length === 0) {
        revealStreet(state, 'flop');
      } else if (state.community.length === 3) {
        revealStreet(state, 'turn');
      } else {
        revealStreet(state, 'river');
      }
    }
  }

  const active = contenders(state);
  if (active.length === 1) {
    const winner = active[0];
    winner.stack += state.pot;
    pushLog(state, `${winner.name} wins ${state.pot} chips uncontested.`, 'good');
    state.status = `${winner.name} scoops the pot.`;
  } else {
    const sidePots = calculateSidePots(state);
    sidePots.forEach((sidePot) => {
      const eligible = active.filter((player) => sidePot.eligibleIds.includes(player.id));
      if (!eligible.length) {
        return;
      }
      const ranked = eligible.map((player) => ({
        player,
        rank: bestOfSeven([...player.cards, ...state.community]),
      }));
      ranked.sort((left, right) => compareRank(right.rank, left.rank));
      const topRank = ranked[0].rank;
      const winners = ranked.filter((entry) => compareRank(entry.rank, topRank) === 0);
      const payout = Math.floor(sidePot.amount / winners.length);
      winners.forEach((entry) => {
        entry.player.stack += payout;
      });
      const remainder = sidePot.amount - payout * winners.length;
      if (remainder > 0) {
        winners[0].player.stack += remainder;
      }
      const label = winners.length > 1 ? 'split pot' : 'pot';
      pushLog(
        state,
        `${winners.map((entry) => entry.player.name).join(', ')} win ${sidePot.amount} chips (${label}).`,
        'good'
      );
    });
    const winnerNames = active
      .map((player) => ({
        player,
        rank: bestOfSeven([...player.cards, ...state.community]),
      }))
      .sort((left, right) => compareRank(right.rank, left.rank));
    state.status = `${winnerNames[0].player.name} shows ${rankLabel(winnerNames[0].rank)}.`;
  }

  state.stage = 'showdown';
  state.actionSeat = null;
  state.currentBet = 0;
  state.minRaise = state.bigBlind;
  state.players.forEach((player) => {
    player.bet = 0;
    player.acted = false;
    if (player.leaving) {
      player.cards = [];
    }
  });
  cleanupLeavers(state);
}

function setNextActionSeat(state, fromSeat) {
  const next = nextSeatPlayer(
    state,
    fromSeat,
    (player) => player.cards.length === 2 && !player.folded && !player.allIn && !player.leaving
  );
  state.actionSeat = next ? next.seat : null;
}

function bettingRoundComplete(state) {
  const active = contenders(state);
  if (active.length <= 1) {
    return true;
  }
  const actors = actorsForStreet(state);
  if (!actors.length) {
    return true;
  }
  return actors.every((player) => player.acted && player.bet === state.currentBet);
}

function advanceStreet(state) {
  if (state.stage === 'preflop') {
    state.stage = 'flop';
    revealStreet(state, 'flop');
  } else if (state.stage === 'flop') {
    state.stage = 'turn';
    revealStreet(state, 'turn');
  } else if (state.stage === 'turn') {
    state.stage = 'river';
    revealStreet(state, 'river');
  } else {
    settleShowdown(state);
    return;
  }

  resetStreet(state, false);
  const start = state.dealerSeat >= 0 ? state.dealerSeat : 0;
  setNextActionSeat(state, start);
  state.status = `${state.stage.toUpperCase()} dealt. ${playerAtSeat(state, state.actionSeat)?.name || 'Waiting'} to act.`;

  if (state.actionSeat === null) {
    settleShowdown(state);
  }
}

function resolveAfterAction(state, actorSeat) {
  const alive = contenders(state);
  if (alive.length === 1) {
    settleShowdown(state);
    return;
  }
  if (bettingRoundComplete(state)) {
    advanceStreet(state);
    return;
  }
  setNextActionSeat(state, actorSeat);
  const next = playerAtSeat(state, state.actionSeat);
  state.status = next ? `${next.name} to act.` : 'Waiting for the next street.';
}

function addPlayer(state, info) {
  const existing = findPlayer(state, info.id);
  if (existing) {
    existing.name = info.name;
    return existing;
  }

  for (let seat = 0; seat < MAX_SEATS; seat += 1) {
    if (!playerAtSeat(state, seat)) {
      const player = createPlayer(info.id, info.name, seat);
      state.players.push(player);
      state.players.sort((left, right) => left.seat - right.seat);
      state.status = state.players.length >= 2
        ? `${info.name} joined the table. Start a hand when you are ready.`
        : `${info.name} took a seat. Invite more players to begin.`;
      pushLog(state, `${info.name} joined seat ${seat + 1}.`, 'info');
      return player;
    }
  }

  return null;
}

function removePlayer(state, playerId) {
  const player = findPlayer(state, playerId);
  if (!player) {
    return false;
  }

  if (player.cards.length === 2 && state.stage !== 'waiting' && state.stage !== 'showdown') {
    player.folded = true;
    player.leaving = true;
    player.lastAction = 'Disconnected';
    pushLog(state, `${player.name} disconnected and their hand was folded.`, 'warn');
    if (state.actionSeat === player.seat) {
      resolveAfterAction(state, player.seat);
    }
    return true;
  }

  state.players = state.players.filter((entry) => entry.id !== playerId);
  state.status = state.players.length >= 2
    ? `${player.name} left the table.`
    : 'Not enough seated players to start a hand.';
  pushLog(state, `${player.name} left the table.`, 'warn');
  return true;
}

function startHand(state, playerId) {
  const initiator = findPlayer(state, playerId);
  if (!initiator) {
    return { ok: false, error: 'That player is not seated at the table.' };
  }
  if (!(state.stage === 'waiting' || state.stage === 'showdown')) {
    return { ok: false, error: 'Wait for the current hand to finish before starting the next one.' };
  }

  cleanupLeavers(state);
  const eligible = dealEligiblePlayers(state);
  if (eligible.length < 2) {
    return { ok: false, error: 'At least two players with chips are needed to start a hand.' };
  }

  state.handNumber += 1;
  state.stage = 'preflop';
  state.deck = createDeck();
  state.community = [];
  state.pot = 0;
  state.currentBet = 0;
  state.minRaise = state.bigBlind;
  state.players.forEach((player) => {
    player.cards = [];
    player.folded = player.stack <= 0 || player.leaving;
    player.allIn = false;
    player.acted = false;
    player.bet = 0;
    player.totalContribution = 0;
    player.lastAction = player.stack > 0 ? 'Ready' : 'Busted';
  });

  let dealer;
  if (eligible.length === 2) {
    dealer = nextSeatPlayer(state, state.dealerSeat < 0 ? MAX_SEATS - 1 : state.dealerSeat, (player) => player.stack > 0 && !player.leaving);
    state.dealerSeat = dealer.seat;
    const bigBlind = nextSeatPlayer(state, dealer.seat, (player) => player.stack > 0 && !player.leaving);
    state.smallBlindSeat = dealer.seat;
    state.bigBlindSeat = bigBlind.seat;
    dealHoleCards(state);
    postBlind(state, dealer, state.smallBlind, 'SB');
    postBlind(state, bigBlind, state.bigBlind, 'BB');
    state.currentBet = bigBlind.bet;
    state.minRaise = state.bigBlind;
    state.actionSeat = dealer.seat;
  } else {
    dealer = nextSeatPlayer(state, state.dealerSeat < 0 ? MAX_SEATS - 1 : state.dealerSeat, (player) => player.stack > 0 && !player.leaving);
    state.dealerSeat = dealer.seat;
    const smallBlind = nextSeatPlayer(state, dealer.seat, (player) => player.stack > 0 && !player.leaving);
    const bigBlind = nextSeatPlayer(state, smallBlind.seat, (player) => player.stack > 0 && !player.leaving);
    state.smallBlindSeat = smallBlind.seat;
    state.bigBlindSeat = bigBlind.seat;
    dealHoleCards(state);
    postBlind(state, smallBlind, state.smallBlind, 'SB');
    postBlind(state, bigBlind, state.bigBlind, 'BB');
    state.currentBet = bigBlind.bet;
    state.minRaise = state.bigBlind;
    setNextActionSeat(state, bigBlind.seat);
  }

  state.status = `Hand ${state.handNumber} live. ${dealer.name} has the button.`;
  pushLog(state, `${initiator.name} started hand ${state.handNumber}.`, 'good');
  return { ok: true, message: `${initiator.name} dealt a new hand.` };
}

function resetTable(state) {
  const title = state.title;
  const roomCode = state.roomCode;
  const players = seatedPlayers(state).map((player) => ({
    id: player.id,
    name: player.name,
    seat: player.seat,
  }));
  const fresh = createGameState();
  Object.assign(state, fresh);
  state.title = title;
  state.roomCode = roomCode;
  state.players = players.map((player) => {
    const next = createPlayer(player.id, player.name, player.seat);
    return next;
  });
  pushLog(state, 'The table was reset to fresh stacks.', 'warn');
  state.status = state.players.length >= 2
    ? 'The table was reset. Start a new hand when ready.'
    : 'The table was reset. Invite more players to begin.';
  return { ok: true };
}

function computeControls(state, viewer) {
  const base = {
    canStartHand: viewer && (state.stage === 'waiting' || state.stage === 'showdown') && dealEligiblePlayers(state).length >= 2,
    canResetTable: Boolean(viewer),
    canAct: false,
    toCall: 0,
    minRaiseTo: 0,
    maxRaiseTo: viewer ? viewer.bet + viewer.stack : 0,
    quickTargets: [],
    checkLabel: 'Check',
  };

  if (!viewer || state.actionSeat !== viewer.seat || viewer.folded || viewer.allIn) {
    return base;
  }

  const toCall = Math.max(0, state.currentBet - viewer.bet);
  const maxRaiseTo = viewer.bet + viewer.stack;
  const quickTargets = [];
  base.canAct = true;
  base.toCall = toCall;
  base.checkLabel = toCall > 0 ? `Call ${toCall}` : 'Check';
  base.maxRaiseTo = maxRaiseTo;

  if (state.currentBet === 0) {
    if (viewer.stack > 0) {
      quickTargets.push(
        Math.min(maxRaiseTo, state.bigBlind),
        Math.min(maxRaiseTo, state.bigBlind * 2),
        Math.min(maxRaiseTo, Math.max(state.bigBlind * 4, state.pot || state.bigBlind * 3))
      );
    }
    base.minRaiseTo = Math.min(maxRaiseTo, state.bigBlind);
  } else {
    const minRaiseTo = Math.min(maxRaiseTo, state.currentBet + state.minRaise);
    quickTargets.push(
      minRaiseTo,
      Math.min(maxRaiseTo, state.currentBet * 2),
      Math.min(maxRaiseTo, state.currentBet + Math.max(state.pot, state.bigBlind * 2))
    );
    base.minRaiseTo = minRaiseTo;
  }

  base.quickTargets = [...new Set(quickTargets.filter((amount) => amount > state.currentBet && amount <= maxRaiseTo))];
  return base;
}

function cardListForViewer(player, viewerId, showAll) {
  if (!player.cards.length) {
    return [];
  }
  if (showAll || player.id === viewerId) {
    return player.cards.map(cloneCard);
  }
  return player.cards.map(() => null);
}

function cloneState(state, viewerId) {
  const viewer = findPlayer(state, viewerId);
  const revealAll = state.stage === 'showdown';
  return {
    title: state.title,
    roomCode: state.roomCode,
    stage: state.stage,
    handNumber: state.handNumber,
    status: state.status,
    dealerSeat: state.dealerSeat,
    smallBlindSeat: state.smallBlindSeat,
    bigBlindSeat: state.bigBlindSeat,
    actionSeat: state.actionSeat,
    smallBlind: state.smallBlind,
    bigBlind: state.bigBlind,
    pot: state.pot,
    currentBet: state.currentBet,
    minRaise: state.minRaise,
    community: state.community.map(cloneCard),
    viewerSeat: viewer ? viewer.seat : null,
    controls: computeControls(state, viewer),
    log: state.log.map((entry) => ({ ...entry })),
    players: seatedPlayers(state, { includeLeavers: true }).map((player) => {
      const cards = cardListForViewer(player, viewerId, revealAll);
      const showRank = revealAll || player.id === viewerId;
      const best = player.cards.length && state.community.length >= 3
        ? bestOfSeven([...player.cards, ...state.community])
        : null;
      return {
        id: player.id,
        name: player.name,
        seat: player.seat,
        stack: player.stack,
        bet: player.bet,
        totalContribution: player.totalContribution,
        folded: player.folded,
        allIn: player.allIn,
        leaving: player.leaving,
        lastAction: player.lastAction,
        cards,
        cardCount: player.cards.length,
        bestHandLabel: showRank && best ? rankLabel(best) : '',
      };
    }),
  };
}

function applyAction(state, playerId, action) {
  const player = findPlayer(state, playerId);
  if (!player) {
    return { ok: false, error: 'You are not seated at the table.' };
  }
  if (!(state.stage === 'preflop' || state.stage === 'flop' || state.stage === 'turn' || state.stage === 'river')) {
    return { ok: false, error: 'There is no active hand right now.' };
  }
  if (state.actionSeat !== player.seat) {
    return { ok: false, error: 'It is not your turn.' };
  }
  if (player.folded || player.allIn) {
    return { ok: false, error: 'That seat cannot act right now.' };
  }

  const type = String((action && action.type) || '').trim().toLowerCase();
  const toCall = Math.max(0, state.currentBet - player.bet);
  const maxRaiseTo = player.bet + player.stack;
  let message = '';
  let reopened = false;

  if (type === 'fold') {
    player.folded = true;
    player.acted = true;
    player.lastAction = 'Fold';
    message = `${player.name} folded.`;
  } else if (type === 'check') {
    if (toCall > 0) {
      return { ok: false, error: `You need ${toCall} chips to call.` };
    }
    player.acted = true;
    player.lastAction = 'Check';
    message = `${player.name} checked.`;
  } else if (type === 'call') {
    const paid = placeBet(state, player, toCall);
    player.acted = true;
    player.lastAction = paid < toCall ? `All-in ${player.bet}` : `Call ${paid}`;
    message = paid < toCall
      ? `${player.name} called short and is all-in.`
      : `${player.name} called ${paid}.`;
  } else if (type === 'bet') {
    if (state.currentBet !== 0) {
      return { ok: false, error: 'Use raise once betting has started.' };
    }
    const target = Math.max(0, Number(action.amount) || 0);
    if (target <= 0) {
      return { ok: false, error: 'Enter a bet size.' };
    }
    if (target > maxRaiseTo) {
      return { ok: false, error: 'That bet is larger than your stack.' };
    }
    if (target < state.bigBlind && target !== maxRaiseTo) {
      return { ok: false, error: `Minimum opening bet is ${state.bigBlind}.` };
    }
    placeBet(state, player, target);
    state.currentBet = player.bet;
    state.minRaise = Math.max(state.bigBlind, player.bet);
    reopened = player.bet >= state.bigBlind;
    player.lastAction = player.allIn ? `All-in ${player.bet}` : `Bet ${player.bet}`;
    message = `${player.name} bet ${player.bet}.`;
  } else if (type === 'raise') {
    if (state.currentBet === 0) {
      return { ok: false, error: 'Use bet before any wager exists.' };
    }
    const target = Math.max(0, Number(action.amount) || 0);
    if (target <= state.currentBet) {
      return { ok: false, error: 'Raise must be larger than the current bet.' };
    }
    if (target > maxRaiseTo) {
      return { ok: false, error: 'That raise is larger than your stack.' };
    }

    const raiseSize = target - state.currentBet;
    const fullRaise = raiseSize >= state.minRaise;
    if (!fullRaise && target !== maxRaiseTo) {
      return { ok: false, error: `Minimum raise is to ${state.currentBet + state.minRaise}.` };
    }

    const additional = target - player.bet;
    placeBet(state, player, additional);
    if (player.bet > state.currentBet) {
      if (fullRaise) {
        state.minRaise = player.bet - state.currentBet;
        reopened = true;
      }
      state.currentBet = player.bet;
    }
    player.lastAction = player.allIn ? `All-in ${player.bet}` : `Raise to ${player.bet}`;
    message = `${player.name} raised to ${player.bet}.`;
  } else {
    return { ok: false, error: 'Unknown poker action.' };
  }

  if (reopened) {
    actorsForStreet(state).forEach((other) => {
      other.acted = other.id === player.id;
    });
  } else {
    player.acted = true;
  }

  pushLog(state, message, reopened ? 'good' : 'info');
  resolveAfterAction(state, player.seat);
  return { ok: true, message };
}

module.exports = {
  STARTING_STACK,
  SMALL_BLIND,
  BIG_BLIND,
  MAX_SEATS,
  createGameState,
  cloneState,
  addPlayer,
  removePlayer,
  startHand,
  resetTable,
  applyAction,
};
