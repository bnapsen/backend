'use strict';

const SUITS = ['S', 'H', 'D', 'C'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const SHOE_DECKS = 6;
const STARTING_STACK = 1000;
const DEFAULT_BET = 25;
const MAX_SEATS = 6;
const MAX_LOG = 16;

function cloneCard(card) {
  return card ? { rank: card.rank, suit: card.suit } : null;
}

function createDeck() {
  const deck = [];
  for (let deckIndex = 0; deckIndex < SHOE_DECKS; deckIndex += 1) {
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        deck.push({ rank, suit });
      }
    }
  }
  for (let index = deck.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [deck[index], deck[swapIndex]] = [deck[swapIndex], deck[index]];
  }
  return deck;
}

function cardValue(rank) {
  if (rank === 'A') {
    return 11;
  }
  if (rank === 'K' || rank === 'Q' || rank === 'J') {
    return 10;
  }
  return Number(rank);
}

function handSummary(cards) {
  let total = cards.reduce((sum, card) => sum + cardValue(card.rank), 0);
  let aces = cards.filter((card) => card.rank === 'A').length;
  while (total > 21 && aces > 0) {
    total -= 10;
    aces -= 1;
  }
  return {
    total,
    soft: aces > 0,
    blackjack: cards.length === 2 && total === 21,
  };
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
    bet: DEFAULT_BET,
    activeBet: 0,
    cards: [],
    participating: false,
    done: false,
    busted: false,
    blackjack: false,
    lastOutcome: '',
    result: '',
    status: 'Ready for the next deal.',
    leaving: false,
  };
}

function createGameState() {
  const state = {
    title: 'Royal SuperSplash Blackjack Live',
    roomCode: '',
    phase: 'betting',
    handNumber: 0,
    status: 'Seat players, set wagers, and press Deal when the table is ready.',
    dealer: {
      cards: [],
      hiddenHole: true,
    },
    players: [],
    shoe: createDeck(),
    actionSeat: null,
    tableBetTotal: 0,
    log: [
      createLogEntry(
        'Royal SuperSplash Blackjack Live is ready. Seat up to six players and play against the dealer.',
        'info'
      ),
    ],
  };
  return state;
}

function seatedPlayers(state, options) {
  const includeLeavers = options && options.includeLeavers;
  return state.players
    .filter((player) => includeLeavers || !player.leaving)
    .sort((left, right) => left.seat - right.seat);
}

function findPlayer(state, playerId) {
  return state.players.find((player) => player.id === playerId) || null;
}

function playerAtSeat(state, seat) {
  return state.players.find((player) => player.seat === seat) || null;
}

function cleanupLeavers(state) {
  state.players = state.players.filter((player) => !(player.leaving && !player.participating));
}

function activePlayers(state) {
  return seatedPlayers(state, { includeLeavers: true }).filter((player) => player.participating);
}

function unresolvedPlayers(state) {
  return activePlayers(state).filter((player) => !player.done);
}

function recalcTableBetTotal(state) {
  state.tableBetTotal = activePlayers(state).reduce((sum, player) => sum + player.activeBet, 0);
}

function maybeReshuffle(state, force) {
  if (!force && state.shoe.length >= 52) {
    return false;
  }
  state.shoe = createDeck();
  pushLog(state, 'The dealer reshuffled the shoe.', 'warn');
  return true;
}

function drawCard(state, target) {
  maybeReshuffle(state, false);
  const card = state.shoe.pop();
  if (card) {
    target.push(card);
  }
  return card || null;
}

function currentDealerScoreLabel(state) {
  if (!state.dealer.cards.length) {
    return '?';
  }
  if (state.dealer.hiddenHole && state.dealer.cards.length > 1) {
    return `${cardValue(state.dealer.cards[0].rank)} + ?`;
  }
  return String(handSummary(state.dealer.cards).total);
}

function participantOrder(state) {
  return activePlayers(state).map((player) => player.seat);
}

