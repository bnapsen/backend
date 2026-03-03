const suits = ["♠", "♥", "♣", "♦"];
const ranks = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

const state = {
  bankroll: 1000,
  bet: 25,
  streak: 0,
  round: 1,
  deck: [],
  player: [],
  dealer: [],
  handActive: false,
  dealerHidden: true,
};

const els = {
  bankroll: document.getElementById("bankroll"),
  currentBet: document.getElementById("currentBet"),
  streak: document.getElementById("streak"),
  round: document.getElementById("round"),
  dealerScore: document.getElementById("dealerScore"),
  playerScore: document.getElementById("playerScore"),
  dealerCards: document.getElementById("dealerCards"),
  playerCards: document.getElementById("playerCards"),
  message: document.getElementById("message"),
  dealBtn: document.getElementById("dealBtn"),
  hitBtn: document.getElementById("hitBtn"),
  standBtn: document.getElementById("standBtn"),
  doubleBtn: document.getElementById("doubleBtn"),
  clearBet: document.getElementById("clearBet"),
  newHandBtn: document.getElementById("newHandBtn"),
};

function freshDeck() {
  const deck = [];
  for (const suit of suits) {
    for (const rank of ranks) {
      deck.push({ suit, rank });
    }
  }
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function cardValue(rank) {
  if (["J", "Q", "K"].includes(rank)) return 10;
  if (rank === "A") return 11;
  return Number(rank);
}

function handScore(hand) {
  let score = hand.reduce((acc, card) => acc + cardValue(card.rank), 0);
  let aces = hand.filter((card) => card.rank === "A").length;
  while (score > 21 && aces > 0) {
    score -= 10;
    aces -= 1;
  }
  return score;
}

function drawCard(target) {
  if (state.deck.length === 0) state.deck = freshDeck();
  target.push(state.deck.pop());
}

function renderCard(card, hidden = false) {
  const div = document.createElement("div");
  if (hidden) {
    div.className = "card back";
    return div;
  }

  const isRed = card.suit === "♥" || card.suit === "♦";
  const isFace = ["J", "Q", "K", "A"].includes(card.rank);
  div.className = `card ${isRed ? "red" : ""} ${isFace ? "face" : ""}`.trim();

  const centerContent = isFace ? `${card.rank}${card.suit}` : card.suit;
  div.innerHTML = `
    <div class="card-corner top"><span>${card.rank}</span><span class="suit-mini">${card.suit}</span></div>
    <div class="card-center">${centerContent}</div>
    <div class="card-corner bottom"><span>${card.rank}</span><span class="suit-mini">${card.suit}</span></div>
  `;

  return div;
}

function render() {
  els.bankroll.textContent = `$${state.bankroll}`;
  els.currentBet.textContent = `$${state.bet}`;
  els.streak.textContent = String(state.streak);
  els.round.textContent = String(state.round);

  const playerScore = handScore(state.player);
  els.playerScore.textContent = `Score: ${playerScore}`;

  const dealerScore = handScore(state.dealer);
  const visibleDealer = state.dealerHidden ? cardValue(state.dealer[0]?.rank || "0") : dealerScore;
  els.dealerScore.textContent = `Score: ${state.dealerHidden ? `${visibleDealer}+?` : visibleDealer}`;

  els.playerCards.innerHTML = "";
  state.player.forEach((card) => els.playerCards.appendChild(renderCard(card)));

  els.dealerCards.innerHTML = "";
  state.dealer.forEach((card, index) => {
    const hidden = state.dealerHidden && index === 1;
    els.dealerCards.appendChild(renderCard(card, hidden));
  });

  const canPlay = state.handActive;
  els.hitBtn.disabled = !canPlay;
  els.standBtn.disabled = !canPlay;
  els.doubleBtn.disabled = !canPlay || state.player.length !== 2 || state.bankroll < state.bet;
  els.dealBtn.disabled = canPlay || state.bet <= 0 || state.bet > state.bankroll;
}

function setMessage(text) {
  els.message.textContent = text;
}

function settle(result) {
  state.handActive = false;
  state.dealerHidden = false;
  const payout = {
    win: state.bet * 2,
    blackjack: Math.floor(state.bet * 2.5),
    push: state.bet,
    lose: 0,
  }[result];
  state.bankroll += payout;

  if (result === "win" || result === "blackjack") {
    state.streak += 1;
  } else if (result === "lose") {
    state.streak = 0;
  }

  if (result === "blackjack") setMessage("BLACKJACK! You get a premium payout. ✨");
  if (result === "win") setMessage("You win this hand. Nice read on the table.");
  if (result === "push") setMessage("Push. Bet returned.");
  if (result === "lose") setMessage("Dealer takes it. Try a new strategy.");

  render();
}

function dealerTurn() {
  state.dealerHidden = false;
  while (handScore(state.dealer) < 17) {
    drawCard(state.dealer);
  }

  const player = handScore(state.player);
  const dealer = handScore(state.dealer);

  if (dealer > 21 || player > dealer) settle("win");
  else if (dealer === player) settle("push");
  else settle("lose");
}

function deal() {
  if (state.bet > state.bankroll || state.bet <= 0) {
    setMessage("Your bet is invalid. Adjust chips first.");
    return;
  }

  state.player = [];
  state.dealer = [];
  state.bankroll -= state.bet;
  state.handActive = true;
  state.dealerHidden = true;

  drawCard(state.player);
  drawCard(state.dealer);
  drawCard(state.player);
  drawCard(state.dealer);

  const player = handScore(state.player);
  const dealer = handScore(state.dealer);

  if (player === 21 && dealer !== 21) {
    settle("blackjack");
  } else if (player === 21 && dealer === 21) {
    settle("push");
  } else {
    setMessage("Hand dealt. Make your move.");
    render();
  }
}

function hit() {
  drawCard(state.player);
  const player = handScore(state.player);
  if (player > 21) {
    setMessage("Bust! You went over 21.");
    settle("lose");
    return;
  }
  render();
}

function stand() {
  setMessage("Dealer reveals and plays...");
  dealerTurn();
}

function doubleDown() {
  if (state.bankroll < state.bet) return;
  state.bankroll -= state.bet;
  state.bet *= 2;
  drawCard(state.player);
  const player = handScore(state.player);
  if (player > 21) {
    setMessage("Double down bust. Risky play!");
    settle("lose");
    return;
  }
  dealerTurn();
}

function resetForNewHand() {
  state.player = [];
  state.dealer = [];
  state.handActive = false;
  state.dealerHidden = true;
  state.round += 1;

  if (state.bankroll <= 0) {
    state.bankroll = 1000;
    state.bet = 25;
    state.streak = 0;
    setMessage("You ran out of chips. House gives you a fresh $1000 bankroll.");
  } else {
    setMessage("Place your bet and deal a lucky hand.");
  }
  render();
}

function changeBet(amount) {
  if (state.handActive) return;
  state.bet = Math.max(0, state.bet + amount);
  if (state.bet > state.bankroll) state.bet = state.bankroll;
  render();
}

function bindEvents() {
  document.querySelectorAll(".chip[data-bet]").forEach((chip) => {
    chip.addEventListener("click", () => changeBet(Number(chip.dataset.bet)));
  });

  els.clearBet.addEventListener("click", () => {
    if (state.handActive) return;
    state.bet = 0;
    render();
  });

  els.dealBtn.addEventListener("click", deal);
  els.hitBtn.addEventListener("click", hit);
  els.standBtn.addEventListener("click", stand);
  els.doubleBtn.addEventListener("click", doubleDown);
  els.newHandBtn.addEventListener("click", resetForNewHand);
}

state.deck = freshDeck();
bindEvents();
render();
