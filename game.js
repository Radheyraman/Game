(() => {
  'use strict';

  // ---------- Setup ----------
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const $ = (id) => document.getElementById(id);
  const ui = {
    hud: $('hud'), score: $('score'), fuel: $('fuel-bar'),
    menu: $('menu'), paused: $('paused'), over: $('over'),
    best: $('best'), bestOver: $('best-over'), finalScore: $('final-score'),
    install: $('install-btn'), mute: $('mute-btn'),
  };

  let W = 0, H = 0, DPR = 1, U = 1; // U = base size unit in CSS px
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    U = Math.max(0.6, Math.min(W, H * 0.7) / 500);
    if (player) { player.y = H - 90 * U; player.x = clamp(player.x, player.r, W - player.r); }
    makeStars();
  }

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rand = (a, b) => a + Math.random() * (b - a);

  // ---------- Storage (best-effort) ----------
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
  };
  let best = parseInt(store.get('diya.best', '0'), 10) || 0;
  let muted = store.get('diya.muted', '0') === '1';

  // ---------- Audio ----------
  let actx = null;
  function beep(freq, dur, type = 'sine', vol = 0.15, slide = 0) {
    if (muted) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === 'suspended') actx.resume();
      const t = actx.currentTime, o = actx.createOscillator(), g = actx.createGain();
      o.type = type; o.frequency.setValueAtTime(freq, t);
      if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(actx.destination); o.start(t); o.stop(t + dur);
    } catch { /* audio unavailable */ }
  }
  const sfx = {
    oil: () => beep(660, 0.12, 'triangle', 0.14, 440),
    hit: () => beep(220, 0.3, 'sawtooth', 0.12, -160),
    over: () => beep(330, 0.7, 'sine', 0.16, -260),
    start: () => beep(440, 0.15, 'triangle', 0.12, 220),
  };

  // ---------- Game state ----------
  const State = { MENU: 0, PLAY: 1, PAUSE: 2, OVER: 3 };
  let state = State.MENU;
  let player = null, drops = [], particles = [], stars = [], floaters = [];
  let score = 0, time = 0, fuel = 100, spawnRain = 0, spawnOil = 0, shake = 0, hurt = 0, wind = 0, windT = 0;
  const keys = { left: false, right: false };
  let pointerX = null;

  function makeStars() {
    stars = Array.from({ length: Math.round((W * H) / 9000) }, () => ({
      x: Math.random() * W, y: Math.random() * H, r: Math.random() * 1.4 + 0.3, tw: Math.random() * 6.28,
    }));
  }

  function reset() {
    player = { x: W / 2, y: H - 90 * U, r: 16 * U, vx: 0 };
    drops = []; particles = []; floaters = [];
    score = 0; time = 0; fuel = 100; spawnRain = 0.6; spawnOil = 2; shake = 0; hurt = 0; wind = 0; windT = 4;
  }

  // Difficulty ramps with time; d goes ~0 → 1 over 2 minutes, then keeps creeping.
  const difficulty = () => Math.min(1.6, time / 120);

  function spawn(kind) {
    const d = difficulty();
    const isOil = kind === 'oil';
    const big = !isOil && Math.random() < 0.12 + d * 0.2;
    drops.push({
      kind, x: rand(20 * U, W - 20 * U), y: -30 * U,
      r: (isOil ? 11 : big ? 14 : 7) * U,
      vy: (isOil ? rand(140, 190) : rand(200, 280) * (big ? 0.8 : 1)) * U * (1 + d * 0.9),
      big,
    });
  }

  function burst(x, y, color, n, speed) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = rand(0.3, 1) * speed * U;
      particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(0.3, 0.7), max: 0.7, color, r: rand(1.5, 3.5) * U });
    }
  }

  function floatText(x, y, text, color) { floaters.push({ x, y, text, color, life: 0.9 }); }

  // ---------- Update ----------
  function update(dt) {
    time += dt;
    const d = difficulty();

    // Wind: occasional gusts push drops sideways.
    windT -= dt;
    if (windT <= 0) { wind = time > 20 ? rand(-1, 1) * (40 + d * 80) * U : 0; windT = rand(3, 7); }

    // Movement
    const speed = 520 * U;
    if (pointerX !== null) {
      player.vx = clamp((pointerX - player.x) * 14, -speed * 1.6, speed * 1.6);
    } else {
      const dir = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
      player.vx += (dir * speed - player.vx) * Math.min(1, dt * 14);
    }
    player.x = clamp(player.x + player.vx * dt, player.r, W - player.r);

    // Fuel burn
    fuel -= dt * (5 + d * 4);

    // Spawning
    spawnRain -= dt; spawnOil -= dt;
    const widthFactor = clamp(W / (500 * U), 0.8, 2.2); // wider screens get more rain
    if (spawnRain <= 0) { spawn('rain'); spawnRain = rand(0.35, 0.75) / ((1 + d * 2.2) * widthFactor); }
    if (spawnOil <= 0) { spawn('oil'); spawnOil = rand(1.4, 2.4) + d * 0.6; }

    // Drops
    const hitR = player.r * 0.75;
    for (let i = drops.length - 1; i >= 0; i--) {
      const o = drops[i];
      o.y += o.vy * dt;
      o.x += wind * dt * (o.kind === 'oil' ? 0.5 : 1);
      const dx = o.x - player.x, dy = o.y - (player.y - player.r * 0.4);
      if (dx * dx + dy * dy < (o.r + hitR) ** 2) {
        if (o.kind === 'oil') {
          fuel = Math.min(100, fuel + 22);
          score += 50;
          sfx.oil(); burst(o.x, o.y, '#ffd36b', 14, 160); floatText(o.x, o.y, '+50', '#ffd36b');
        } else if (hurt <= 0) {
          fuel -= o.big ? 45 : 28;
          hurt = 0.6; shake = 0.25;
          sfx.hit(); burst(o.x, o.y, '#7fc8ff', 18, 200);
          if (navigator.vibrate) try { navigator.vibrate(40); } catch { /* ignore */ }
        } else continue; // invulnerable: rain passes through
        drops.splice(i, 1);
        continue;
      }
      if (o.y - o.r > H) drops.splice(i, 1);
    }

    // Flame particles
    const intensity = clamp(fuel / 100, 0.15, 1);
    for (let i = 0; i < 2; i++) {
      particles.push({
        x: player.x + rand(-4, 4) * U, y: player.y - player.r * 0.9,
        vx: rand(-20, 20) * U - player.vx * 0.15, vy: -rand(40, 110) * U * intensity,
        life: rand(0.25, 0.5) * intensity + 0.1, max: 0.6, color: Math.random() < 0.5 ? '#ffb347' : '#ff6b35', r: rand(2, 4.5) * U * intensity,
      });
    }
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt;
      if (p.life <= 0) particles.splice(i, 1);
    }
    for (let i = floaters.length - 1; i >= 0; i--) {
      const f = floaters[i]; f.y -= 50 * U * dt; f.life -= dt;
      if (f.life <= 0) floaters.splice(i, 1);
    }

    hurt = Math.max(0, hurt - dt);
    shake = Math.max(0, shake - dt);
    score += dt * 10;

    if (fuel <= 0) { fuel = 0; gameOver(); }

    ui.score.textContent = Math.floor(score);
    ui.fuel.style.width = fuel + '%';
  }

  // ---------- Render ----------
  function drawBackground(t) {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#0b0616'); g.addColorStop(0.7, '#1d0f33'); g.addColorStop(1, '#2b1440');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    for (const s of stars) {
      ctx.globalAlpha = 0.35 + 0.35 * Math.sin(t * 1.5 + s.tw);
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, 6.283); ctx.fill();
    }
    ctx.globalAlpha = 1;
    // ground
    ctx.fillStyle = '#160b26'; ctx.fillRect(0, H - 50 * U, W, 50 * U);
  }

  function drawDiya(x, y, r, flicker, alive) {
    // warm glow
    if (alive) {
      const glowR = r * (4 + flicker);
      const gl = ctx.createRadialGradient(x, y - r, 0, x, y - r, glowR);
      gl.addColorStop(0, 'rgba(255,170,60,0.45)'); gl.addColorStop(1, 'rgba(255,120,40,0)');
      ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(x, y - r, glowR, 0, 6.283); ctx.fill();
    }
    // clay lamp
    ctx.fillStyle = '#b5532a';
    ctx.beginPath();
    ctx.moveTo(x - r * 1.6, y);
    ctx.quadraticCurveTo(x, y + r * 1.5, x + r * 1.6, y);
    ctx.lineTo(x + r * 2.1, y - r * 0.35);
    ctx.quadraticCurveTo(x, y + r * 0.2, x - r * 1.6, y);
    ctx.fill();
    ctx.fillStyle = '#8a3a1a'; ctx.fillRect(x - r * 0.5, y + r * 0.6, r, r * 0.35);
    if (!alive) return;
    // flame
    const fh = r * (1.9 + flicker * 0.5) * clamp(fuel / 70, 0.45, 1.1);
    const fl = ctx.createLinearGradient(x, y - fh, x, y);
    fl.addColorStop(0, '#fff3c4'); fl.addColorStop(0.5, '#ffb347'); fl.addColorStop(1, '#ff6b35');
    ctx.fillStyle = fl;
    ctx.beginPath();
    ctx.moveTo(x, y - r * 0.2 - fh);
    ctx.quadraticCurveTo(x + r * 0.8, y - fh * 0.4, x, y - r * 0.1);
    ctx.quadraticCurveTo(x - r * 0.8, y - fh * 0.4, x, y - r * 0.2 - fh);
    ctx.fill();
  }

  function drawDrop(o) {
    if (o.kind === 'oil') {
      const g = ctx.createRadialGradient(o.x - o.r * 0.3, o.y - o.r * 0.3, 1, o.x, o.y, o.r * 1.6);
      g.addColorStop(0, '#fff1a8'); g.addColorStop(0.5, '#f2b51c'); g.addColorStop(1, 'rgba(242,181,28,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(o.x, o.y, o.r * 1.6, 0, 6.283); ctx.fill();
      ctx.fillStyle = '#ffd34d'; ctx.beginPath(); ctx.arc(o.x, o.y, o.r * 0.75, 0, 6.283); ctx.fill();
    } else {
      ctx.fillStyle = o.big ? '#5aa9ff' : '#9fd3ff';
      ctx.beginPath();
      ctx.moveTo(o.x, o.y - o.r * 2.2);
      ctx.quadraticCurveTo(o.x + o.r, o.y - o.r * 0.2, o.x + o.r, o.y + o.r * 0.2);
      ctx.arc(o.x, o.y + o.r * 0.2, o.r, 0, Math.PI);
      ctx.quadraticCurveTo(o.x - o.r, o.y - o.r * 0.2, o.x, o.y - o.r * 2.2);
      ctx.fill();
    }
  }

  function render(t) {
    ctx.save();
    if (shake > 0) ctx.translate(rand(-6, 6) * U * shake * 4, rand(-6, 6) * U * shake * 4);
    drawBackground(t);
    if (player) {
      for (const o of drops) drawDrop(o);
      ctx.globalCompositeOperation = 'lighter';
      for (const p of particles) {
        ctx.globalAlpha = clamp(p.life / p.max, 0, 1);
        ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.283); ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
      const blink = hurt > 0 && Math.floor(hurt * 20) % 2 === 0;
      if (!blink) drawDiya(player.x, player.y, player.r, Math.sin(t * 18) * 0.3 + Math.random() * 0.2, state !== State.OVER);
      ctx.font = `700 ${Math.round(18 * U)}px system-ui, sans-serif`; ctx.textAlign = 'center';
      for (const f of floaters) { ctx.globalAlpha = clamp(f.life, 0, 1); ctx.fillStyle = f.color; ctx.fillText(f.text, f.x, f.y); }
      ctx.globalAlpha = 1;
      if (fuel < 25 && state === State.PLAY) {
        ctx.fillStyle = `rgba(255,60,40,${0.12 + 0.1 * Math.sin(t * 10)})`; ctx.fillRect(0, 0, W, H);
      }
    }
    ctx.restore();
  }

  // ---------- Loop ----------
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000); // cap to avoid tunnelling after tab switches
    last = now;
    if (state === State.PLAY) update(dt);
    else if (state === State.OVER || state === State.MENU) {
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i]; p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt;
        if (p.life <= 0) particles.splice(i, 1);
      }
    }
    render(now / 1000);
    requestAnimationFrame(frame);
  }

  // ---------- Screens ----------
  const show = (el, on) => { el.hidden = !on; };
  function startGame() {
    reset(); state = State.PLAY; sfx.start();
    show(ui.menu, false); show(ui.over, false); show(ui.paused, false); show(ui.hud, true);
  }
  function pause() {
    if (state !== State.PLAY) return;
    state = State.PAUSE; show(ui.paused, true);
  }
  function resume() {
    if (state !== State.PAUSE) return;
    state = State.PLAY; show(ui.paused, false); last = performance.now();
  }
  function toMenu() {
    state = State.MENU; player = null;
    show(ui.paused, false); show(ui.over, false); show(ui.hud, false); show(ui.menu, true);
    ui.best.textContent = best;
  }
  function gameOver() {
    state = State.OVER; sfx.over();
    burst(player.x, player.y - player.r, '#888', 30, 120);
    const s = Math.floor(score);
    const isBest = s > best;
    if (isBest) { best = s; store.set('diya.best', String(best)); }
    ui.finalScore.textContent = s; ui.bestOver.textContent = best;
    $('over-title').textContent = isBest ? 'New best!' : 'The flame went out';
    show(ui.hud, false);
    setTimeout(() => { if (state === State.OVER) show(ui.over, true); }, 600);
  }

  // ---------- Input ----------
  const keyMap = { ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right' };
  window.addEventListener('keydown', (e) => {
    if (keyMap[e.code]) { keys[keyMap[e.code]] = true; pointerX = null; e.preventDefault(); }
    if (e.code === 'Escape' || e.code === 'KeyP') state === State.PLAY ? pause() : resume();
    if ((e.code === 'Space' || e.code === 'Enter') && (state === State.MENU || (state === State.OVER && !ui.over.hidden))) {
      e.preventDefault(); startGame();
    }
  });
  window.addEventListener('keyup', (e) => { if (keyMap[e.code]) keys[keyMap[e.code]] = false; });

  canvas.addEventListener('pointerdown', (e) => { pointerX = e.clientX; canvas.setPointerCapture?.(e.pointerId); });
  canvas.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse' || pointerX !== null) pointerX = e.clientX; });
  const release = (e) => { if (e.pointerType !== 'mouse') pointerX = null; };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);

  $('play-btn').addEventListener('click', startGame);
  $('retry-btn').addEventListener('click', startGame);
  $('menu-btn').addEventListener('click', toMenu);
  $('quit-btn').addEventListener('click', toMenu);
  $('resume-btn').addEventListener('click', resume);
  $('pause-btn').addEventListener('click', pause);
  const renderMute = () => { ui.mute.textContent = 'Sound: ' + (muted ? 'off' : 'on'); };
  ui.mute.addEventListener('click', () => { muted = !muted; store.set('diya.muted', muted ? '1' : '0'); renderMute(); });

  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
  window.addEventListener('blur', pause);
  window.addEventListener('resize', resize);

  // ---------- Install as app (PWA) ----------
  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredPrompt = e; ui.install.hidden = false; });
  ui.install.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    try { await deferredPrompt.userChoice; } catch { /* ignore */ }
    deferredPrompt = null; ui.install.hidden = true;
  });
  window.addEventListener('appinstalled', () => { ui.install.hidden = true; });

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }

  // ---------- Boot ----------
  resize(); renderMute(); ui.best.textContent = best;
  requestAnimationFrame((t) => { last = t; frame(t); });

  // Test hook (harmless in production)
  window.__diya = { get state() { return state; }, get fuel() { return fuel; }, get score() { return score; } };
})();