function nextUnresolvedSeat(state, fromSeat) {
  const activeSeats = participantOrder(state);
  if (!activeSeats.length) {
    return null;
  }
  for (let offset = 1; offset <= MAX_SEATS; offset += 1) {
    const seat = (fromSeat + offset + MAX_SEATS) % MAX_SEATS;
    const player = playerAtSeat(state, seat);
    if (player && player.participating && !player.done) {
      return player.seat;
    }
  }
  return null;
}

function revealDealer(state) {
  state.dealer.hiddenHole = false;
}

function settleRound(state) {
  revealDealer(state);
  const dealerSummary = handSummary(state.dealer.cards);
  const winners = [];
  const pushes = [];

  for (const player of activePlayers(state)) {
    const summary = handSummary(player.cards);
    let payout = 0;
    let outcome = 'lose';
    let result = 'Dealer wins.';

    if (player.blackjack && dealerSummary.blackjack) {
      payout = player.activeBet;
      outcome = 'push';
      result = 'Push with dealer blackjack.';
      pushes.push(player.name);
    } else if (player.blackjack) {
      payout = Math.floor(player.activeBet * 2.5);
      outcome = 'blackjack';
      result = 'Blackjack pays 3:2.';
      winners.push(player.name);
    } else if (player.busted) {
      payout = 0;
      outcome = 'lose';
      result = 'Bust.';
    } else if (dealerSummary.total > 21) {
      payout = player.activeBet * 2;
      outcome = 'win';
      result = 'Dealer busts. You win.';
      winners.push(player.name);
    } else if (dealerSummary.blackjack) {
      payout = 0;
      outcome = 'lose';
      result = 'Dealer blackjack.';
    } else if (summary.total > dealerSummary.total) {
      payout = player.activeBet * 2;
      outcome = 'win';
      result = 'You beat the dealer.';
      winners.push(player.name);
    } else if (summary.total === dealerSummary.total) {
      payout = player.activeBet;
      outcome = 'push';
      result = 'Push.';
      pushes.push(player.name);
    }

    player.stack += payout;
    player.lastOutcome = outcome;
    player.result = result;
    player.status = result;
    player.participating = false;
    player.done = true;
    if (player.stack <= 0) {
      player.bet = 0;
      player.status = `${result} Out of chips.`;
    } else if (player.bet > player.stack) {
      player.bet = player.stack;
    } else if (player.bet === 0) {
      player.bet = Math.min(DEFAULT_BET, player.stack);
    }

    pushLog(
      state,
      `${player.name}: ${result} ${payout ? `Payout ${payout}.` : ''}`.trim(),
      outcome === 'lose' ? 'bad' : outcome === 'push' ? 'warn' : 'good'
    );
  }

  recalcTableBetTotal(state);
  state.phase = 'settled';
  state.actionSeat = null;

  if (winners.length && pushes.length) {
    state.status = `${winners.join(', ')} beat the dealer. ${pushes.join(', ')} pushed.`;
  } else if (winners.length) {
    state.status = `${winners.join(', ')} beat the dealer.`;
  } else if (pushes.length) {
    state.status = `${pushes.join(', ')} pushed against the dealer.`;
  } else {
    state.status = 'Dealer wins the table.';
  }

  cleanupLeavers(state);
}

function dealerTurn(state) {
  state.phase = 'dealer-turn';
  state.actionSeat = null;
  revealDealer(state);
  pushLog(state, 'Dealer reveals the hole card.', 'info');

  if (activePlayers(state).every((player) => player.busted)) {
    settleRound(state);
    return;
  }

  while (handSummary(state.dealer.cards).total < 17) {
    drawCard(state, state.dealer.cards);
  }

  settleRound(state);
}

