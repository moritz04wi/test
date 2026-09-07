/*
 * Flappy Bird — mobile web game
 * Single canvas, no external assets: all art is drawn procedurally and all
 * sound effects are synthesised with the WebAudio API.
 */
(() => {
  'use strict';

  // ---------------------------------------------------------------------------
  // Virtual resolution. Width is fixed so gameplay tuning stays constant; height
  // follows the device aspect ratio so the game fills tall phone screens.
  // ---------------------------------------------------------------------------
  const VW = 288;
  const VH = clamp(Math.round(VW * (window.innerHeight / window.innerWidth)), 420, 680);
  const GROUND_H = 84;
  const FLOOR = VH - GROUND_H;

  // Tuning, expressed per fixed 1/60 s step.
  const STEP = 1 / 60;
  const GRAVITY = 0.40;
  const FLAP_V = -6.9;
  const MAX_FALL = 11;
  const PIPE_W = 54;
  const PIPE_GAP = 132;
  const PIPE_DX = 190;          // horizontal distance between pipes
  const SPEED = 2.35;           // world scroll speed
  const BIRD_X = Math.round(VW * 0.32);
  const BIRD_R = 11;            // collision radius

  const READY = 0, PLAY = 1, DYING = 2, OVER = 3, PAUSED = 4;

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d', { alpha: false });

  // ---------------------------------------------------------------------------
  // Sizing
  // ---------------------------------------------------------------------------
  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    let cssH = window.innerHeight;
    let cssW = cssH * (VW / VH);
    if (cssW > window.innerWidth) {
      cssW = window.innerWidth;
      cssH = cssW * (VH / VW);
    }
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';
    canvas.width = Math.round(VW * dpr);
    canvas.height = Math.round(VH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
  }
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 120));
  resize();

  // ---------------------------------------------------------------------------
  // Audio — small synthesised blips, created lazily on first gesture.
  // ---------------------------------------------------------------------------
  const sfx = (() => {
    let ac = null;
    let muted = load('flappy.muted', 0) === 1;

    function ensure() {
      if (!ac) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        ac = new AC();
      }
      if (ac.state === 'suspended') ac.resume();
      return ac;
    }
    function tone(type, from, to, dur, gain) {
      if (muted) return;
      const c = ensure();
      if (!c) return;
      const t = c.currentTime;
      const osc = c.createOscillator();
      const amp = c.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(from, t);
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t + dur);
      amp.gain.setValueAtTime(gain, t);
      amp.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(amp).connect(c.destination);
      osc.start(t);
      osc.stop(t + dur + 0.02);
    }
    function noise(dur, gain) {
      if (muted) return;
      const c = ensure();
      if (!c) return;
      const len = Math.floor(c.sampleRate * dur);
      const buf = c.createBuffer(1, len, c.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = c.createBufferSource();
      const amp = c.createGain();
      amp.gain.value = gain;
      src.buffer = buf;
      src.connect(amp).connect(c.destination);
      src.start();
    }
    return {
      unlock: ensure,
      get muted() { return muted; },
      toggle() { muted = !muted; save('flappy.muted', muted ? 1 : 0); if (!muted) this.flap(); },
      flap()  { tone('square', 560, 320, 0.09, 0.16); },
      score() { tone('square', 880, 1320, 0.10, 0.16); },
      hit()   { noise(0.14, 0.28); tone('sawtooth', 320, 90, 0.16, 0.18); },
      die()   { tone('triangle', 300, 70, 0.42, 0.16); },
      swoosh(){ tone('sine', 220, 700, 0.14, 0.09); }
    };
  })();

  // ---------------------------------------------------------------------------
  // World state
  // ---------------------------------------------------------------------------
  const bird = { y: 0, v: 0, rot: 0, frame: 0, anim: 0 };
  let pipes = [];
  let clouds = [];
  let bushes = [];
  let state = READY;
  let score = 0;
  let best = load('flappy.best', 0);
  let isNewBest = false;
  let scrollX = 0;
  let flash = 0;
  let shake = 0;
  let bobT = 0;
  let overT = 0;          // delay before taps can restart
  let readyPulse = 0;

  function reset() {
    bird.y = FLOOR * 0.42;
    bird.v = 0;
    bird.rot = 0;
    pipes = [];
    score = 0;
    isNewBest = false;
    flash = 0;
    shake = 0;
    overT = 0;
    state = READY;
  }

  function seedScenery() {
    clouds = [];
    for (let i = 0; i < 6; i++) {
      clouds.push({
        x: Math.random() * VW * 1.6,
        y: 30 + Math.random() * (FLOOR * 0.42),
        s: 0.6 + Math.random() * 0.9,
        d: 0.16 + Math.random() * 0.16
      });
    }
    bushes = [];
    for (let i = 0; i < 14; i++) {
      bushes.push({ x: i * 34 + Math.random() * 12, h: 14 + Math.random() * 16, w: 26 + Math.random() * 22 });
    }
  }
  seedScenery();

  function spawnPipe(x) {
    const margin = 54;
    const lo = margin;
    const hi = FLOOR - PIPE_GAP - margin;
    // Keep consecutive gaps within reach of each other, otherwise tall screens
    // produce jumps the bird physically cannot make in one pipe spacing.
    const prev = pipes.length ? pipes[pipes.length - 1].top : (lo + hi) / 2;
    const reach = 150;
    const top = lo + Math.random() * (hi - lo);
    pipes.push({ x, top: clamp(top, Math.max(lo, prev - reach), Math.min(hi, prev + reach)), passed: false });
  }

  function startRun() {
    state = PLAY;
    pipes = [];
    for (let i = 0; i < 3; i++) spawnPipe(VW + 80 + i * PIPE_DX);
    flap();
  }

  function flap() {
    bird.v = FLAP_V;
    bird.anim = 0;
    sfx.flap();
  }

  function die(hitGround) {
    if (state !== PLAY) return;
    state = DYING;
    flash = 1;
    shake = 8;
    sfx.hit();
    if (!hitGround) setTimeout(() => sfx.die(), 180);
    if (score > best) { best = score; isNewBest = true; save('flappy.best', best); }
    if (navigator.vibrate) navigator.vibrate(45);
  }

  // ---------------------------------------------------------------------------
  // Input
  // ---------------------------------------------------------------------------
  const muteBtn = { x: VW - 34, y: 20, w: 24, h: 24 };

  function tap(px, py) {
    sfx.unlock();
    if (px != null && px >= muteBtn.x - 6 && px <= muteBtn.x + muteBtn.w + 6 &&
        py >= muteBtn.y - 6 && py <= muteBtn.y + muteBtn.h + 6) {
      sfx.toggle();
      return;
    }
    if (state === PAUSED) state = PLAY;
    else if (state === READY) startRun();
    else if (state === PLAY) flap();
    else if (state === OVER && overT > 0.45) { sfx.swoosh(); reset(); }
  }

  function toVirtual(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    return [(clientX - r.left) * (VW / r.width), (clientY - r.top) * (VH / r.height)];
  }

  canvas.addEventListener('pointerdown', e => {
    e.preventDefault();
    const [x, y] = toVirtual(e.clientX, e.clientY);
    tap(x, y);
  }, { passive: false });

  // Fallback for browsers without pointer events.
  if (!window.PointerEvent) {
    canvas.addEventListener('touchstart', e => {
      e.preventDefault();
      const t = e.changedTouches[0];
      const [x, y] = toVirtual(t.clientX, t.clientY);
      tap(x, y);
    }, { passive: false });
  }

  window.addEventListener('keydown', e => {
    if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'Enter') {
      e.preventDefault();
      tap(null, null);
    } else if (e.code === 'KeyM') {
      sfx.unlock();
      sfx.toggle();
    } else if (e.code === 'KeyP' || e.code === 'Escape') {
      if (state === PLAY) state = PAUSED;
      else if (state === PAUSED) state = PLAY;
    }
  });

  // Leaving the tab pauses the run instead of ending it, so no score is lost.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && state === PLAY) state = PAUSED;
  });
  window.addEventListener('blur', () => { if (state === PLAY) state = PAUSED; });
  window.addEventListener('contextmenu', e => e.preventDefault());

  // ---------------------------------------------------------------------------
  // Update
  // ---------------------------------------------------------------------------
  function update() {
    if (state === PAUSED) return;
    bobT += STEP;
    readyPulse += STEP;
    if (flash > 0) flash = Math.max(0, flash - 0.08);
    if (shake > 0) shake = Math.max(0, shake - 0.6);
    if (state === OVER) overT += STEP;

    const moving = state === READY || state === PLAY;
    if (moving) scrollX += SPEED;
    for (const c of clouds) {
      if (moving) c.x -= c.d;
      if (c.x < -60) { c.x = VW + 30 + Math.random() * 60; c.y = 30 + Math.random() * (FLOOR * 0.42); }
    }

    if (state === READY) {
      bird.y = FLOOR * 0.42 + Math.sin(bobT * 5) * 5;
      bird.rot = Math.sin(bobT * 5) * 0.08;
    }

    if (state === PLAY || state === DYING) {
      bird.v = Math.min(bird.v + GRAVITY, MAX_FALL);
      bird.y += bird.v;
      // Nose up while rising, tip over progressively while falling.
      const target = bird.v < 0 ? -0.5 : clamp((bird.v - 2) * 0.12, -0.5, Math.PI / 2);
      bird.rot += (target - bird.rot) * (bird.v < 0 ? 0.35 : 0.12);
    }

    if (state === PLAY) {
      bird.anim += STEP;
      bird.frame = bird.v < -1 ? 0 : Math.floor(bobT * 12) % 4;

      for (const p of pipes) p.x -= SPEED;
      if (pipes.length && pipes[0].x < -PIPE_W) pipes.shift();
      const last = pipes[pipes.length - 1];
      if (!last || last.x < VW - PIPE_DX) spawnPipe((last ? last.x : VW) + PIPE_DX);

      for (const p of pipes) {
        if (!p.passed && p.x + PIPE_W < BIRD_X - BIRD_R) {
          p.passed = true;
          score++;
          sfx.score();
        }
        if (hitsPipe(p)) { die(false); break; }
      }
      if (state === PLAY && bird.y - BIRD_R < 0) { bird.y = BIRD_R; bird.v = 0; }
    }

    if (state === DYING) {
      bird.frame = 1;
      if (bird.y + BIRD_R >= FLOOR) {
        bird.y = FLOOR - BIRD_R;
        bird.v = 0;
        bird.rot = Math.PI / 2;
        state = OVER;
        overT = 0;
      }
    }
    if (state === PLAY && bird.y + BIRD_R >= FLOOR) {
      bird.y = FLOOR - BIRD_R;
      die(true);
      state = OVER;
      overT = 0;
      bird.rot = Math.PI / 2;
    }
  }

  function hitsPipe(p) {
    const bx = BIRD_X, by = bird.y;
    if (bx + BIRD_R < p.x || bx - BIRD_R > p.x + PIPE_W) return false;
    // Nearest point on each pipe rectangle to the bird's centre.
    const cx = clamp(bx, p.x, p.x + PIPE_W);
    const topY = clamp(by, 0, p.top);
    const botY = clamp(by, p.top + PIPE_GAP, FLOOR);
    return dist2(bx, by, cx, topY) < BIRD_R * BIRD_R || dist2(bx, by, cx, botY) < BIRD_R * BIRD_R;
  }

  // ---------------------------------------------------------------------------
  // Draw
  // ---------------------------------------------------------------------------
  function draw() {
    ctx.save();
    if (shake > 0) ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);

    drawSky();
    drawClouds();
    drawSkyline();
    drawBushes();
    for (const p of pipes) drawPipe(p);
    drawGround();
    drawBird();
    ctx.restore();

    drawHud();

    if (flash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${flash * 0.75})`;
      ctx.fillRect(0, 0, VW, VH);
    }
  }

  function drawSky() {
    const g = ctx.createLinearGradient(0, 0, 0, FLOOR);
    g.addColorStop(0, '#3ba9c6');
    g.addColorStop(0.55, '#4ec0ca');
    g.addColorStop(1, '#8fe0d4');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, VW, FLOOR);
  }

  function drawClouds() {
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    for (const c of clouds) {
      const r = 12 * c.s;
      ctx.beginPath();
      ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
      ctx.arc(c.x + r, c.y + r * 0.25, r * 0.8, 0, Math.PI * 2);
      ctx.arc(c.x - r, c.y + r * 0.3, r * 0.7, 0, Math.PI * 2);
      ctx.arc(c.x + r * 0.3, c.y - r * 0.55, r * 0.7, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawSkyline() {
    const base = FLOOR - 34;
    const off = (scrollX * 0.25) % 48;
    ctx.fillStyle = '#59c3a6';
    for (let i = -1; i < VW / 48 + 2; i++) {
      const x = i * 48 - off;
      ctx.beginPath();
      ctx.moveTo(x, base + 34);
      ctx.lineTo(x + 24, base - 16);
      ctx.lineTo(x + 48, base + 34);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = '#6ed0b0';
    const off2 = (scrollX * 0.35) % 40;
    for (let i = -1; i < VW / 40 + 2; i++) {
      const x = i * 40 - off2 + 20;
      ctx.fillRect(x, base + 6, 22, 28);
      ctx.fillRect(x + 6, base - 2, 10, 12);
    }
  }

  function drawBushes() {
    const off = (scrollX * 0.55) % 34;
    ctx.fillStyle = '#7fd44a';
    for (let i = 0; i < bushes.length; i++) {
      const b = bushes[i];
      const x = ((b.x - off) % (VW + 60) + VW + 60) % (VW + 60) - 30;
      ctx.beginPath();
      ctx.ellipse(x, FLOOR + 2, b.w / 2, b.h, 0, Math.PI, 0);
      ctx.fill();
    }
  }

  function drawPipe(p) {
    const bodyTop = p.top;
    const bodyBottomY = p.top + PIPE_GAP;
    pipeBody(p.x, 0, PIPE_W, bodyTop);
    pipeCap(p.x - 3, bodyTop - 26, PIPE_W + 6, 26);
    pipeBody(p.x, bodyBottomY, PIPE_W, FLOOR - bodyBottomY);
    pipeCap(p.x - 3, bodyBottomY, PIPE_W + 6, 26);
  }

  function pipeBody(x, y, w, h) {
    if (h <= 0) return;
    const g = ctx.createLinearGradient(x, 0, x + w, 0);
    g.addColorStop(0, '#3f8b1f');
    g.addColorStop(0.18, '#8fd94b');
    g.addColorStop(0.55, '#5aa82c');
    g.addColorStop(1, '#2f6b18');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = '#23500f';
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, y - 1, w - 2, h + 2);
  }

  function pipeCap(x, y, w, h) {
    const g = ctx.createLinearGradient(x, 0, x + w, 0);
    g.addColorStop(0, '#458f22');
    g.addColorStop(0.18, '#9ce055');
    g.addColorStop(0.6, '#5fae30');
    g.addColorStop(1, '#2f6b18');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = '#23500f';
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
  }

  function drawGround() {
    ctx.fillStyle = '#ded895';
    ctx.fillRect(0, FLOOR, VW, GROUND_H);
    ctx.fillStyle = '#7fd44a';
    ctx.fillRect(0, FLOOR, VW, 10);
    ctx.fillStyle = '#5fb62f';
    const off = scrollX % 16;
    for (let x = -16; x < VW + 16; x += 16) {
      ctx.beginPath();
      ctx.moveTo(x - off, FLOOR + 10);
      ctx.lineTo(x - off + 8, FLOOR + 4);
      ctx.lineTo(x - off + 16, FLOOR + 10);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = '#cfc77f';
    for (let x = -24; x < VW + 24; x += 24) {
      ctx.fillRect(x - (scrollX * 1) % 24, FLOOR + 14, 12, 5);
    }
  }

  function drawBird() {
    ctx.save();
    ctx.translate(BIRD_X, bird.y);
    ctx.rotate(bird.rot);

    const wingPhase = [0, -1, 0, 1][bird.frame] * (state === PLAY || state === READY ? 1 : 0);

    // body
    ctx.fillStyle = '#f7d94c';
    ctx.strokeStyle = '#3a2c0a';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.ellipse(0, 0, 13, 10.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // belly
    ctx.fillStyle = '#fdf2b6';
    ctx.beginPath();
    ctx.ellipse(1.5, 3.5, 8.5, 6, 0, 0, Math.PI * 2);
    ctx.fill();

    // wing
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.ellipse(-2.5, 1 + wingPhase * 3.5, 6.5, 4.2 - Math.abs(wingPhase) * 1.2, wingPhase * 0.45, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // eye
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(6, -3.5, 4.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#20160a';
    ctx.beginPath();
    ctx.arc(7.4, -3.5, 1.9, 0, Math.PI * 2);
    ctx.fill();

    // beak
    ctx.fillStyle = '#f4842c';
    ctx.beginPath();
    ctx.moveTo(10, -0.5);
    ctx.lineTo(18, 1.5);
    ctx.lineTo(10, 4.5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.restore();
  }

  // ---------------------------------------------------------------------------
  // HUD / overlays
  // ---------------------------------------------------------------------------
  function drawHud() {
    drawMute();

    if (state === PLAY || state === DYING || state === PAUSED) {
      bigNumber(String(score), VW / 2, 62, 30);
    }

    if (state === READY) {
      bigNumber('FLAPPY', VW / 2, VH * 0.17, 22);
      if (best > 0) outlineText('BEST ' + best, VW / 2, VH * 0.17 + 26, 11, 0.95);
      const a = 0.55 + Math.sin(readyPulse * 4) * 0.35;
      outlineText('TIPPEN ZUM STARTEN', VW / 2, FLOOR * 0.72, 11, a);
      // pulsing tap hint
      ctx.save();
      ctx.globalAlpha = a;
      ctx.translate(VW / 2, FLOOR * 0.72 + 26 + Math.sin(readyPulse * 4) * 3);
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = 'rgba(0,0,0,.5)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(0, 0, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    if (state === PAUSED) {
      ctx.fillStyle = 'rgba(0,0,0,.4)';
      ctx.fillRect(0, 0, VW, VH);
      bigNumber('PAUSE', VW / 2, VH * 0.42, 24);
      outlineText('TIPPEN ZUM FORTSETZEN', VW / 2, VH * 0.42 + 30, 11, 0.9);
    }

    if (state === OVER) {
      const t = Math.min(1, overT / 0.35);
      const dy = (1 - t) * -20;
      ctx.save();
      ctx.globalAlpha = t;

      ctx.fillStyle = 'rgba(0,0,0,.35)';
      ctx.fillRect(0, 0, VW, VH);

      const titleY = VH * 0.20 + dy;
      bigNumber('GAME OVER', VW / 2, titleY, 22);

      const cw = 200, ch = 100, cx = (VW - cw) / 2, cy = titleY + 26;
      roundRect(cx, cy, cw, ch, 8);
      ctx.fillStyle = '#ded895';
      ctx.fill();
      ctx.strokeStyle = '#c2b96f';
      ctx.lineWidth = 3;
      ctx.stroke();

      drawMedal(cx + 38, cy + ch / 2, score);

      const col = cx + cw - 60;
      panelText('SCORE', col, cy + 24, 9, '#e07c2a');
      bigNumber(String(score), col, cy + 46, 16);
      panelText('BEST', col, cy + 64, 9, '#e07c2a');
      bigNumber(String(best), col, cy + 86, 16);

      if (isNewBest) {
        ctx.save();
        ctx.translate(cx + 88, cy + 70);
        ctx.rotate(-0.2);
        ctx.fillStyle = '#e33d3d';
        roundRect(-19, -8, 38, 15, 3);
        ctx.fill();
        panelText('NEW!', 0, 3, 8, '#fff');
        ctx.restore();
      }

      if (overT > 0.45) {
        const a = 0.55 + Math.sin(overT * 5) * 0.35;
        outlineText('TIPPEN FÜR NEUSTART', VW / 2, cy + ch + 40, 11, a);
      }
      ctx.restore();
    }
  }

  function drawMedal(x, y, s) {
    let outer, inner, label;
    if (s >= 40)      { outer = '#dfe9ef'; inner = '#b9cbd6'; label = 'PLAT'; }
    else if (s >= 30) { outer = '#f5d24a'; inner = '#e0af22'; label = 'GOLD'; }
    else if (s >= 20) { outer = '#dfe3e6'; inner = '#b3bcc2'; label = 'SILV'; }
    else if (s >= 10) { outer = '#d79a5b'; inner = '#b3762f'; label = 'BRNZ'; }
    else              { outer = null; }

    if (!outer) {
      ctx.strokeStyle = 'rgba(0,0,0,.15)';
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, 21, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      panelText('—', x, y + 4, 10, 'rgba(0,0,0,.25)');
      return;
    }
    ctx.fillStyle = inner;
    ctx.beginPath();
    ctx.arc(x, y, 22, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = outer;
    ctx.beginPath();
    ctx.arc(x, y, 18, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.35)';
    ctx.beginPath();
    ctx.arc(x - 5, y - 6, 8, 0, Math.PI * 2);
    ctx.fill();
    panelText(label, x, y + 3, 7, 'rgba(0,0,0,.55)');
  }

  // Chunky outlined display text (stands in for the bitmap font of the original).
  function bigNumber(text, cx, y, size) {
    ctx.save();
    ctx.font = `bold ${size}px "Trebuchet MS", Verdana, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.lineJoin = 'round';
    ctx.miterLimit = 2;
    ctx.strokeStyle = '#2a2a2a';
    ctx.lineWidth = Math.max(3, size * 0.22);
    ctx.strokeText(text, cx, y);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, cx, y);
    ctx.restore();
  }

  function outlineText(text, cx, y, size, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha;
    bigNumber(text, cx, y, size);
    ctx.restore();
  }

  function panelText(text, cx, y, size, color) {
    ctx.save();
    ctx.font = `bold ${size}px "Trebuchet MS", Verdana, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillStyle = color;
    ctx.fillText(text, cx, y);
    ctx.restore();
  }

  function drawMute() {
    const { x, y, w, h } = muteBtn;
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = 'rgba(0,0,0,.22)';
    roundRect(x, y, w, h, 5);
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.fillStyle = '#fff';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(x + 6, y + 9);
    ctx.lineTo(x + 9, y + 9);
    ctx.lineTo(x + 12, y + 6);
    ctx.lineTo(x + 12, y + 16);
    ctx.lineTo(x + 9, y + 13);
    ctx.lineTo(x + 6, y + 13);
    ctx.closePath();
    ctx.fill();
    if (sfx.muted) {
      ctx.beginPath();
      ctx.moveTo(x + 14, y + 8);
      ctx.lineTo(x + 19, y + 14);
      ctx.moveTo(x + 19, y + 8);
      ctx.lineTo(x + 14, y + 14);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(x + 13, y + 11, 4, -0.8, 0.8);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x + 13, y + 11, 7, -0.8, 0.8);
      ctx.stroke();
    }
    ctx.restore();
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // ---------------------------------------------------------------------------
  // Main loop — fixed timestep so physics is identical on 60/90/120 Hz screens.
  // ---------------------------------------------------------------------------
  let last = performance.now();
  let acc = 0;
  function frame(now) {
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.25) dt = 0.25;         // tab was backgrounded
    acc += dt;
    while (acc >= STEP) { update(); acc -= STEP; }
    draw();
    requestAnimationFrame(frame);
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function dist2(ax, ay, bx, by) { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; }
  function load(key, dflt) {
    try { const v = localStorage.getItem(key); return v == null ? dflt : Number(v) || 0; }
    catch (_) { return dflt; }
  }
  function save(key, value) {
    try { localStorage.setItem(key, String(value)); } catch (_) { /* private mode */ }
  }

  reset();
  requestAnimationFrame(frame);

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
