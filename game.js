(() => {
  'use strict';

  // U+FE0E keeps ♥/♦ as text glyphs instead of emoji on some platforms
  const SUITS = [
    { name: 'spades', sym: '♠︎', red: false },
    { name: 'hearts', sym: '♥︎', red: true },
    { name: 'diamonds', sym: '♦︎', red: true },
    { name: 'clubs', sym: '♣︎', red: false },
  ];
  const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const COURT = ['J', 'Q', 'K'];

  const DEAL_GAP = 330;   // pause between dealt cards
  const SETTLE = 450;     // let the last card land before deciding
  const FLIP = 620;       // hole card flip duration

  const $ = (id) => document.getElementById(id);
  const el = {
    table: $('table'),
    shoe: $('shoe'),
    dealerHand: $('dealer-hand'),
    playerHand: $('player-hand'),
    dealerScore: $('dealer-score'),
    playerScore: $('player-score'),
    result: $('result'),
    resultTitle: $('result-title'),
    resultDetail: $('result-detail'),
    hit: $('btn-hit'),
    stand: $('btn-stand'),
    newGame: $('btn-new'),
    stats: {
      wins: $('stat-wins'),
      losses: $('stat-losses'),
      draws: $('stat-draws'),
      played: $('stat-played'),
    },
  };

  const stats = { wins: 0, losses: 0, draws: 0, played: 0 };
  let deck = [];
  let player = [];
  let dealer = [];
  let phase = 'idle'; // idle | dealing | player | dealer | over

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // ---------- Deck & scoring ----------

  function buildDeck() {
    const cards = [];
    for (const suit of SUITS) {
      for (const rank of RANKS) cards.push({ rank, suit, hidden: false, node: null });
    }
    return cards;
  }

  function shuffle(cards) {
    for (let i = cards.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [cards[i], cards[j]] = [cards[j], cards[i]];
    }
    return cards;
  }

  function cardValue(rank) {
    if (rank === 'A') return 11;
    if (COURT.includes(rank)) return 10;
    return Number(rank);
  }

  function handValue(cards) {
    let total = 0;
    let aces = 0;
    for (const card of cards) {
      total += cardValue(card.rank);
      if (card.rank === 'A') aces++;
    }
    while (total > 21 && aces > 0) {
      total -= 10;
      aces--;
    }
    return total;
  }

  const isBlackjack = (cards) => cards.length === 2 && handValue(cards) === 21;

  // ---------- Rendering ----------

  function createCardNode(card) {
    const { rank, suit } = card;
    const node = document.createElement('div');
    node.className = 'card';
    if (suit.red) node.classList.add('is-red');
    if (COURT.includes(rank)) node.classList.add('is-court');
    if (rank === 'A') node.classList.add('is-ace');
    if (card.hidden) node.classList.add('is-hidden');

    // slight random tilt, 1–3° either way
    const tilt = (1 + Math.random() * 2) * (Math.random() < 0.5 ? -1 : 1);
    node.style.setProperty('--rot', `${tilt.toFixed(2)}deg`);

    const corner = (pos) =>
      `<div class="corner corner--${pos}"><span class="r">${rank}</span><span class="s">${suit.sym}</span></div>`;
    const center = COURT.includes(rank)
      ? `<div class="court"><span class="court-rank">${rank}</span><span class="court-suit">${suit.sym}</span></div>`
      : `<div class="pip">${suit.sym}</div>`;

    node.innerHTML =
      `<div class="card-inner">` +
        `<div class="face front">${corner('tl')}${center}${corner('br')}</div>` +
        `<div class="face back"></div>` +
      `</div>`;
    setCardLabel(node, card);
    return node;
  }

  function setCardLabel(node, card) {
    node.setAttribute('role', 'img');
    node.setAttribute('aria-label', card.hidden ? 'Face-down card' : `${card.rank} of ${card.suit.name}`);
  }

  function dealTo(hand, handEl, hidden = false) {
    const card = deck.pop();
    card.hidden = hidden;
    hand.push(card);

    // remember where existing cards are so they can glide when the hand re-centres
    const existing = [...handEl.children];
    const before = existing.map((n) => n.getBoundingClientRect().left);

    const node = createCardNode(card);
    card.node = node;
    node.classList.add('is-measuring');
    handEl.appendChild(node);
    handEl.classList.toggle('is-crowded', hand.length > 5);

    // fly in from the shoe
    const from = el.shoe.getBoundingClientRect();
    const to = node.getBoundingClientRect();
    node.style.setProperty('--fx', `${from.left + from.width / 2 - (to.left + to.width / 2)}px`);
    node.style.setProperty('--fy', `${from.top + from.height / 2 - (to.top + to.height / 2)}px`);
    node.classList.remove('is-measuring');

    existing.forEach((n, i) => {
      const dx = before[i] - n.getBoundingClientRect().left;
      if (Math.abs(dx) > 0.5 && n.animate) {
        n.animate([{ translate: `${dx}px 0` }, { translate: '0 0' }], {
          duration: 380,
          easing: 'cubic-bezier(0.2, 0.75, 0.25, 1)',
        });
      }
    });

    updateScores();
    return card;
  }

  function updateScores() {
    el.playerScore.innerHTML = player.length ? `Hand: <b>${handValue(player)}</b>` : '';
    const visible = dealer.filter((c) => !c.hidden);
    el.dealerScore.innerHTML = visible.length ? `Hand: <b>${handValue(visible)}</b>` : '';
  }

  function renderStats(changed) {
    for (const key of Object.keys(stats)) {
      const node = el.stats[key];
      node.textContent = stats[key];
      if (changed.includes(key)) {
        node.classList.remove('bump');
        void node.offsetWidth;
        node.classList.add('bump');
      }
    }
  }

  function setControls(mode) {
    const over = mode === 'over';
    el.hit.hidden = over;
    el.stand.hidden = over;
    el.newGame.hidden = !over;
    el.hit.disabled = mode !== 'play';
    el.stand.disabled = mode !== 'play';
  }

  function showResult(kind, title, detail) {
    el.result.className = `result result--${kind}`;
    el.resultTitle.textContent = title;
    el.resultDetail.textContent = detail;
    el.table.classList.toggle('is-blackjack', kind === 'blackjack');
    void el.result.offsetWidth;
    el.result.classList.add('show');
  }

  function hideResult() {
    el.result.classList.remove('show');
    el.table.classList.remove('is-blackjack');
  }

  // ---------- Game flow ----------

  async function clearTable() {
    const cards = [...el.dealerHand.children, ...el.playerHand.children];
    if (cards.length) {
      cards.forEach((n) => n.classList.add('is-leaving'));
      await wait(300);
    }
    el.dealerHand.replaceChildren();
    el.playerHand.replaceChildren();
    el.dealerHand.classList.remove('is-crowded');
    el.playerHand.classList.remove('is-crowded');
    player = [];
    dealer = [];
    updateScores();
  }

  async function newGame() {
    if (phase === 'dealing' || phase === 'dealer') return;
    phase = 'dealing';
    setControls('wait');
    hideResult();
    await clearTable();

    deck = shuffle(buildDeck());

    dealTo(player, el.playerHand);
    await wait(DEAL_GAP);
    dealTo(dealer, el.dealerHand);
    await wait(DEAL_GAP);
    dealTo(player, el.playerHand);
    await wait(DEAL_GAP);
    dealTo(dealer, el.dealerHand, true);
    await wait(SETTLE + 150);

    if (isBlackjack(player) || isBlackjack(dealer)) {
      phase = 'dealer';
      await revealHoleCard();
      finishRound();
      return;
    }

    phase = 'player';
    setControls('play');
  }

  async function hit() {
    if (phase !== 'player') return;
    phase = 'dealing';
    setControls('wait');
    dealTo(player, el.playerHand);
    await wait(SETTLE);

    const total = handValue(player);
    if (total > 21) {
      phase = 'dealer';
      await revealHoleCard();
      finishRound();
    } else if (total === 21) {
      dealerTurn();
    } else {
      phase = 'player';
      setControls('play');
    }
  }

  function stand() {
    if (phase !== 'player') return;
    dealerTurn();
  }

  async function dealerTurn() {
    phase = 'dealer';
    setControls('wait');
    await revealHoleCard();
    while (handValue(dealer) < 17) {
      await wait(DEAL_GAP + 200);
      dealTo(dealer, el.dealerHand);
    }
    await wait(SETTLE + 100);
    finishRound();
  }

  async function revealHoleCard() {
    const hole = dealer.find((c) => c.hidden);
    if (!hole) return;
    hole.hidden = false;
    hole.node.classList.remove('is-hidden');
    setCardLabel(hole.node, hole);
    await wait(FLIP / 2);
    updateScores();
    await wait(FLIP / 2);
  }

  function finishRound() {
    const p = handValue(player);
    const d = handValue(dealer);
    const playerBJ = isBlackjack(player);
    const dealerBJ = isBlackjack(dealer);

    let outcome;
    if (p > 21) outcome = 'bust';
    else if (playerBJ && dealerBJ) outcome = 'push';
    else if (playerBJ) outcome = 'blackjack';
    else if (dealerBJ) outcome = 'lose';
    else if (d > 21 || p > d) outcome = 'win';
    else if (p < d) outcome = 'lose';
    else outcome = 'push';

    const score = `${p} vs ${d}`;
    const outcomes = {
      blackjack: { kind: 'blackjack', title: 'BLACKJACK', detail: 'Natural 21', stat: 'wins' },
      win: { kind: 'win', title: 'YOU WIN', detail: d > 21 ? `Dealer busts · ${score}` : score, stat: 'wins' },
      lose: { kind: 'lose', title: 'DEALER WINS', detail: dealerBJ ? 'Dealer blackjack' : score, stat: 'losses' },
      bust: { kind: 'lose', title: 'BUST', detail: `${p} · over 21`, stat: 'losses' },
      push: { kind: 'push', title: 'PUSH', detail: score, stat: 'draws' },
    };
    const res = outcomes[outcome];

    stats[res.stat]++;
    stats.played++;
    renderStats([res.stat, 'played']);

    showResult(res.kind, res.title, res.detail);
    phase = 'over';
    setControls('over');
    el.newGame.focus({ preventScroll: true });
  }

  // ---------- Input ----------

  el.hit.addEventListener('click', hit);
  el.stand.addEventListener('click', stand);
  el.newGame.addEventListener('click', newGame);

  document.addEventListener('keydown', (e) => {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    const key = e.key.toLowerCase();
    if (key === 'h') hit();
    else if (key === 's') stand();
    else if (key === 'n' && phase === 'over') newGame();
  });

  renderStats([]);
  window.addEventListener('load', () => setTimeout(newGame, 350));
})();