function advanceTurn(state, seat) {
  const nextSeat = nextUnresolvedSeat(state, seat);
  if (nextSeat === null) {
    dealerTurn(state);
    return;
  }
  state.actionSeat = nextSeat;
  const nextPlayer = playerAtSeat(state, nextSeat);
  state.status = nextPlayer ? `${nextPlayer.name} to act.` : state.status;
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
      state.status = state.players.length > 1
        ? `${info.name} joined the blackjack table.`
        : `${info.name} took the first seat.`;
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

  if (player.participating && (state.phase === 'player-turns' || state.phase === 'dealer-turn')) {
    player.done = true;
    player.leaving = true;
    player.status = 'Disconnected. Hand forfeited.';
    player.result = 'Disconnected.';
    player.busted = true;
    pushLog(state, `${player.name} disconnected and forfeited the hand.`, 'warn');
    if (state.phase === 'player-turns' && state.actionSeat === player.seat) {
      advanceTurn(state, player.seat);
    }
    return true;
  }

  state.players = state.players.filter((entry) => entry.id !== playerId);
  pushLog(state, `${player.name} left the table.`, 'warn');
  state.status = state.players.length
    ? `${player.name} left the blackjack table.`
    : 'Table open. Seat players and set wagers to begin.';
  recalcTableBetTotal(state);
  return true;
}

function setBet(state, playerId, amount, mode) {
  const player = findPlayer(state, playerId);
  if (!player) {
    return { ok: false, error: 'You are not seated at the blackjack table.' };
  }
  if (!(state.phase === 'betting' || state.phase === 'settled')) {
    return { ok: false, error: 'Wait for the current round to finish before changing your bet.' };
  }
  if (player.stack <= 0) {
    return { ok: false, error: 'You are out of chips. Reset the table for fresh stacks.' };
  }

  if (mode === 'clear') {
    player.bet = 0;
  } else {
    const delta = Number(amount) || 0;
    player.bet = Math.max(0, Math.min(player.stack, player.bet + delta));
  }

  player.status = player.bet > 0
    ? `Next bet ${player.bet}.`
    : 'Set a wager to join the next round.';
  state.status = `${player.name} adjusted their bet.`;
  recalcTableBetTotal(state);
  return { ok: true, message: `${player.name} set the next wager to ${player.bet}.` };
}

function startRound(state, playerId) {
  const initiator = findPlayer(state, playerId);
  if (!initiator) {
    return { ok: false, error: 'That player is not seated at the table.' };
  }
  if (!(state.phase === 'betting' || state.phase === 'settled')) {
    return { ok: false, error: 'Wait for the current round to finish before dealing again.' };
  }

  cleanupLeavers(state);
  maybeReshuffle(state, false);

  const eligible = seatedPlayers(state, { includeLeavers: true }).filter((player) => !player.leaving && player.stack > 0 && player.bet > 0);
  if (!eligible.length) {
    return { ok: false, error: 'At least one seated player needs a wager before the dealer can deal.' };
  }

  state.handNumber += 1;
  state.phase = 'player-turns';
  state.dealer.cards = [];
  state.dealer.hiddenHole = true;
  state.actionSeat = null;
  state.tableBetTotal = 0;

  for (const player of seatedPlayers(state, { includeLeavers: true })) {
    player.cards = [];
    player.activeBet = 0;
    player.participating = false;
    player.done = false;
    player.busted = false;
    player.blackjack = false;
    player.lastOutcome = '';
    player.result = '';
    if (player.leaving || player.stack <= 0 || player.bet <= 0) {
      player.status = player.stack > 0 ? 'Waiting for next round.' : 'Out of chips.';
      continue;
    }
    const reservedBet = Math.min(player.bet, player.stack);
    player.stack -= reservedBet;
    player.activeBet = reservedBet;
    player.participating = true;
    player.status = 'Cards in the air...';
    state.tableBetTotal += reservedBet;
  }

  const order = eligible.map((player) => player.seat);
  for (const seat of order) {
    drawCard(state, playerAtSeat(state, seat).cards);
  }
  drawCard(state, state.dealer.cards);
  for (const seat of order) {
    drawCard(state, playerAtSeat(state, seat).cards);
  }
  drawCard(state, state.dealer.cards);

  const dealerSummary = handSummary(state.dealer.cards);
  for (const player of eligible) {
    const summary = handSummary(player.cards);
    player.blackjack = summary.blackjack;
    player.done = summary.blackjack;
    player.status = summary.blackjack ? 'Blackjack.' : `Live on ${summary.total}.`;
  }

  pushLog(state, `${initiator.name} dealt round ${state.handNumber}.`, 'good');

  if (dealerSummary.blackjack || eligible.every((player) => player.done)) {
    settleRound(state);
    return { ok: true, message: `${initiator.name} dealt round ${state.handNumber}.` };
  }

  const firstSeat = nextUnresolvedSeat(state, order[order.length - 1]);
  state.actionSeat = firstSeat;
  const firstPlayer = firstSeat === null ? null : playerAtSeat(state, firstSeat);
  state.status = firstPlayer
    ? `Round ${state.handNumber} live. ${firstPlayer.name} to act.`
    : `Round ${state.handNumber} live.`;
  return { ok: true, message: `${initiator.name} dealt round ${state.handNumber}.` };
}

