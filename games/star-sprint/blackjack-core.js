'use strict';

const SUITS = ['S', 'H', 'D', 'C'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const SHOE_DECKS = 6;
const SHOE_CARD_COUNT = SHOE_DECKS * SUITS.length * RANKS.length;
const CUT_CARD_REMAINING = Math.floor(SHOE_CARD_COUNT * 0.25);
const STARTING_STACK = 100000;
const DEFAULT_BET = 500;
const MAX_SEATS = 6;
const MAX_LOG = 16;
const MAX_SPLIT_HANDS = 4;

function formatSimCents(cents) {
  const sim = Math.round(Number(cents) || 0) / 100;
  return `${sim.toLocaleString('en-US', {
    minimumFractionDigits: Number.isInteger(sim) ? 0 : 2,
    maximumFractionDigits: 2,
  })} SIM`;
}

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

function createPlayer(id, name, seat, options = {}) {
  const walletCents = Math.max(0, Math.round(Number(options.walletCents ?? STARTING_STACK) || 0));
  const defaultBet = Math.min(DEFAULT_BET, walletCents);
  return {
    id,
    name,
    seat,
    stack: walletCents,
    walletCents,
    bet: defaultBet,
    activeBet: 0,
    cards: [],
    hands: [],
    activeHandIndex: 0,
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
    title: 'AP Blackjack Live',
    roomCode: '',
    phase: 'betting',
    handNumber: 0,
    status: 'Seat signed-in players, set SIM wagers, and press Deal when the table is ready.',
    dealer: {
      cards: [],
      hiddenHole: true,
    },
    players: [],
    shoe: createDeck(),
    discard: [],
    cutCardRemaining: CUT_CARD_REMAINING,
    shufflePending: false,
    actionSeat: null,
    tableBetTotal: 0,
    pendingWalletEvents: [],
    log: [
      createLogEntry(
        'AP Blackjack Live is ready. Bets debit and credit your signed-in SIM wallet.',
        'info'
      ),
    ],
  };
  return state;
}

function queueWalletEvent(state, player, amountCents, action, note, metadata = {}) {
  if (!player || !amountCents) {
    return;
  }
  if (!Array.isArray(state.pendingWalletEvents)) {
    state.pendingWalletEvents = [];
  }
  state.pendingWalletEvents.push({
    playerId: player.id,
    amountCents: Math.round(Number(amountCents) || 0),
    action,
    note,
    metadata: {
      seat: player.seat,
      handNumber: state.handNumber,
      activeBet: player.activeBet,
      ...metadata,
    },
  });
}

function drainWalletEvents(state) {
  const events = Array.isArray(state.pendingWalletEvents)
    ? state.pendingWalletEvents.map((event) => ({
        playerId: event.playerId,
        amountCents: Math.round(Number(event.amountCents) || 0),
        action: String(event.action || 'adjust'),
        note: String(event.note || ''),
        metadata: event.metadata && typeof event.metadata === 'object' ? { ...event.metadata } : {},
      })).filter((event) => event.playerId && event.amountCents)
    : [];
  state.pendingWalletEvents = [];
  return events;
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

function syncPlayerWallet(state, playerId, walletCents) {
  const player = findPlayer(state, playerId);
  if (!player) {
    return null;
  }
  const balance = Math.max(0, Math.round(Number(walletCents) || 0));
  player.stack = balance;
  player.walletCents = balance;
  if (!player.participating) {
    player.activeBet = 0;
    player.hands = [];
    player.activeHandIndex = 0;
  } else {
    syncPlayerFromHands(player);
  }
  if (player.bet > balance) {
    player.bet = balance;
  }
  if (player.bet === 0 && balance > 0 && !player.participating) {
    player.bet = Math.min(DEFAULT_BET, balance);
  }
  return player;
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
  return activePlayers(state).filter((player) => hasLiveHand(player));
}

function recalcTableBetTotal(state) {
  for (const player of activePlayers(state)) {
    syncPlayerFromHands(player);
  }
  state.tableBetTotal = activePlayers(state).reduce((sum, player) => sum + activeBetTotal(player), 0);
}

function maybeReshuffle(state, force) {
  const cutRemaining = Math.max(1, Math.round(Number(state.cutCardRemaining) || CUT_CARD_REMAINING));
  if (!force && !state.shufflePending && state.shoe.length > cutRemaining) {
    return false;
  }
  state.shoe = createDeck();
  state.discard = [];
  state.cutCardRemaining = cutRemaining;
  state.shufflePending = false;
  pushLog(state, 'The dealer reshuffled the shoe.', 'warn');
  return true;
}

function drawCard(state, target) {
  if (!state.shoe.length) {
    maybeReshuffle(state, true);
  }
  const card = state.shoe.pop();
  if (card) {
    target.push(card);
    if (state.shoe.length <= Math.max(1, Math.round(Number(state.cutCardRemaining) || CUT_CARD_REMAINING))) {
      state.shufflePending = true;
    }
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
    if (player && hasLiveHand(player)) {
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
    const hands = playerHands(player);
    let totalPayout = 0;
    const handResults = [];
    const handOutcomes = [];

    for (const [index, hand] of hands.entries()) {
      const summary = handSummary(hand.cards);
      const bet = Math.max(0, Math.round(Number(hand.bet) || 0));
      let payout = 0;
      let outcome = 'lose';
      let result = 'Dealer wins.';

      if (hand.blackjack && dealerSummary.blackjack) {
        payout = bet;
        outcome = 'push';
        result = 'Push with dealer blackjack.';
      } else if (hand.blackjack) {
        payout = Math.floor(bet * 2.5);
        outcome = 'blackjack';
        result = 'Blackjack pays 3:2.';
      } else if (hand.busted || summary.total > 21) {
        payout = 0;
        outcome = 'lose';
        result = 'Bust.';
      } else if (dealerSummary.total > 21) {
        payout = bet * 2;
        outcome = 'win';
        result = 'Dealer busts. You win.';
      } else if (dealerSummary.blackjack) {
        payout = 0;
        outcome = 'lose';
        result = 'Dealer blackjack.';
      } else if (summary.total > dealerSummary.total) {
        payout = bet * 2;
        outcome = 'win';
        result = 'You beat the dealer.';
      } else if (summary.total === dealerSummary.total) {
        payout = bet;
        outcome = 'push';
        result = 'Push.';
      }

      totalPayout += payout;
      hand.done = true;
      hand.busted = hand.busted || summary.total > 21;
      hand.result = result;
      hand.status = `${handScoreLabel(hand)}: ${result}`;
      handResults.push(hands.length > 1 ? `Hand ${index + 1} ${result}` : result);
      handOutcomes.push(outcome);

      if (outcome === 'blackjack' || outcome === 'win') {
        winners.push(player.name);
      } else if (outcome === 'push') {
        pushes.push(player.name);
      }

      if (payout > 0) {
        queueWalletEvent(
          state,
          player,
          payout,
          'blackjack-payout',
          `${player.name}: ${hands.length > 1 ? `hand ${index + 1} ` : ''}${result}`,
          {
            outcome,
            payoutCents: payout,
            betCents: bet,
            handIndex: index,
          },
        );
      }
    }

    player.stack += totalPayout;
    player.walletCents = player.stack;
    player.activeBet = activeBetTotal(player);
    player.lastOutcome = handOutcomes.includes('blackjack')
      ? 'blackjack'
      : handOutcomes.includes('win')
        ? 'win'
        : handOutcomes.includes('push') && !handOutcomes.includes('lose')
          ? 'push'
          : 'lose';
    player.result = handResults.join(' ');
    player.status = player.result;
    player.participating = false;
    player.done = true;
    player.busted = hands.length > 0 && hands.every((hand) => hand.busted);
    player.blackjack = hands.some((hand) => hand.blackjack);

    if (player.stack <= 0) {
      player.bet = 0;
      player.status = `${player.result} Out of chips.`;
    } else if (player.bet > player.stack) {
      player.bet = player.stack;
    } else if (player.bet === 0) {
      player.bet = Math.min(DEFAULT_BET, player.stack);
    }

    pushLog(
      state,
      `${player.name}: ${player.result} ${totalPayout ? `Payout ${formatSimCents(totalPayout)}.` : ''}`.trim(),
      player.lastOutcome === 'lose' ? 'bad' : player.lastOutcome === 'push' ? 'warn' : 'good'
    );
  }

  recalcTableBetTotal(state);
  state.phase = 'settled';
  state.actionSeat = null;

  const winningNames = [...new Set(winners)];
  const pushingNames = [...new Set(pushes)];
  if (winningNames.length && pushingNames.length) {
    state.status = `${winningNames.join(', ')} beat the dealer. ${pushingNames.join(', ')} pushed.`;
  } else if (winningNames.length) {
    state.status = `${winningNames.join(', ')} beat the dealer.`;
  } else if (pushingNames.length) {
    state.status = `${pushingNames.join(', ')} pushed against the dealer.`;
  } else {
    state.status = 'Dealer wins the table.';
  }

  cleanupLeavers(state);
  if (state.shufflePending) {
    pushLog(state, 'Cut card reached. The shoe will reshuffle before the next hand.', 'warn');
  }
}

function dealerTurn(state) {
  state.phase = 'dealer-turn';
  state.actionSeat = null;
  revealDealer(state);
  pushLog(state, 'Dealer reveals the hole card.', 'info');

  const everyLiveHandBusted = activePlayers(state).every((player) => (
    playerHands(player).every((hand) => hand.busted || handSummary(hand.cards).total > 21)
  ));
  if (everyLiveHandBusted) {
    settleRound(state);
    return;
  }

  while (handSummary(state.dealer.cards).total < 17) {
    drawCard(state, state.dealer.cards);
  }

  settleRound(state);
}

function advanceTurn(state, seat) {
  const player = playerAtSeat(state, seat);
  if (player && hasLiveHand(player)) {
    const nextHandIndex = nextPlayableHandIndex(player, player.activeHandIndex);
    if (nextHandIndex !== -1) {
      player.activeHandIndex = nextHandIndex;
      syncPlayerFromHands(player);
      state.actionSeat = player.seat;
      state.status = `${player.name} to act on hand ${nextHandIndex + 1}.`;
      return;
    }
    syncPlayerFromHands(player);
  }

  const nextSeat = nextUnresolvedSeat(state, seat);
  if (nextSeat === null) {
    dealerTurn(state);
    return;
  }
  state.actionSeat = nextSeat;
  const nextPlayer = playerAtSeat(state, nextSeat);
  if (nextPlayer) {
    const handIndex = nextPlayableHandIndex(nextPlayer, -1);
    nextPlayer.activeHandIndex = Math.max(0, handIndex);
    syncPlayerFromHands(nextPlayer);
  }
  state.status = nextPlayer ? `${nextPlayer.name} to act.` : state.status;
}

function addPlayer(state, info) {
  const existing = findPlayer(state, info.id);
  if (existing) {
    existing.name = info.name;
    if (Number.isFinite(Number(info.walletCents))) {
      syncPlayerWallet(state, existing.id, info.walletCents);
    }
    return existing;
  }

  for (let seat = 0; seat < MAX_SEATS; seat += 1) {
    if (!playerAtSeat(state, seat)) {
      const player = createPlayer(info.id, info.name, seat, {
        walletCents: info.walletCents,
      });
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
    for (const hand of playerHands(player)) {
      hand.done = true;
      hand.busted = true;
      hand.result = 'Disconnected.';
      hand.status = 'Forfeited.';
    }
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
    return { ok: false, error: 'Your SIM wallet is empty.' };
  }

  if (mode === 'clear') {
    player.bet = 0;
  } else {
    const delta = Number(amount) || 0;
    player.bet = Math.max(0, Math.min(player.stack, player.bet + delta));
  }

  player.status = player.bet > 0
    ? `Next SIM bet ${formatSimCents(player.bet)}.`
    : 'Set a wager to join the next round.';
  state.status = `${player.name} adjusted their bet.`;
  recalcTableBetTotal(state);
  return { ok: true, message: `${player.name} set the next wager to ${formatSimCents(player.bet)}.` };
}

function startRound(state, playerId) {
  const initiator = findPlayer(state, playerId);
  if (!initiator) {
    return { ok: false, error: 'That player is not seated at the table.' };
  }
  if (!(state.phase === 'betting' || state.phase === 'settled')) {
    return { ok: false, error: 'Wait for the current round to finish before dealing again.' };
  }

  collectTableCards(state);
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
    player.hands = [];
    player.activeHandIndex = 0;
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
    player.walletCents = player.stack;
    player.hands = [createHand(reservedBet)];
    player.activeBet = reservedBet;
    player.participating = true;
    player.status = 'Cards in the air...';
    state.tableBetTotal += reservedBet;
    queueWalletEvent(
      state,
      player,
      -reservedBet,
      'blackjack-bet',
      `${player.name} posted a blackjack SIM bet.`,
      {
        betCents: reservedBet,
      },
    );
  }

  const order = eligible.map((player) => player.seat);
  for (const seat of order) {
    drawCard(state, currentHand(playerAtSeat(state, seat)).cards);
  }
  drawCard(state, state.dealer.cards);
  for (const seat of order) {
    drawCard(state, currentHand(playerAtSeat(state, seat)).cards);
  }
  drawCard(state, state.dealer.cards);

  const dealerSummary = handSummary(state.dealer.cards);
  for (const player of eligible) {
    const hand = currentHand(player);
    const summary = handSummary(hand.cards);
    hand.blackjack = summary.blackjack;
    hand.done = summary.blackjack;
    hand.status = summary.blackjack ? 'Blackjack.' : `Live on ${summary.total}.`;
    player.blackjack = summary.blackjack;
    player.done = summary.blackjack;
    player.status = hand.status;
    syncPlayerFromHands(player);
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
  const hand = currentHand(player);
  if (!hand || hand.done) {
    syncPlayerFromHands(player);
    return { ok: false, error: 'That hand cannot act right now.' };
  }

  let message = '';

  if (type === 'hit') {
    drawCard(state, hand.cards);
    const summary = handSummary(hand.cards);
    if (summary.total > 21) {
      hand.busted = true;
      hand.done = true;
      hand.status = `Bust on ${summary.total}.`;
      hand.result = 'Bust.';
      syncPlayerFromHands(player);
      message = `${player.name} busted hand ${player.activeHandIndex + 1} on ${summary.total}.`;
      pushLog(state, message, 'bad');
      advanceTurn(state, player.seat);
      return { ok: true, message };
    }
    if (summary.total === 21) {
      hand.done = true;
      hand.status = '21. Standing.';
      hand.result = 'Standing on 21.';
      syncPlayerFromHands(player);
      message = `${player.name} hit hand ${player.activeHandIndex + 1} to 21.`;
      pushLog(state, message, 'good');
      advanceTurn(state, player.seat);
      return { ok: true, message };
    }
    hand.status = `Hit to ${summary.total}.`;
    syncPlayerFromHands(player);
    message = `${player.name} hit hand ${player.activeHandIndex + 1} to ${summary.total}.`;
    state.status = `${player.name} can hit, stand, double, or split if allowed.`;
    pushLog(state, message, 'info');
    return { ok: true, message };
  }

  if (type === 'stand') {
    const summary = handSummary(hand.cards);
    hand.done = true;
    hand.status = `Stand on ${summary.total}.`;
    hand.result = `Standing on ${summary.total}.`;
    syncPlayerFromHands(player);
    message = `${player.name} stands hand ${player.activeHandIndex + 1} on ${summary.total}.`;
    pushLog(state, message, 'info');
    advanceTurn(state, player.seat);
    return { ok: true, message };
  }

  if (type === 'double') {
    if (hand.cards.length !== 2) {
      return { ok: false, error: 'Double is only available on the first two cards.' };
    }
    if (player.stack < hand.bet) {
      return { ok: false, error: 'You do not have enough SIM to double this hand.' };
    }
    const extraBet = hand.bet;
    player.stack -= extraBet;
    player.walletCents = player.stack;
    hand.bet += extraBet;
    hand.doubled = true;
    syncPlayerFromHands(player);
    queueWalletEvent(
      state,
      player,
      -extraBet,
      'blackjack-double',
      `${player.name} doubled their blackjack SIM bet.`,
      {
        doubleCents: extraBet,
        handIndex: player.activeHandIndex,
      },
    );
    recalcTableBetTotal(state);
    drawCard(state, hand.cards);
    const summary = handSummary(hand.cards);
    hand.done = true;
    if (summary.total > 21) {
      hand.busted = true;
      hand.status = `Double bust on ${summary.total}.`;
      hand.result = 'Double bust.';
      message = `${player.name} doubled hand ${player.activeHandIndex + 1} and busted.`;
      pushLog(state, message, 'bad');
    } else {
      hand.status = `Double on ${summary.total}.`;
      hand.result = `Double on ${summary.total}.`;
      message = `${player.name} doubled hand ${player.activeHandIndex + 1} to ${formatSimCents(hand.bet)}.`;
      pushLog(state, message, 'good');
    }
    syncPlayerFromHands(player);
    advanceTurn(state, player.seat);
    return { ok: true, message };
  }

  if (type === 'split') {
    if (!canSplitHand(player, hand)) {
      return { ok: false, error: 'Split is only available on a same-value two-card hand with enough SIM for the matching bet.' };
    }
    const splitBet = hand.bet;
    const [firstCard, secondCard] = hand.cards;
    const splitAces = firstCard.rank === 'A' && secondCard.rank === 'A';
    player.stack -= splitBet;
    player.walletCents = player.stack;
    hand.cards = [firstCard];
    hand.fromSplit = true;
    hand.splitAces = splitAces;
    hand.blackjack = false;
    hand.done = false;
    hand.busted = false;
    hand.result = '';
    hand.status = 'Split hand.';
    const newHand = createHand(splitBet, {
      cards: [secondCard],
      fromSplit: true,
      splitAces,
      status: 'Split hand.',
    });
    player.hands.splice(player.activeHandIndex + 1, 0, newHand);
    drawCard(state, hand.cards);
    drawCard(state, newHand.cards);

    for (const splitHand of [hand, newHand]) {
      const summary = handSummary(splitHand.cards);
      if (splitAces) {
        splitHand.done = true;
        splitHand.result = `Split aces on ${summary.total}.`;
        splitHand.status = splitHand.result;
      } else if (summary.total === 21) {
        splitHand.done = true;
        splitHand.result = 'Standing on 21.';
        splitHand.status = '21. Standing.';
      } else {
        splitHand.status = `Live on ${summary.total}.`;
      }
    }

    syncPlayerFromHands(player);
    queueWalletEvent(
      state,
      player,
      -splitBet,
      'blackjack-split',
      `${player.name} split a blackjack hand.`,
      {
        splitCents: splitBet,
        handIndex: player.activeHandIndex,
      },
    );
    recalcTableBetTotal(state);
    message = `${player.name} split into ${player.hands.length} hands.`;
    pushLog(state, message, 'good');
    state.status = splitAces
      ? `${player.name} split aces; each ace gets one card.`
      : `${player.name} split. Play hand ${player.activeHandIndex + 1}.`;
    if (hand.done) {
      advanceTurn(state, player.seat);
    }
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
    walletCents: player.walletCents ?? player.stack,
  }));
  const fresh = createGameState();
  Object.assign(state, fresh);
  state.title = title;
  state.roomCode = roomCode;
  state.players = players.map((player) => createPlayer(player.id, player.name, player.seat, {
    walletCents: player.walletCents,
  }));
  state.status = state.players.length
    ? 'Fresh shoe loaded. SIM balances refreshed. Set wagers and press Deal.'
    : 'Table reset. Seat players to begin.';
  pushLog(state, 'The blackjack table was reset with a fresh six-deck shoe.', 'warn');
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
    hasLiveHand(viewer)
  );
  const hand = currentHand(viewer);

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
    canDouble: Boolean(canAct && canDoubleHand(viewer, hand)),
    canSplit: Boolean(canAct && canSplitHand(viewer, hand)),
    betPresets: [100, 500, 2500, 10000, -500],
  };
}

