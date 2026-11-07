import { GLYPHS } from './glyphs.js';

const root = document.documentElement;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

const RUNE_OF = {
  a: 'ᚨ', b: 'ᛒ', c: 'ᚲ', d: 'ᛞ', e: 'ᛖ', f: 'ᚠ', g: 'ᚷ', h: 'ᚺ', i: 'ᛁ', j: 'ᛃ', k: 'ᚲ', l: 'ᛚ', m: 'ᛗ',
  n: 'ᚾ', o: 'ᛟ', p: 'ᛈ', q: 'ᚲ', r: 'ᚱ', s: 'ᛊ', t: 'ᛏ', u: 'ᚢ', v: 'ᚹ', w: 'ᚹ', x: 'ᚷ', y: 'ᛃ', z: 'ᛉ',
  æ: 'ᚨ', ø: 'ᛟ', å: 'ᚨ',
};
const toRunes = (s) => Array.from(s, (c) => RUNE_OF[c.toLowerCase()] ?? c).join('');

const PALETTE = {
  day: { ink: [22, 21, 15], dot: [22, 21, 15], dotAlpha: 0.2, accent: [200, 69, 44], theme: '#f1ede3' },
  dream: { ink: [235, 231, 255], dot: [214, 208, 255], dotAlpha: 0.34, accent: [244, 184, 96], theme: '#0a0c19' },
};