function applyAction(state, playerId, action) {
  const player = findPlayer(state, playerId);
  if (!player) {
    return { ok: false, error: 'You are not seated at the blackjack table.' };
  }
  if (state.phase !== 'player-turns') {
    return { ok: false, error: 'There is no live blackjack round right now.' };
  }
  if (state.actionSeat !== player.seat) {
    return { ok: false, error: 'It is not your turn yet.' };
  }
  if (!player.participating || player.done) {
    return { ok: false, error: 'That seat cannot act right now.' };
  }

  const type = String(action && action.type || '').trim().toLowerCase();
  let message = '';

  if (type === 'hit') {
    drawCard(state, player.cards);
    const summary = handSummary(player.cards);
    if (summary.total > 21) {
      player.busted = true;
      player.done = true;
      player.status = `Bust on ${summary.total}.`;
      player.result = 'Bust.';
      message = `${player.name} busted on ${summary.total}.`;
      pushLog(state, message, 'bad');
      advanceTurn(state, player.seat);
      return { ok: true, message };
    }
    if (summary.total === 21) {
      player.done = true;
      player.status = '21. Standing.';
      message = `${player.name} hit to 21.`;
      pushLog(state, message, 'good');
      advanceTurn(state, player.seat);
      return { ok: true, message };
    }
    player.status = `Hit to ${summary.total}.`;
    message = `${player.name} hit to ${summary.total}.`;
    state.status = `${player.name} can hit, stand, or double if allowed.`;
    pushLog(state, message, 'info');
    return { ok: true, message };
  }

  if (type === 'stand') {
    const summary = handSummary(player.cards);
    player.done = true;
    player.status = `Stand on ${summary.total}.`;
    player.result = `Standing on ${summary.total}.`;
    message = `${player.name} stands on ${summary.total}.`;
    pushLog(state, message, 'info');
    advanceTurn(state, player.seat);
    return { ok: true, message };
  }

  if (type === 'double') {
    if (player.cards.length !== 2) {
      return { ok: false, error: 'Double is only available on the first two cards.' };
    }
    if (player.stack < player.activeBet) {
      return { ok: false, error: 'You do not have enough chips to double this hand.' };
    }
    player.stack -= player.activeBet;
    player.activeBet *= 2;
    recalcTableBetTotal(state);
    drawCard(state, player.cards);
    const summary = handSummary(player.cards);
    player.done = true;
    if (summary.total > 21) {
      player.busted = true;
      player.status = `Double bust on ${summary.total}.`;
      player.result = 'Double bust.';
      message = `${player.name} doubled and busted.`;
      pushLog(state, message, 'bad');
    } else {
      player.status = `Double on ${summary.total}.`;
      player.result = `Double on ${summary.total}.`;
      message = `${player.name} doubled to ${player.activeBet}.`;
      pushLog(state, message, 'good');
    }
    advanceTurn(state, player.seat);
    return { ok: true, message };
  }

  return { ok: false, error: 'Unknown blackjack action.' };
}