function createHand(betCents = 0, options = {}) {
  return {
    id: options.id || `hand-${Math.random().toString(36).slice(2, 9)}`,
    cards: Array.isArray(options.cards) ? options.cards : [],
    bet: Math.max(0, Math.round(Number(betCents) || 0)),
    done: Boolean(options.done),
    busted: Boolean(options.busted),
    blackjack: Boolean(options.blackjack),
    doubled: Boolean(options.doubled),
    fromSplit: Boolean(options.fromSplit),
    splitAces: Boolean(options.splitAces),
    result: options.result || '',
    status: options.status || '',
  };
}

function playerHands(player) {
  if (!player) {
    return [];
  }
  if (!Array.isArray(player.hands)) {
    player.hands = [];
  }
  return player.hands;
}

function currentHand(player) {
  const hands = playerHands(player);
  if (!hands.length) {
    return null;
  }
  const index = Math.max(0, Math.min(hands.length - 1, Number(player.activeHandIndex) || 0));
  player.activeHandIndex = index;
  return hands[index] || null;
}

function activeBetTotal(player) {
  return playerHands(player).reduce((sum, hand) => sum + Math.max(0, Math.round(Number(hand.bet) || 0)), 0);
}

function syncPlayerFromHands(player) {
  const hands = playerHands(player);
  const hand = currentHand(player) || hands[0] || null;
  player.cards = hand ? hand.cards : [];
  player.activeBet = activeBetTotal(player);
  if (player.participating) {
    player.done = hands.length > 0 && hands.every((entry) => entry.done);
    player.busted = hands.length > 0 && hands.every((entry) => entry.busted);
    player.blackjack = hands.some((entry) => entry.blackjack);
  } else if (!hands.length) {
    player.done = false;
    player.busted = false;
    player.blackjack = false;
  }
  if (hand && player.participating) {
    const summary = hand.cards.length ? handSummary(hand.cards) : null;
    const handNumber = hands.length > 1 ? `Hand ${player.activeHandIndex + 1}: ` : '';
    player.status = hand.status || (summary ? `${handNumber}Live on ${summary.total}.` : player.status);
    player.result = hand.result || player.result || '';
  }
  return player;
}