const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);
const mixRGB = (a, b, m) => a.map((v, i) => Math.round(v + (b[i] - v) * m));
const rgba = (c, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

let dream = root.dataset.mode === 'dream';

/* ── glyph geometry ───────────────────────────────────── */
const lengthCache = new Map();
function strokeLengths(ch) {
  let entry = lengthCache.get(ch);
  if (!entry) {
    const lens = GLYPHS[ch].map((s) => {
      if (s.length === 1) return 1;
      let l = 0;
      for (let i = 1; i < s.length; i++) l += Math.hypot(s[i][0] - s[i - 1][0], s[i][1] - s[i - 1][1]);
      return l;
    });
    entry = { lens, total: lens.reduce((a, b) => a + b, 0) };
    lengthCache.set(ch, entry);
  }
  return entry;
}

/* ── the dot field ────────────────────────────────────── */
function createField(canvas, hero) {
  const ctx = canvas.getContext('2d');
  const NAME = 'ANDREAS RUDOLPH';
  const STAGGER_IN = 75, DUR_IN = 1100, STAGGER_SWAP = 55, DUR_SWAP = 1000, TRAIL_LIFE = 1800;

  let W = 0, H = 0, dpr = 1, p = 20, ox = 0, oy = 0, gx0 = 0, gy0 = 0;
  let cells = [];
  let dots = new Float32Array(0);
  const pointer = { x: 0, y: 0, sx: 0, sy: 0, presence: 0, inside: false };
  const trail = [];
  let lastSnap = null;
  let stars = [], nextStar = 0;

  const now0 = performance.now();
  let phase = {
    from: null,
    to: dream ? 'rune' : 'latin',
    t0: reduceMotion ? -1e9 : now0 + 250,
    stagger: STAGGER_IN,
    dur: DUR_IN,
  };
  let mix = dream ? 1 : 0, mixFrom = mix, mixTo = mix, mixT0 = 0;
  let running = false, visible = true, rafId = 0;

  function layout() {
    const r = canvas.getBoundingClientRect();
    W = r.width; H = r.height;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);

    const g = Math.min(56, Math.max(20, window.innerWidth * 0.04));
    const oneLine = W >= 900 && W / H > 1.15;
    const lines = oneLine ? [NAME] : ['ANDREAS', 'RUDOLPH'];
    const wCols = Math.max(...lines.map((l) => l.length)) * 3 - 1;
    const hRows = lines.length * 6 + (lines.length - 1) * 3;
    p = Math.max(8, Math.floor(Math.min((W - 2 * g) / wCols, (H * 0.42) / hRows)));
    ox = Math.round(g);
    oy = oneLine ? Math.round(H * 0.3) : Math.round(Math.max(96, H * 0.17));

    cells = [];
    lines.forEach((line, li) => {
      Array.from(line).forEach((ch, ci) => {
        if (ch === ' ') return;
        cells.push({ latin: ch, rune: toRunes(ch), col: ci * 3, row: li * 9, idx: cells.length });
      });
    });

    gx0 = ox - Math.floor(ox / p) * p;
    gy0 = oy - Math.floor(oy / p) * p;
    const nx = Math.floor((W - gx0) / p) + 1;
    const ny = Math.floor((H - gy0) / p) + 1;
    dots = new Float32Array(nx * ny * 4);
    let k = 0;
    for (let iy = 0; iy < ny; iy++) {
      for (let ix = 0; ix < nx; ix++) {
        const h = Math.sin(ix * 127.1 + iy * 311.7) * 43758.5453;
        dots[k++] = gx0 + ix * p;
        dots[k++] = gy0 + iy * p;
        dots[k++] = (h - Math.floor(h)) * Math.PI * 2; // twinkle phase
        dots[k++] = 0.6 + ((h * 7.13) % 1 + 1) % 1 * 1.8; // twinkle speed
      }
    }
    trail.length = 0;
    lastSnap = null;
    if (!running) frame(performance.now());
  }

  function drawGlyph(ch, cx, cy, q, w) {
    if (q <= 0) return;
    const strokes = GLYPHS[ch];
    if (!strokes) return;
    const { lens, total } = strokeLengths(ch);
    let budget = q * total;
    ctx.lineWidth = w;
    for (let i = 0; i < strokes.length && budget > 0; i++) {
      const s = strokes[i];
      const len = lens[i];
      if (s.length === 1) {
        const size = 1.4 * w * Math.min(1, budget / len);
        ctx.fillRect(cx + s[0][0] * p - size / 2, cy + (6 - s[0][1]) * p - size / 2, size, size);
        budget -= len;
        continue;
      }
      ctx.beginPath();
      ctx.moveTo(cx + s[0][0] * p, cy + (6 - s[0][1]) * p);
      let rem = budget;
      for (let j = 1; j < s.length; j++) {
        const [ax, ay] = s[j - 1], [bx, by] = s[j];
        const seg = Math.hypot(bx - ax, by - ay);
        if (rem >= seg) {
          ctx.lineTo(cx + bx * p, cy + (6 - by) * p);
          rem -= seg;
        } else {
          const f = rem / seg;
          ctx.lineTo(cx + (ax + (bx - ax) * f) * p, cy + (6 - (ay + (by - ay) * f)) * p);
          break;
        }
      }
      ctx.stroke();
      budget -= len;
    }
  }

  function frame(now) {
    // palette crossfade
    if (mix !== mixTo) {
      const t = reduceMotion ? 1 : clamp01((now - mixT0) / 1200);
      mix = mixFrom + (mixTo - mixFrom) * easeInOut(t);
    }
    const pal = {
      ink: mixRGB(PALETTE.day.ink, PALETTE.dream.ink, mix),
      dot: mixRGB(PALETTE.day.dot, PALETTE.dream.dot, mix),
      accent: mixRGB(PALETTE.day.accent, PALETTE.dream.accent, mix),
      dotAlpha: PALETTE.day.dotAlpha + (PALETTE.dream.dotAlpha - PALETTE.day.dotAlpha) * mix,
    };

    // pointer smoothing
    pointer.sx += (pointer.x - pointer.sx) * 0.16;
    pointer.sy += (pointer.y - pointer.sy) * 0.16;
    pointer.presence += ((pointer.inside ? 1 : 0) - pointer.presence) * 0.08;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    // grid of dots; squares, like the font's nib
    const base = Math.max(1.1, p * 0.05);
    const R = p * 6, R2 = R * R;
    const near = [];
    const tw = reduceMotion ? 0 : mix;
    const t = now / 1000;
    ctx.fillStyle = rgba(pal.dot);
    for (let k = 0; k < dots.length; k += 4) {
      const x = dots[k], y = dots[k + 1];
      const dx = x - pointer.sx, dy = y - pointer.sy;
      const d2 = dx * dx + dy * dy;
      if (d2 < R2 && pointer.presence > 0.01) {
        const f = (1 - Math.sqrt(d2) / R) ** 2 * pointer.presence;
        if (f > 0.02) { near.push(x, y, f); continue; }
      }
      const twinkle = tw ? 1 - tw * 0.75 * (0.5 + 0.5 * Math.sin(t * dots[k + 3] + dots[k + 2])) : 1;
      ctx.globalAlpha = pal.dotAlpha * twinkle;
      ctx.fillRect(x - base / 2, y - base / 2, base, base);
    }
    ctx.fillStyle = rgba(pal.accent);
    for (let i = 0; i < near.length; i += 3) {
      const f = near[i + 2];
      const s = base * (1 + 1.8 * f);
      ctx.globalAlpha = pal.dotAlpha + (1 - pal.dotAlpha) * f;
      ctx.fillRect(near[i] - s / 2, near[i + 1] - s / 2, s, s);
    }
    ctx.globalAlpha = 1;

    // shooting stars while dreaming
    if (!reduceMotion && mix > 0.6) {
      if (now > nextStar) {
        const ang = Math.PI * (0.78 + Math.random() * 0.1);
        stars.push({ x: W * (0.35 + Math.random() * 0.65), y: H * Math.random() * 0.35, ang, len: W * 0.18, t0: now });
        nextStar = now + 3500 + Math.random() * 5000;
      }
      stars = stars.filter((s) => now - s.t0 < 1100);
      for (const s of stars) {
        const k = (now - s.t0) / 1100;
        const hx = s.x + Math.cos(s.ang) * s.len * 2 * k, hy = s.y + Math.sin(s.ang) * s.len * 2 * k;
        const tx = hx - Math.cos(s.ang) * s.len, ty = hy - Math.sin(s.ang) * s.len;
        const grad = ctx.createLinearGradient(tx, ty, hx, hy);
        grad.addColorStop(0, rgba(pal.ink, 0));
        grad.addColorStop(1, rgba(pal.ink, 0.7 * Math.sin(Math.PI * k) * mix));
        ctx.strokeStyle = grad;
        ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(hx, hy); ctx.stroke();
      }
    } else if (stars.length) {
      stars = [];
    }

    // the name, dot to dot
    ctx.strokeStyle = rgba(pal.ink);
    ctx.fillStyle = rgba(pal.ink);
    ctx.lineCap = 'square';
    ctx.lineJoin = 'miter';
    ctx.miterLimit = 2;
    const pen = Math.max(1.5, p * 0.16);
    let animating = false;
    for (const c of cells) {
      const cx = ox + c.col * p, cy = oy + c.row * p;
      const dx = cx + p - pointer.sx, dy = cy + 3 * p - pointer.sy;
      const f = Math.max(0, 1 - Math.hypot(dx, dy) / (p * 7)) ** 2 * pointer.presence;
      const w = pen * (1 + 1.2 * f);
      const lt = clamp01((now - phase.t0 - c.idx * phase.stagger) / phase.dur);
      if (lt < 1) animating = true;
      const e = easeInOut(lt);
      if (phase.from && e < 1) drawGlyph(c[phase.from], cx, cy, 1 - e, w);
      drawGlyph(c[phase.to], cx, cy, e, w);
    }

    // the visitor's own constellation
    const accent = pal.accent;
    for (let i = trail.length - 1; i >= 0; i--) {
      if (now - trail[i].t > TRAIL_LIFE) trail.splice(i, 1);
    }
    ctx.lineWidth = Math.max(1.2, pen * 0.5);
    for (const s of trail) {
      const a = (1 - (now - s.t) / TRAIL_LIFE) ** 1.5;
      ctx.strokeStyle = rgba(accent, a);
      ctx.beginPath(); ctx.moveTo(s.x1, s.y1); ctx.lineTo(s.x2, s.y2); ctx.stroke();
    }
    if (lastSnap && pointer.presence > 0.05) {
      const s = pen * 1.1;
      ctx.fillStyle = rgba(accent, pointer.presence);
      ctx.fillRect(lastSnap.x - s / 2, lastSnap.y - s / 2, s, s);
    }

    const busy = animating || trail.length || pointer.presence > 0.01 || Math.abs(pointer.x - pointer.sx) > 0.5 || mix !== mixTo || (!reduceMotion && mix > 0);
    if (visible && busy) {
      running = true;
      rafId = requestAnimationFrame(frame);
    } else {
      running = false;
    }
  }

  function wake() {
    if (!running && visible) {
      running = true;
      rafId = requestAnimationFrame(frame);
    }
  }

  function onMove(e) {
    const r = canvas.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    if (!pointer.inside) { pointer.sx = x; pointer.sy = y; }
    pointer.x = x; pointer.y = y; pointer.inside = true;
    const ix = Math.round((x - gx0) / p), iy = Math.round((y - gy0) / p);
    const sx = gx0 + ix * p, sy = gy0 + iy * p;
    if (!lastSnap || lastSnap.ix !== ix || lastSnap.iy !== iy) {
      if (lastSnap && Math.hypot(sx - lastSnap.x, sy - lastSnap.y) < p * 5) {
        trail.push({ x1: lastSnap.x, y1: lastSnap.y, x2: sx, y2: sy, t: performance.now() });
        if (trail.length > 80) trail.shift();
      }
      lastSnap = { ix, iy, x: sx, y: sy };
    }
    wake();
  }
  function onLeave() { pointer.inside = false; lastSnap = null; wake(); }

  hero.addEventListener('pointermove', onMove, { passive: true });
  hero.addEventListener('pointerleave', onLeave);
  hero.addEventListener('pointercancel', onLeave);
  new ResizeObserver(layout).observe(canvas);
  new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; wake(); }).observe(canvas);
  document.addEventListener('visibilitychange', () => { visible = !document.hidden; wake(); });

  layout();

  return {
    setMode(isDream) {
      const now = performance.now();
      phase = { from: phase.to, to: isDream ? 'rune' : 'latin', t0: reduceMotion ? -1e9 : now, stagger: STAGGER_SWAP, dur: DUR_SWAP };
      mixFrom = mix; mixTo = isDream ? 1 : 0; mixT0 = now;
      wake();
    },
  };
}

