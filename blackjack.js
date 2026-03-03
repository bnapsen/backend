const suits = ["♠", "♥", "♣", "♦"];
const ranks = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const DECKS_IN_SHOE = 6;

const state = {
  bankroll: 1000,
  bet: 25,
  activeBet: 0,
  streak: 0,
  round: 1,
  shoe: [],
  player: [],
  dealer: [],
  handActive: false,
  dealerHidden: true,
};

const els = {
  bankroll: document.getElementById("bankroll"),
  currentBet: document.getElementById("currentBet"),
  wagerDisplay: document.getElementById("wagerDisplay"),
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

function formatMoney(amount) {
  return `$${amount}`;
}

function buildShoe() {
  const shoe = [];
  for (let deck = 0; deck < DECKS_IN_SHOE; deck += 1) {
    for (const suit of suits) {
      for (const rank of ranks) {
        shoe.push({ suit, rank });
      }
    }
  }

  for (let i = shoe.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [shoe[i], shoe[j]] = [shoe[j], shoe[i]];
  }

  return shoe;
}

function cardValue(rank) {
  if (["J", "Q", "K"].includes(rank)) return 10;
  if (rank === "A") return 11;
  return Number(rank);
}

function handSummary(hand) {
  let score = hand.reduce((total, card) => total + cardValue(card.rank), 0);
  let aces = hand.filter((card) => card.rank === "A").length;

  while (score > 21 && aces > 0) {
    score -= 10;
    aces -= 1;
  }

  return {
    total: score,
    soft: aces > 0,
  };
}

function drawCard(target) {
  if (state.shoe.length < 52) {
    state.shoe = buildShoe();
    setMessage("The dealer reshuffles the shoe.");
  }
  target.push(state.shoe.pop());
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

function dealerVisibleScore() {
  if (!state.dealer.length) return "?";
  if (!state.dealerHidden) return String(handSummary(state.dealer).total);
  return `${cardValue(state.dealer[0].rank)} + ?`;
}

function render() {
  els.bankroll.textContent = formatMoney(state.bankroll);
  els.currentBet.textContent = formatMoney(state.bet);
  els.wagerDisplay.textContent = formatMoney(state.activeBet);
  els.streak.textContent = String(state.streak);
  els.round.textContent = String(state.round);

  const playerScore = handSummary(state.player).total;
  els.playerScore.textContent = `Score: ${state.player.length ? playerScore : 0}`;
  els.dealerScore.textContent = `Score: ${dealerVisibleScore()}`;

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
  els.doubleBtn.disabled = !canPlay || state.player.length !== 2 || state.bankroll < state.activeBet;
  els.dealBtn.disabled = canPlay || state.bet <= 0 || state.bet > state.bankroll;
  els.clearBet.disabled = canPlay;
}

function setMessage(text) {
  els.message.textContent = text;
}

function settle(result) {
  state.handActive = false;
  state.dealerHidden = false;

  const payouts = {
    win: state.activeBet * 2,
    blackjack: Math.floor(state.activeBet * 2.5),
    push: state.activeBet,
    lose: 0,
  };

  state.bankroll += payouts[result];
  if (result === "win" || result === "blackjack") state.streak += 1;
  if (result === "lose") state.streak = 0;

  if (result === "blackjack") setMessage("Blackjack! Paid 3:2.");
  if (result === "win") setMessage("You win this hand.");
  if (result === "push") setMessage("Push. Your wager is returned.");
  if (result === "lose") setMessage("Dealer wins this hand.");

  state.activeBet = 0;
  render();
}

function dealerTurn() {
  state.dealerHidden = false;

  while (true) {
    const dealerHand = handSummary(state.dealer);
    if (dealerHand.total < 17) {
      drawCard(state.dealer);
      continue;
    }
    break;
  }

  const player = handSummary(state.player).total;
  const dealer = handSummary(state.dealer).total;

  if (dealer > 21 || player > dealer) settle("win");
  else if (dealer === player) settle("push");
  else settle("lose");
}

function deal() {
  if (state.handActive) return;

  if (state.bet <= 0 || state.bet > state.bankroll) {
    setMessage("Set a valid table bet before dealing.");
    return;
  }

  state.player = [];
  state.dealer = [];
  state.activeBet = state.bet;
  state.bankroll -= state.activeBet;
  state.handActive = true;
  state.dealerHidden = true;

  drawCard(state.player);
  drawCard(state.dealer);
  drawCard(state.player);
  drawCard(state.dealer);

  const player = handSummary(state.player).total;
  const dealer = handSummary(state.dealer).total;

  if (player === 21 && dealer !== 21) {
    settle("blackjack");
  } else if (player === 21 && dealer === 21) {
    settle("push");
  } else {
    setMessage("Your move: Hit, Stand, or Double.");
    render();
  }
}

function hit() {
  if (!state.handActive) return;

  drawCard(state.player);
  if (handSummary(state.player).total > 21) {
    setMessage("Bust. You went over 21.");
    settle("lose");
    return;
  }
  render();
}

function stand() {
  if (!state.handActive) return;
  setMessage("Dealer reveals and plays...");
  dealerTurn();
}

function doubleDown() {
  if (!state.handActive || state.player.length !== 2) return;
  if (state.bankroll < state.activeBet) return;

  state.bankroll -= state.activeBet;
  state.activeBet *= 2;
  drawCard(state.player);

  if (handSummary(state.player).total > 21) {
    setMessage("Double down bust.");
    settle("lose");
    return;
  }

  dealerTurn();
}

function resetTable() {
  state.player = [];
  state.dealer = [];
  state.activeBet = 0;
  state.handActive = false;
  state.dealerHidden = true;
  state.round += 1;

  if (state.bankroll <= 0) {
    state.bankroll = 1000;
    state.bet = 25;
    state.streak = 0;
    setMessage("Bankroll reset to $1000.");
  } else {
    setMessage("Set your table bet and press Deal.");
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
  els.newHandBtn.addEventListener("click", resetTable);
}

state.shoe = buildShoe();
bindEvents();
render();