function nextPlayableHandIndex(player, startIndex = -1) {
  const hands = playerHands(player);
  for (let index = startIndex + 1; index < hands.length; index += 1) {
    if (!hands[index].done) {
      return index;
    }
  }
  return -1;
}

function hasLiveHand(player) {
  return Boolean(player && player.participating && playerHands(player).some((hand) => !hand.done));
}

function canDoubleHand(player, hand = currentHand(player)) {
  return Boolean(
    player &&
    hand &&
    player.participating &&
    !hand.done &&
    hand.cards.length === 2 &&
    player.stack >= hand.bet
  );
}

function canSplitHand(player, hand = currentHand(player)) {
  if (!player || !hand || !player.participating || hand.done || hand.cards.length !== 2) {
    return false;
  }
  if (playerHands(player).length >= MAX_SPLIT_HANDS || player.stack < hand.bet) {
    return false;
  }
  const [first, second] = hand.cards;
  return Boolean(first && second && cardValue(first.rank) === cardValue(second.rank));
}

function discardCards(state, cards) {
  if (!Array.isArray(state.discard)) {
    state.discard = [];
  }
  for (const card of cards || []) {
    if (card) {
      state.discard.push(card);
    }
  }
}

function collectTableCards(state) {
  discardCards(state, state.dealer.cards);
  state.dealer.cards = [];
  for (const player of seatedPlayers(state, { includeLeavers: true })) {
    const hands = playerHands(player);
    if (hands.length) {
      for (const hand of hands) {
        discardCards(state, hand.cards);
        hand.cards = [];
      }
    } else {
      discardCards(state, player.cards);
    }
    player.cards = [];
    if (!player.participating) {
      player.hands = [];
      player.activeHandIndex = 0;
    }
  }
}