/* ── sigils: a rune per project, drawn on the same grid ─ */
function sigilSVG(ch) {
  const S = 10;
  const P = ([x, y]) => `${x * S},${(6 - y) * S}`;
  let grid = '', ink = '';
  for (let x = 0; x <= 2; x++) for (let y = 0; y <= 6; y++) grid += `<rect x="${x * S - 1}" y="${(6 - y) * S - 1}" width="2" height="2"/>`;
  for (const s of GLYPHS[ch]) {
    if (s.length === 1) {
      const [x, y] = P(s[0]).split(',').map(Number);
      ink += `<rect class="ink-dot" x="${x - 2.5}" y="${y - 2.5}" width="5" height="5"/>`;
    } else {
      ink += `<polyline class="ink" pathLength="1" points="${s.map(P).join(' ')}"/>`;
    }
  }
  return `<svg class="sigil" viewBox="-6 -6 32 72" aria-hidden="true"><g class="grid">${grid}</g>${ink}</svg>`;
}

/* ── reality check: in dreams, text doesn't stay the same ─ */
function setupRuneText() {
  const els = [...document.querySelectorAll('[data-rune]')];
  for (const el of els) el.dataset.latin = el.textContent;
  const swap = (el, on) => { el.textContent = on ? toRunes(el.dataset.latin) : el.dataset.latin; };
  // a work row's stretched link covers its title, so the whole row is the hover target
  const hoverTarget = (el) => el.closest('.work') ?? el;
  for (const el of els) {
    const target = hoverTarget(el);
    target.addEventListener('pointerenter', () => dream && swap(el, true));
    target.addEventListener('pointerleave', () => swap(el, false));
  }
  if (!reduceMotion) {
    setInterval(() => {
      if (!dream || document.hidden) return;
      const inView = els.filter((el) => {
        const r = el.getBoundingClientRect();
        return r.bottom > 0 && r.top < innerHeight && !hoverTarget(el).matches(':hover');
      });
      if (!inView.length) return;
      const el = inView[Math.floor(Math.random() * inView.length)];
      swap(el, true);
      setTimeout(() => hoverTarget(el).matches(':hover') || swap(el, false), 900);
    }, 2600);
  }
  return () => els.forEach((el) => swap(el, false));
}

