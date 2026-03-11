(() => {
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');

  const ui = {
    wave: document.getElementById('wave'),
    score: document.getElementById('score'),
    level: document.getElementById('level'),
    hpFill: document.getElementById('hpFill'),
    hpText: document.getElementById('hpText'),
    xpFill: document.getElementById('xpFill'),
    xpText: document.getElementById('xpText'),
    startOverlay: document.getElementById('startOverlay'),
    levelOverlay: document.getElementById('levelOverlay'),
    gameOverOverlay: document.getElementById('gameOverOverlay'),
    gameOverText: document.getElementById('gameOverText'),
    upgradeGrid: document.getElementById('upgradeGrid')
  };

  const state = {
    running: false,
    paused: false,
    gameOver: false,
    time: 0,
    waveTimer: 0,
    spawnTimer: 0,
    enemyIntensity: 1,
    bullets: [],
    enemies: [],
    particles: [],
    pickups: [],
    keys: new Set(),
    mouse: { x: canvas.width / 2, y: canvas.height / 2, down: false },
    score: 0,
    level: 1,
    xp: 0,
    xpToNext: 50,
    wave: 1,
    player: null
  };

  function newPlayer() {
    return {
      x: canvas.width / 2,
      y: canvas.height / 2,
      r: 16,
      speed: 250,
      hp: 120,
      maxHp: 120,
      dashCooldown: 0,
      dashIFrames: 0,
      fireRate: 7,
      fireCooldown: 0,
      bulletDamage: 16,
      bulletSpeed: 560,
      bulletSize: 4,
      multishot: 1,
      critChance: 0.08,
      critMult: 1.8,
      regen: 1.1,
      pierce: 0,
      novaPower: 0,
      shield: 0
    };
  }

  function resetGame() {
    state.running = true;
    state.paused = false;
    state.gameOver = false;
    state.time = 0;
    state.waveTimer = 0;
    state.spawnTimer = 0;
    state.enemyIntensity = 1;
    state.bullets = [];
    state.enemies = [];
    state.particles = [];
    state.pickups = [];
    state.score = 0;
    state.level = 1;
    state.xp = 0;
    state.xpToNext = 50;
    state.wave = 1;
    state.player = newPlayer();
    ui.startOverlay.classList.add('hide');
    ui.levelOverlay.classList.add('hide');
    ui.gameOverOverlay.classList.add('hide');
    updateHud();
  }

  function updateHud() {
    const p = state.player;
    ui.wave.textContent = `Wave ${state.wave}`;
    ui.score.textContent = `Score ${Math.floor(state.score)}`;
    ui.level.textContent = `Level ${state.level}`;
    ui.hpText.textContent = `${Math.max(0, Math.ceil(p.hp))} / ${Math.ceil(p.maxHp)}`;
    ui.xpText.textContent = `${Math.floor(state.xp)} / ${state.xpToNext}`;
    ui.hpFill.style.width = `${Math.max(0, (p.hp / p.maxHp) * 100)}%`;
    ui.xpFill.style.width = `${Math.min(100, (state.xp / state.xpToNext) * 100)}%`;
  }

  function spawnEnemy() {
    const edge = Math.floor(Math.random() * 4);
    let x = 0;
    let y = 0;
    if (edge === 0) { x = Math.random() * canvas.width; y = -30; }
    if (edge === 1) { x = canvas.width + 30; y = Math.random() * canvas.height; }
    if (edge === 2) { x = Math.random() * canvas.width; y = canvas.height + 30; }
    if (edge === 3) { x = -30; y = Math.random() * canvas.height; }

    const typeRoll = Math.random();
    let enemy;
    if (typeRoll < 0.15 + state.wave * 0.005) {
      enemy = { x, y, r: 22, speed: 70 + state.wave * 2, hp: 80 + state.wave * 10, dmg: 20, color: '#ff7a55', xp: 16, wobble: Math.random() * Math.PI * 2 };
    } else if (typeRoll < 0.4) {
      enemy = { x, y, r: 10, speed: 165 + state.wave * 4, hp: 22 + state.wave * 3, dmg: 8, color: '#d97bff', xp: 8, wobble: Math.random() * Math.PI * 2 };
    } else {
      enemy = { x, y, r: 14, speed: 105 + state.wave * 3, hp: 36 + state.wave * 5, dmg: 12, color: '#5be3ff', xp: 10, wobble: Math.random() * Math.PI * 2 };
    }
    state.enemies.push(enemy);
  }

  function shoot() {
    const p = state.player;
    const angleBase = Math.atan2(state.mouse.y - p.y, state.mouse.x - p.x);
    const spread = p.multishot > 1 ? 0.2 : 0;

    for (let i = 0; i < p.multishot; i += 1) {
      const t = p.multishot === 1 ? 0 : i / (p.multishot - 1) - 0.5;
      const angle = angleBase + t * spread;
      state.bullets.push({
        x: p.x,
        y: p.y,
        vx: Math.cos(angle) * p.bulletSpeed,
        vy: Math.sin(angle) * p.bulletSpeed,
        r: p.bulletSize,
        dmg: p.bulletDamage,
        pierce: p.pierce,
        color: '#88f3ff'
      });
    }
  }

  function burst(x, y, color, count = 12) {
    for (let i = 0; i < count; i += 1) {
      const a = (Math.PI * 2 * i) / count + Math.random() * 0.4;
      const spd = 45 + Math.random() * 170;
      state.particles.push({ x, y, vx: Math.cos(a) * spd, vy: Math.sin(a) * spd, life: 0.5 + Math.random() * 0.4, color, size: 1 + Math.random() * 3 });
    }
  }

  function gainXp(amount) {
    state.xp += amount;
    while (state.xp >= state.xpToNext) {
      state.xp -= state.xpToNext;
      state.level += 1;
      state.xpToNext = Math.floor(state.xpToNext * 1.24 + 12);
      levelUp();
    }
  }

  const upgrades = [
    {
      name: 'Rapid Fire',
      desc: '+20% fire rate',
      apply: (p) => { p.fireRate *= 1.2; }
    },
    {
      name: 'Overclocked Rounds',
      desc: '+25% bullet damage',
      apply: (p) => { p.bulletDamage *= 1.25; }
    },
    {
      name: 'Phase Boots',
      desc: '+15% movement speed',
      apply: (p) => { p.speed *= 1.15; }
    },
    {
      name: 'Pulse Capacitor',
      desc: '+1 multishot (max 5)',
      apply: (p) => { p.multishot = Math.min(5, p.multishot + 1); }
    },
    {
      name: 'Reflective Shield',
      desc: '+12 shield (absorbs first damage)',
      apply: (p) => { p.shield += 12; }
    },
    {
      name: 'Nanite Repair',
      desc: 'Heal 30 + increase max HP by 12',
      apply: (p) => { p.maxHp += 12; p.hp = Math.min(p.maxHp, p.hp + 30); }
    },
    {
      name: 'Unstable Core',
      desc: 'Dash releases a damaging nova',
      apply: (p) => { p.novaPower += 16; }
    },
    {
      name: 'Piercing Protocol',
      desc: 'Bullets pierce +1 target',
      apply: (p) => { p.pierce += 1; }
    }
  ];

  function levelUp() {
    state.paused = true;
    ui.levelOverlay.classList.remove('hide');
    ui.upgradeGrid.innerHTML = '';

    const pool = [...upgrades].sort(() => Math.random() - 0.5).slice(0, 3);
    for (const up of pool) {
      const btn = document.createElement('button');
      btn.className = 'btn';
      btn.innerHTML = `${up.name}<small>${up.desc}</small>`;
      btn.addEventListener('click', () => {
        up.apply(state.player);
        ui.levelOverlay.classList.add('hide');
        state.paused = false;
        updateHud();
      });
      ui.upgradeGrid.appendChild(btn);
    }
  }

  function endGame() {
    state.gameOver = true;
    state.running = false;
    ui.gameOverOverlay.classList.remove('hide');
    ui.gameOverText.textContent = `You reached wave ${state.wave}, level ${state.level}, and scored ${Math.floor(state.score)} points.`;
  }

  function update(dt) {
    if (!state.running || state.paused || state.gameOver) return;

    const p = state.player;
    state.time += dt;
    state.waveTimer += dt;
    state.spawnTimer += dt;

    if (state.waveTimer > 25) {
      state.waveTimer = 0;
      state.wave += 1;
      state.enemyIntensity += 0.2;
      burst(p.x, p.y, '#64f5ff', 28);
    }

    const spawnGap = Math.max(0.12, 0.95 - state.wave * 0.05 - state.enemyIntensity * 0.08);
    if (state.spawnTimer >= spawnGap) {
      state.spawnTimer = 0;
      const amount = 1 + Math.floor(state.wave / 4);
      for (let i = 0; i < amount; i += 1) spawnEnemy();
    }

    let moveX = 0;
    let moveY = 0;
    if (state.keys.has('w') || state.keys.has('arrowup')) moveY -= 1;
    if (state.keys.has('s') || state.keys.has('arrowdown')) moveY += 1;
    if (state.keys.has('a') || state.keys.has('arrowleft')) moveX -= 1;
    if (state.keys.has('d') || state.keys.has('arrowright')) moveX += 1;

    if (moveX || moveY) {
      const mag = Math.hypot(moveX, moveY);
      const spd = p.speed * (p.dashIFrames > 0 ? 2.1 : 1);
      p.x += (moveX / mag) * spd * dt;
      p.y += (moveY / mag) * spd * dt;
    }

    p.x = Math.max(p.r, Math.min(canvas.width - p.r, p.x));
    p.y = Math.max(p.r, Math.min(canvas.height - p.r, p.y));

    p.dashCooldown = Math.max(0, p.dashCooldown - dt);
    p.dashIFrames = Math.max(0, p.dashIFrames - dt);

    p.fireCooldown -= dt;
    if (p.fireCooldown <= 0) {
      p.fireCooldown = 1 / p.fireRate;
      shoot();
    }

    p.hp = Math.min(p.maxHp, p.hp + p.regen * dt);

    for (let i = state.bullets.length - 1; i >= 0; i -= 1) {
      const b = state.bullets[i];
      b.x += b.vx * dt;
      b.y += b.vy * dt;

      if (b.x < -30 || b.x > canvas.width + 30 || b.y < -30 || b.y > canvas.height + 30) {
        state.bullets.splice(i, 1);
        continue;
      }

      for (let j = state.enemies.length - 1; j >= 0; j -= 1) {
        const e = state.enemies[j];
        const d = Math.hypot(b.x - e.x, b.y - e.y);
        if (d < b.r + e.r) {
          const crit = Math.random() < p.critChance;
          const dmg = b.dmg * (crit ? p.critMult : 1);
          e.hp -= dmg;
          burst(b.x, b.y, crit ? '#ffef6f' : '#8df5ff', crit ? 8 : 4);

          if (e.hp <= 0) {
            state.score += e.xp * 8;
            gainXp(e.xp);
            if (Math.random() < 0.12) {
              state.pickups.push({ x: e.x, y: e.y, r: 7, t: 8, type: 'heal' });
            }
            burst(e.x, e.y, e.color, 18);
            state.enemies.splice(j, 1);
          }

          if (b.pierce > 0) {
            b.pierce -= 1;
          } else {
            state.bullets.splice(i, 1);
          }
          break;
        }
      }
    }

    for (let i = state.enemies.length - 1; i >= 0; i -= 1) {
      const e = state.enemies[i];
      const a = Math.atan2(p.y - e.y, p.x - e.x) + Math.sin(state.time * 4 + e.wobble) * 0.05;
      e.x += Math.cos(a) * e.speed * dt;
      e.y += Math.sin(a) * e.speed * dt;

      const d = Math.hypot(e.x - p.x, e.y - p.y);
      if (d < e.r + p.r) {
        if (p.dashIFrames <= 0) {
          let damage = e.dmg;
          if (p.shield > 0) {
            const absorbed = Math.min(p.shield, damage);
            p.shield -= absorbed;
            damage -= absorbed;
          }
          p.hp -= damage;
          p.dashIFrames = 0.35;
          burst(p.x, p.y, '#ff96ab', 18);
          if (p.hp <= 0) {
            endGame();
            break;
          }
        }
        const push = 24;
        const pa = Math.atan2(e.y - p.y, e.x - p.x);
        e.x += Math.cos(pa) * push;
        e.y += Math.sin(pa) * push;
      }
    }

    for (let i = state.pickups.length - 1; i >= 0; i -= 1) {
      const item = state.pickups[i];
      item.t -= dt;
      if (item.t <= 0) {
        state.pickups.splice(i, 1);
        continue;
      }
      const d = Math.hypot(item.x - p.x, item.y - p.y);
      if (d < item.r + p.r) {
        p.hp = Math.min(p.maxHp, p.hp + 24);
        burst(item.x, item.y, '#79ff9b', 12);
        state.pickups.splice(i, 1);
      }
    }

    for (let i = state.particles.length - 1; i >= 0; i -= 1) {
      const s = state.particles[i];
      s.life -= dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.vx *= 0.96;
      s.vy *= 0.96;
      if (s.life <= 0) state.particles.splice(i, 1);
    }

    updateHud();
  }

  function drawGrid() {
    const size = 48;
    ctx.save();
    ctx.globalAlpha = 0.16;
    ctx.strokeStyle = '#58d8ff';
    ctx.lineWidth = 1;
    for (let x = 0; x < canvas.width; x += size) {
      ctx.beginPath();
      ctx.moveTo(x + ((state.time * 30) % size), 0);
      ctx.lineTo(x + ((state.time * 30) % size), canvas.height);
      ctx.stroke();
    }
    for (let y = 0; y < canvas.height; y += size) {
      ctx.beginPath();
      ctx.moveTo(0, y + ((state.time * 15) % size));
      ctx.lineTo(canvas.width, y + ((state.time * 15) % size));
      ctx.stroke();
    }
    ctx.restore();
  }

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const glow = 0.4 + Math.sin(state.time * 0.9) * 0.08;

    const bg = ctx.createRadialGradient(canvas.width / 2, canvas.height / 2, 80, canvas.width / 2, canvas.height / 2, 620);
    bg.addColorStop(0, `rgba(16, 30, 55, ${0.38 + glow * 0.2})`);
    bg.addColorStop(1, 'rgba(4, 8, 18, 1)');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    drawGrid();

    for (const b of state.bullets) {
      ctx.fillStyle = b.color;
      ctx.shadowColor = b.color;
      ctx.shadowBlur = 14;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    for (const e of state.enemies) {
      ctx.fillStyle = e.color;
      ctx.shadowColor = e.color;
      ctx.shadowBlur = 20;
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;

      ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.r + 4, 0, Math.PI * 2);
      ctx.stroke();
    }

    for (const item of state.pickups) {
      ctx.fillStyle = '#71ff97';
      ctx.shadowColor = '#71ff97';
      ctx.shadowBlur = 14;
      ctx.beginPath();
      ctx.arc(item.x, item.y, item.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    const p = state.player;
    if (p) {
      const ang = Math.atan2(state.mouse.y - p.y, state.mouse.x - p.x);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(ang);

      ctx.fillStyle = p.dashIFrames > 0 ? '#ffd880' : '#9af3ff';
      ctx.shadowColor = '#72e4ff';
      ctx.shadowBlur = 22;
      ctx.beginPath();
      ctx.moveTo(20, 0);
      ctx.lineTo(-14, -12);
      ctx.lineTo(-7, 0);
      ctx.lineTo(-14, 12);
      ctx.closePath();
      ctx.fill();
      ctx.shadowBlur = 0;

      ctx.restore();

      if (p.shield > 0) {
        ctx.strokeStyle = `rgba(105,255,142,${0.18 + Math.min(0.4, p.shield / 40)})`;
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r + 8, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    for (const s of state.particles) {
      ctx.globalAlpha = Math.max(0, s.life);
      ctx.fillStyle = s.color;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    if (state.paused && state.running && !state.gameOver) {
      ctx.fillStyle = 'rgba(8, 12, 22, 0.45)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
  }

  let last = performance.now();
  function loop(now) {
    const dt = Math.min(0.033, (now - last) / 1000);
    last = now;
    update(dt);
    draw();
    requestAnimationFrame(loop);
  }

  window.addEventListener('keydown', (e) => {
    const key = e.key.toLowerCase();
    state.keys.add(key);

    if (key === 'p' && state.running && !state.gameOver) {
      state.paused = !state.paused;
      ui.levelOverlay.classList.toggle('hide', !state.paused);
      if (state.paused) {
        ui.upgradeGrid.innerHTML = '<div class="chip">Paused</div>';
      }
    }

    if (key === 'shift' && state.running && !state.paused) {
      const p = state.player;
      if (p.dashCooldown <= 0) {
        p.dashCooldown = 2.2;
        p.dashIFrames = 0.28;
        if (p.novaPower > 0) {
          for (const e of state.enemies) {
            const d = Math.hypot(e.x - p.x, e.y - p.y);
            if (d < 120) {
              e.hp -= p.novaPower;
            }
          }
          burst(p.x, p.y, '#ff65d9', 26);
        }
      }
    }
  });

  window.addEventListener('keyup', (e) => {
    state.keys.delete(e.key.toLowerCase());
  });

  canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const sx = canvas.width / rect.width;
    const sy = canvas.height / rect.height;
    state.mouse.x = (e.clientX - rect.left) * sx;
    state.mouse.y = (e.clientY - rect.top) * sy;
  });

  document.getElementById('startBtn').addEventListener('click', resetGame);
  document.getElementById('restartBtn').addEventListener('click', resetGame);

  state.player = newPlayer();
  updateHud();
  requestAnimationFrame(loop);
})();