function tableCardCount(state) {
  let count = Array.isArray(state.dealer.cards) ? state.dealer.cards.length : 0;
  for (const player of seatedPlayers(state, { includeLeavers: true })) {
    const hands = playerHands(player);
    if (hands.length) {
      count += hands.reduce((sum, hand) => sum + (Array.isArray(hand.cards) ? hand.cards.length : 0), 0);
    } else if (Array.isArray(player.cards)) {
      count += player.cards.length;
    }
  }
  return count;
}

function handScoreLabel(hand) {
  if (!hand || !hand.cards.length) {
    return '-';
  }
  return String(handSummary(hand.cards).total);
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
    discardCount: (Array.isArray(state.discard) ? state.discard.length : 0) + tableCardCount(state),
    shoeDecks: SHOE_DECKS,
    shoeCardCount: SHOE_CARD_COUNT,
    cutCardRemaining: state.cutCardRemaining || CUT_CARD_REMAINING,
    shufflePending: Boolean(state.shufflePending),
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
      syncPlayerFromHands(player);
      const hands = playerHands(player);
      const activeHand = currentHand(player);
      const summary = activeHand && activeHand.cards.length ? handSummary(activeHand.cards) : null;
      return {
        id: player.id,
        name: player.name,
        seat: player.seat,
        stack: player.stack,
        walletCents: player.walletCents ?? player.stack,
        bet: player.bet,
        activeBet: activeBetTotal(player),
        activeHandIndex: player.activeHandIndex || 0,
        hands: hands.map((hand, index) => {
          const handInfo = hand.cards.length ? handSummary(hand.cards) : null;
          return {
            id: hand.id,
            index,
            bet: hand.bet,
            cards: hand.cards.map(cloneCard),
            done: hand.done,
            busted: hand.busted,
            blackjack: hand.blackjack,
            doubled: hand.doubled,
            fromSplit: hand.fromSplit,
            splitAces: hand.splitAces,
            result: hand.result,
            statusText: hand.status,
            score: handInfo ? handInfo.total : 0,
            scoreLabel: handInfo ? String(handInfo.total) : '-',
          };
        }),
        cards: (activeHand ? activeHand.cards : player.cards).map(cloneCard),
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
  SHOE_DECKS,
  SHOE_CARD_COUNT,
  CUT_CARD_REMAINING,
  createGameState,
  cloneState,
  addPlayer,
  removePlayer,
  setBet,
  startRound,
  applyAction,
  resetTable,
  drainWalletEvents,
  syncPlayerWallet,
};