/* ── boot ─────────────────────────────────────────────── */
const field = createField(document.getElementById('field'), document.querySelector('.hero'));

document.querySelectorAll('[data-sigil]').forEach((fig) => fig.insertAdjacentHTML('afterbegin', sigilSVG(fig.dataset.sigil)));

const restoreText = setupRuneText();

const button = document.querySelector('.reality');
const buttonText = button.querySelector('.reality-text');
const themeMeta = document.querySelector('meta[name="theme-color"]');
function applyMode() {
  root.dataset.mode = dream ? 'dream' : 'day';
  button.setAttribute('aria-pressed', String(dream));
  buttonText.textContent = dream ? 'wake up' : 'reality check';
  themeMeta.content = (dream ? PALETTE.dream : PALETTE.day).theme;
}
applyMode();
button.addEventListener('click', () => {
  dream = !dream;
  root.classList.add('switching');
  setTimeout(() => root.classList.remove('switching'), 1300);
  applyMode();
  field.setMode(dream);
  if (!dream) restoreText();
  try { localStorage.setItem('mode', dream ? 'dream' : 'day'); } catch {}
});

const io = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); }
  }
}, { threshold: 0.15, rootMargin: '0px 0px -5% 0px' });
document.querySelectorAll('.reveal').forEach((el) => io.observe(el));

const clock = document.getElementById('clock');
const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Copenhagen', hour: '2-digit', minute: '2-digit' });
const tick = () => { clock.textContent = fmt.format(new Date()); };
tick();
setInterval(tick, 15000);