function resetTable(state) {
  const title = state.title;
  const roomCode = state.roomCode;
  const players = seatedPlayers(state, { includeLeavers: true }).map((player) => ({
    id: player.id,
    name: player.name,
    seat: player.seat,
  }));
  const fresh = createGameState();
  Object.assign(state, fresh);
  state.title = title;
  state.roomCode = roomCode;
  state.players = players.map((player) => createPlayer(player.id, player.name, player.seat));
  state.status = state.players.length
    ? 'Fresh shoe loaded. Set wagers and press Deal.'
    : 'Table reset. Seat players to begin.';
  pushLog(state, 'The blackjack table was reset to fresh stacks.', 'warn');
  return { ok: true };
}

function computeControls(state, viewer) {
  const canAdjustBet = Boolean(
    viewer &&
    (state.phase === 'betting' || state.phase === 'settled') &&
    !viewer.leaving &&
    viewer.stack > 0
  );
  const canAct = Boolean(
    viewer &&
    state.phase === 'player-turns' &&
    state.actionSeat === viewer.seat &&
    viewer.participating &&
    !viewer.done
  );

  return {
    canStartRound: Boolean(
      viewer &&
      (state.phase === 'betting' || state.phase === 'settled') &&
      seatedPlayers(state, { includeLeavers: true }).some((player) => !player.leaving && player.stack > 0 && player.bet > 0)
    ),
    canResetTable: Boolean(viewer),
    canAdjustBet,
    canClearBet: canAdjustBet && viewer.bet > 0,
    canAct,
    canHit: canAct,
    canStand: canAct,
    canDouble: Boolean(canAct && viewer.cards.length === 2 && viewer.stack >= viewer.activeBet),
    betPresets: [5, 25, 100, -25],
  };
}

function cloneState(state, viewerId) {
  const viewer = findPlayer(state, viewerId);
  const visibleDealerCards = state.dealer.cards.map((card, index) => (
    state.dealer.hiddenHole && index === 1 ? null : cloneCard(card)
  ));

  return {
    title: state.title,
    roomCode: state.roomCode,
    phase: state.phase,
    handNumber: state.handNumber,
    status: state.status,
    actionSeat: state.actionSeat,
    tableBetTotal: state.tableBetTotal,
    shoeRemaining: state.shoe.length,
    viewerSeat: viewer ? viewer.seat : null,
    controls: computeControls(state, viewer),
    dealer: {
      cards: visibleDealerCards,
      hiddenHole: state.dealer.hiddenHole,
      scoreLabel: currentDealerScoreLabel(state),
      fullScore: state.dealer.hiddenHole ? null : handSummary(state.dealer.cards).total,
    },
    log: state.log.map((entry) => ({ ...entry })),
    players: seatedPlayers(state, { includeLeavers: true }).map((player) => {
      const summary = player.cards.length ? handSummary(player.cards) : null;
      return {
        id: player.id,
        name: player.name,
        seat: player.seat,
        stack: player.stack,
        bet: player.bet,
        activeBet: player.activeBet,
        cards: player.cards.map(cloneCard),
        participating: player.participating,
        done: player.done,
        busted: player.busted,
        blackjack: player.blackjack,
        lastOutcome: player.lastOutcome,
        result: player.result,
        statusText: player.status,
        leaving: player.leaving,
        score: summary ? summary.total : 0,
        scoreLabel: summary ? String(summary.total) : '-',
      };
    }),
  };
}

module.exports = {
  STARTING_STACK,
  DEFAULT_BET,
  MAX_SEATS,
  createGameState,
  cloneState,
  addPlayer,
  removePlayer,
  setBet,
  startRound,
  applyAction,
  resetTable,
};
