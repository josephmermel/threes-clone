// Shared rules, palette, and rendering helpers for the Threes-family games
// (the classic square-grid game and the hex variant). Exposed as window.ThreesCommon.
// Board-shape-specific code (grid layout, line/neighbor geometry, pixel positioning,
// input handling) lives in each game's own HTML file.
(function (global) {
  // The viewport meta tag (maximum-scale=1, user-scalable=no) is the main defense
  // against iOS Safari zooming during fast touch play, but it isn't always fully
  // honored. Belt and suspenders: block the multi-touch gesture directly, and
  // (Safari-only) the non-standard gesture* events that actually drive pinch-zoom.
  document.addEventListener('touchmove', (e) => {
    if (e.touches.length > 1) e.preventDefault();
  }, { passive: false });
  ['gesturestart', 'gesturechange', 'gestureend'].forEach((type) => {
    document.addEventListener(type, (e) => e.preventDefault());
  });

  const WILD = 'W';

  function shuffledBag() {
    const bag = [1, 1, 2, 2, 3];
    for (let i = bag.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [bag[i], bag[j]] = [bag[j], bag[i]];
    }
    return bag;
  }

  function pickRandom(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  function cellKey(a, b) { return a + ',' + b; }
  function parseKey(key) { return key.split(',').map(Number); }

  function canMerge(a, b) {
    if (!a || !b) return false;
    if (a === WILD || b === WILD) return !(a === WILD && b === WILD);
    if ((a === 1 && b === 2) || (a === 2 && b === 1)) return true;
    return a === b && a >= 3;
  }

  // The value that would ordinarily merge with x (its own value for x>=3, its 1/2 counterpart otherwise).
  function partnerValue(x) {
    if (x === 1) return 2;
    if (x === 2) return 1;
    return x;
  }

  // Resulting value when a and b merge; a wildcard acts as whatever value completes the match.
  function mergeValue(a, b) {
    if (a === WILD) return b + partnerValue(b);
    if (b === WILD) return a + partnerValue(a);
    return a + b;
  }

  // Collapses one line (array of {id,value}|null, index0 = wall side) toward the wall,
  // in place. Each tile moves at most one slot; identical to how the original square
  // game always resolved a swipe. Returns { moved, merges: [{winnerId, loserId, ...}] }.
  function collapseLineWithIds(line) {
    let moved = false;
    const merges = [];
    for (let i = 0; i < line.length - 1; i++) {
      const a = line[i], b = line[i + 1];
      if (!a && b) {
        line[i] = b; line[i + 1] = null; moved = true;
      } else if (a && b && canMerge(a.value, b.value)) {
        const newValue = mergeValue(a.value, b.value);
        const winnerWasWild = a.value === WILD;
        const loserWasWild = b.value === WILD;
        // The number the wildcard stood in for, so its flip can reveal it.
        const revealValue = winnerWasWild ? partnerValue(b.value)
                           : loserWasWild ? partnerValue(a.value)
                           : null;
        merges.push({ winnerId: a.id, loserId: b.id, newValue, winnerWasWild, loserWasWild, revealValue });
        line[i] = { id: a.id, value: newValue };
        line[i + 1] = null;
        moved = true;
      }
    }
    return { moved, merges };
  }

  // Resolves an entire move, generic over board shape: grid is a Map<key,id>,
  // lines is an array of arrays of keys (each ordered wall -> far edge).
  function resolveMove(grid, tileValue, lines) {
    let anyMoved = false;
    const allMerges = [];
    const newEntries = [];
    for (const line of lines) {
      const slots = line.map(key => {
        const id = grid.get(key);
        return id ? { id, value: tileValue[id] } : null;
      });
      const { moved, merges } = collapseLineWithIds(slots);
      if (moved) anyMoved = true;
      allMerges.push(...merges);
      line.forEach((key, i) => newEntries.push([key, slots[i] ? slots[i].id : null]));
    }
    return { anyMoved, allMerges, newEntries };
  }

  // No empty cell anywhere, and no adjacent pair (per neighborPairs) can merge.
  function isGameOver(grid, tileValue, allKeys, neighborPairs) {
    for (const k of allKeys) if (!grid.get(k)) return false;
    for (const [k1, k2] of neighborPairs) {
      const id1 = grid.get(k1), id2 = grid.get(k2);
      if (id1 && id2 && canMerge(tileValue[id1], tileValue[id2])) return false;
    }
    return true;
  }

  // Static, overlapping triples along the doubling chain 6,12,24,48,96,... :
  // [6,12,24], [24,48,96], [96,192,384], ... each spanning a factor of 4,
  // consecutive triples sharing their boundary value. Returns every triple
  // (as [lo, mid, hi]) that contains v; junction values belong to two.
  function triplesContaining(v) {
    const n = Math.round(Math.log2(v / 3)); // v === 3 * 2^n
    const results = [];
    if (n % 2 === 1) results.push([v, v * 2, v * 4]);
    if (n % 2 === 0) results.push([v / 2, v, v * 2]);
    if (n % 2 === 1 && n >= 3) results.push([v / 4, v / 2, v]);
    return results;
  }

  function currentMaxValue(tileValue) {
    let max = 3;
    for (const id in tileValue) {
      const v = tileValue[id];
      if (v !== WILD && v > max) max = v;
    }
    return max;
  }

  // Same scoring curve the original Threes! uses: 1s and 2s are worth nothing
  // (they're not "real" tiles yet), and each step up the doubling chain from 3
  // is worth 3x the last one - 3, 9, 27, 81, 243, ... - rather than just the
  // tile's face value, so a few big merges are worth far more than a board
  // full of small ones. Live score is just this summed over every current
  // tile, not a separate running counter, so it can only reflect the board
  // that's actually there right now.
  function scoreForValue(v) {
    if (v === WILD || v < 3) return 0;
    const rank = Math.round(Math.log2(v / 3));
    return Math.pow(3, rank + 1);
  }

  function boardScore(tileValue) {
    let total = 0;
    for (const id in tileValue) total += scoreForValue(tileValue[id]);
    return total;
  }

  // A random tile from the doubling chain 6,12,24,..., capped at the board's
  // largest tile so far (so a bonus spawn can rise to meet it, never pass it).
  function randomBonusValue(maxVal) {
    const cap = Math.max(6, maxVal);
    const chain = [];
    for (let v = 6; v <= cap; v *= 2) chain.push(v);
    return pickRandom(chain);
  }

  // Hand-picked "candy" colors for 3, 6, 12, 24, ... (rank = log2(v/3)). Rather than
  // rainbow order (which put 3-4 shades of orange/yellow back to back and made
  // consecutive tiles hard to tell apart), this rotates through 8 distinct hue
  // families - red, green, blue, orange, purple, teal, pink, brown - so every
  // tile is a clear jump from its neighbor, then repeats the rotation with a
  // second variant per family. That also surfaces green/blue/purple/brown much
  // earlier instead of saving them for the high end. fg is picked per-swatch by
  // hand (checked against perceived luminance) instead of a hue-range rule.
  const CANDY_PALETTE = [
    { bg: '#ff3b30', fg: '#fff8ec' }, // Cherry Red      3
    { bg: '#34c759', fg: '#fff8ec' }, // Kelly Green     6
    { bg: '#3a86ff', fg: '#fff8ec' }, // Blueberry       12
    { bg: '#ff9500', fg: '#2b2410' }, // Tangerine       24
    { bg: '#9b5de5', fg: '#fff8ec' }, // Grape           48
    { bg: '#06d6a0', fg: '#fff8ec' }, // Spearmint       96
    { bg: '#f15bb5', fg: '#fff8ec' }, // Bubblegum       192
    { bg: '#a0673d', fg: '#fff8ec' }, // Caramel Brown   384
    { bg: '#ff6961', fg: '#fff8ec' }, // Coral           768
    { bg: '#c6e21e', fg: '#2b2410' }, // Lime            1536
    { bg: '#4cc9f0', fg: '#2b2410' }, // Sky Cyan        3072
    { bg: '#ffc145', fg: '#2b2410' }, // Marigold        6144
    { bg: '#c77dff', fg: '#2b2410' }, // Lavender        12288
    { bg: '#2ec4b6', fg: '#fff8ec' }, // Turquoise       24576
    { bg: '#ff2d78', fg: '#fff8ec' }, // Watermelon      49152
    { bg: '#6b2545', fg: '#fff8ec' }, // Plum            98304+
  ];

  function tileColor(v) {
    if (v === 1) return { bg: '#ffffff', fg: '#3a3a3a' };
    if (v === 2) return { bg: '#232323', fg: '#f2f2f2' };
    const rank = Math.min(Math.round(Math.log2(v / 3)), CANDY_PALETTE.length - 1);
    return CANDY_PALETTE[rank];
  }

  // Paints a normal numbered face, even mid-flip on a tile whose real value is still WILD.
  function paintNumeral(el, value) {
    el.classList.remove('wild');
    const { bg, fg } = tileColor(value);
    el.style.background = bg;
    el.style.color = fg;
    el.style.fontSize = value >= 100 ? '24px' : (value >= 1000 ? '20px' : '30px');
    el.textContent = value;
  }

  function paintTile(el, value) {
    if (value === WILD) {
      el.style.background = '';
      el.style.color = '#fff8ec';
      el.style.fontSize = '32px';
      el.textContent = '★';
      el.classList.add('wild');
      return;
    }
    paintNumeral(el, value);
  }

  function miniFontSize(value) {
    const len = String(value).length;
    if (len <= 1) return '15px';
    if (len === 2) return '14px';
    if (len === 3) return '12px';
    return '10px';
  }

  function makePreviewTile(value, mini) {
    const el = document.createElement('div');
    el.className = 'tile preview' + (mini ? ' mini' : '');
    paintTile(el, value);
    if (mini) el.style.fontSize = miniFontSize(value);
    return el;
  }

  // 1/2/3 and the wildcard always show plainly. Values > 3 show plainly (1 - tripleChance)
  // of the time and otherwise show one of the static triples containing that value, so the
  // true value shows up in a random slot instead of being given away.
  function renderNextIndicator(containerEl, nextValue, tripleChance) {
    containerEl.innerHTML = '';
    let triple = null;
    if (nextValue !== WILD && nextValue > 3 && Math.random() < tripleChance) {
      triple = pickRandom(triplesContaining(nextValue));
    }
    if (triple) {
      for (const v of triple) containerEl.appendChild(makePreviewTile(v, true));
    } else {
      containerEl.appendChild(makePreviewTile(nextValue, false));
    }
  }

  // The page starts plain white and only picks up color once the player has made
  // an actual match - starting tiles (even a lucky starting 6) don't count, only
  // merges do. From then on it follows the highest value produced by a merge so
  // far: that tile's own color laid over white at 50% opacity, so it stays a
  // clear, colorful hue rather than a dark muddy one, and shifts every time a
  // new high match is made. Pass the highest merged value so far, or a falsy
  // value (0/undefined) before the first match.
  function updatePageBackground(highestMatchValue) {
    if (!highestMatchValue) {
      document.documentElement.style.setProperty('--page-bg', '#ffffff');
      return;
    }
    const { bg: tileBg } = tileColor(highestMatchValue);
    document.documentElement.style.setProperty('--page-bg', `color-mix(in srgb, ${tileBg} 50%, white)`);
  }

  // A one-shot radial glow burst over a tile that just became a new game-high,
  // as a separate element so it never fights the tile's own box-shadow/filter.
  function spawnMilestoneGlow(tileEl, boardEl) {
    const glow = document.createElement('div');
    glow.className = 'milestone-glow';
    glow.style.left = tileEl.style.left;
    glow.style.top = tileEl.style.top;
    glow.style.width = tileEl.style.width || getComputedStyle(tileEl).width;
    glow.style.height = tileEl.style.height || getComputedStyle(tileEl).height;
    boardEl.appendChild(glow);
    setTimeout(() => glow.remove(), 650);
  }

  // Animates one move's result: losers slide into their winner's cell and fade/flip away,
  // survivors (incl. merge winners) glide to their new cell and pop/flip, and — only once
  // all of that has settled — the freshly spawned tile slides in from just beyond the
  // board edge, traveling in the same direction as the swipe (so it never competes for
  // attention with the slide/merge, and it's obvious which edge it came from, matching
  // the original game). Generic over board shape via the cellPos/createTileEl callbacks.
  //   elById: Map<id, DOM el>            tileValue: id -> value
  //   tilePos: id -> [a, b]              allMerges/loserFinalPos/spawnedId: from resolveMove + move()
  //   boardEl: container to append the spawned tile into
  //   cellPos(a, b): -> {left, top} in px
  //   createTileEl(value, a, b, spawning): -> new DOM el, already positioned
  //   spawnEnterFrom: optional {left, top} in px — where the spawned tile starts (just
  //     off the board edge) before sliding into its resting cell; omit for a plain
  //     appear-in-place (e.g. a board shape that hasn't computed one)
  //   milestoneIds: optional Set<id> of merge winners that just set a new game-high
  //     tile — these get a bigger pop plus a radial glow burst instead of the plain pop
  function animateMove(ctx) {
    const {
      elById, tileValue, tilePos, allMerges, loserFinalPos, spawnedId,
      boardEl, cellPos, createTileEl, milestoneIds, spawnEnterFrom,
      slideMs = 130, winnerFlipMs = 260, loserFlipMs = slideMs + 20,
      // Repainting a tile in place (a merge result, or a wildcard's flip-reveal)
      // needs the same scale-correction a freshly-created tile gets from the
      // caller's own createTileEl - otherwise a merged tile's font snaps back to
      // the unscaled base size while every other tile stays correctly scaled.
      // Callers should pass scale-aware wrappers; these bare functions are only
      // a fallback for scale === 1.
      paintTile: paintTileFn = paintTile, paintNumeral: paintNumeralFn = paintNumeral,
    } = ctx;
    const winnerMeta = new Map(allMerges.map(m => [m.winnerId, m]));

    // Losers slide into the winner's final spot, then fade out (or flip-reveal first).
    for (const m of allMerges) {
      const { loserId, loserWasWild, revealValue } = m;
      const el = elById.get(loserId);
      if (!el) continue;
      const [a, b] = loserFinalPos[loserId];
      const { left, top } = cellPos(a, b);
      el.style.zIndex = '1';
      el.style.left = left + 'px';
      el.style.top = top + 'px';

      if (loserWasWild) {
        el.classList.add('wild-loser-flip');
        setTimeout(() => paintNumeralFn(el, revealValue), Math.round(loserFlipMs * 0.5));
      } else {
        el.style.opacity = '0';
        el.style.transform = 'scale(0.4)';
      }
      setTimeout(() => {
        el.remove();
        elById.delete(loserId);
      }, loserFlipMs);
    }

    // Survivors (including merge winners) glide to their new cell.
    for (const idStr in tilePos) {
      const id = Number(idStr);
      if (id === spawnedId) continue;
      const el = elById.get(id);
      if (!el) continue;
      const [a, b] = tilePos[id];
      const { left, top } = cellPos(a, b);
      el.style.left = left + 'px';
      el.style.top = top + 'px';

      const meta = winnerMeta.get(id);
      if (meta && meta.winnerWasWild) {
        // Card-flip from wildcard to the resulting number as the merge lands.
        setTimeout(() => {
          el.classList.remove('merging');
          el.classList.add('wild-winner-flip');
          setTimeout(() => paintTileFn(el, meta.newValue), Math.round(winnerFlipMs * 0.5));
          setTimeout(() => el.classList.remove('wild-winner-flip'), winnerFlipMs);
        }, slideMs);
      } else if (meta) {
        const value = tileValue[id];
        const isMilestone = milestoneIds && milestoneIds.has(id);
        setTimeout(() => {
          paintTileFn(el, value);
          el.classList.remove('merging', 'milestone-pop');
          void el.offsetWidth;
          el.classList.add(isMilestone ? 'milestone-pop' : 'merging');
          if (isMilestone) spawnMilestoneGlow(el, boardEl);
        }, slideMs);
      }
    }

    // Only after the slide (and any merge fallout) has fully played does the new
    // tile appear, sliding in from just beyond the edge in the swipe's direction.
    if (spawnedId != null) {
      const spawnDelay = allMerges.length > 0 ? slideMs + winnerFlipMs : slideMs;
      setTimeout(() => {
        const [a, b] = tilePos[spawnedId];
        const el = createTileEl(tileValue[spawnedId], a, b, false);
        if (spawnEnterFrom) {
          const finalLeft = el.style.left, finalTop = el.style.top;
          el.style.transition = 'none';
          el.style.left = spawnEnterFrom.left + 'px';
          el.style.top = spawnEnterFrom.top + 'px';
          boardEl.appendChild(el);
          void el.offsetWidth; // force layout so the jump above isn't itself animated
          el.style.transition = '';
          el.style.left = finalLeft;
          el.style.top = finalTop;
        } else {
          boardEl.appendChild(el);
        }
        elById.set(spawnedId, el);
      }, spawnDelay);
    }
  }

  // Real-Threes-style drag: as the pointer moves, tiles slide a proportional
  // amount toward where the move would land (a live preview), with no game
  // state committed yet. Release past `commitFraction` of one cell's pitch and
  // the move completes; release short of it and everything glides back with
  // nothing changed. Works for mouse and touch alike via Pointer Events.
  //
  //   boardEl:  element to listen on
  //   isBlocked(): true while input should be ignored (e.g. game-over overlay up)
  //   pickDirection(dx, dy): raw drag vector -> a direction name (or null)
  //   pitchForDir(dir): px a tile travels for one full step in that direction
  //   unitForDir(dir): {x, y} unit vector for that direction on screen
  //   computeMoveResult(dir): pure preview of resolveMove — must return
  //     { anyMoved:false } or { anyMoved:true, newTilePos, loserFinalPos, ... }
  //     without mutating any real game state
  //   getTilePos(): current id -> [a,b] map (read fresh each call)
  //   getElById(): current id -> DOM element map (read fresh each call)
  //   cellPos(a, b): -> {left, top} in px
  //   getTileSize(): -> {width, height} in px of one tile (for the merge-overlay math)
  //   commit(dir): perform the real, state-mutating move
  //   commitFraction: fraction of the pitch that must be crossed to commit (default 0.5)
  //   deadzone: px of initial movement before a direction is locked in (default 10)
  //   overlayClass: extra class(es) added to the merge-preview overlay element, e.g.
  //     to reuse a board's tile-shape clip-path (optional)
  // hitAreaEl (defaults to boardEl) is what actually listens for the pointer
  // gesture - it can be a bigger container than the board itself (e.g. the
  // whole centered column around it, so a swipe anywhere in that blank space
  // still slides tiles, not just a swipe that starts exactly on a tile).
  // boardEl stays the anchor for the merge-preview overlay's own positioning,
  // since cellPos() returns coordinates relative to the board's own box
  // regardless of where the gesture happened to start.
  function attachDragControls(opts) {
    const {
      boardEl, hitAreaEl = opts.boardEl, isBlocked, pickDirection, pitchForDir, unitForDir,
      computeMoveResult, getTilePos, getElById, cellPos, getTileSize, commit,
      commitFraction = 0.5, deadzone = 10, overlayClass = '',
    } = opts;

    let drag = null; // { startX, startY, dir, preview, pitch, unit, t }

    function buildPreview(dir) {
      const result = computeMoveResult(dir);
      if (!result.anyMoved) return null;
      const tilePos = getTilePos();
      const elById = getElById();
      const tiles = {};
      for (const id in tilePos) {
        const el = elById.get(Number(id));
        if (!el) continue;
        const toRC = result.newTilePos[id] || result.loserFinalPos[id];
        if (!toRC) continue;
        tiles[id] = { el, from: cellPos(...tilePos[id]), to: cellPos(...toRC) };
        el.style.transition = 'none';
      }
      // One overlay per merge pair present in this preview: as the losing tile
      // slides toward its winner, this renders the pixels where they currently
      // overlap in the *result* tile's color (e.g. two 3s overlap in the 6 color).
      const overlays = [];
      for (const m of result.allMerges) {
        if (!tiles[m.winnerId] || !tiles[m.loserId]) continue;
        const el = document.createElement('div');
        el.className = ('merge-preview ' + overlayClass).trim();
        el.style.background = tileColor(m.newValue).bg;
        boardEl.appendChild(el);
        overlays.push({ winnerId: m.winnerId, loserId: m.loserId, el });
      }
      return { tiles, overlays };
    }

    function applyPreview(preview, t) {
      for (const id in preview.tiles) {
        const { el, from, to } = preview.tiles[id];
        el.style.left = (from.left + (to.left - from.left) * t) + 'px';
        el.style.top = (from.top + (to.top - from.top) * t) + 'px';
      }
      if (preview.overlays.length) {
        const { width, height } = getTileSize();
        for (const ov of preview.overlays) {
          const w = preview.tiles[ov.winnerId], l = preview.tiles[ov.loserId];
          const wLeft = w.from.left + (w.to.left - w.from.left) * t;
          const wTop = w.from.top + (w.to.top - w.from.top) * t;
          const lLeft = l.from.left + (l.to.left - l.from.left) * t;
          const lTop = l.from.top + (l.to.top - l.from.top) * t;
          const ix1 = Math.max(wLeft, lLeft), iy1 = Math.max(wTop, lTop);
          const ix2 = Math.min(wLeft + width, lLeft + width), iy2 = Math.min(wTop + height, lTop + height);
          if (ix2 > ix1 && iy2 > iy1) {
            ov.el.style.display = 'block';
            ov.el.style.left = ix1 + 'px';
            ov.el.style.top = iy1 + 'px';
            ov.el.style.width = (ix2 - ix1) + 'px';
            ov.el.style.height = (iy2 - iy1) + 'px';
          } else {
            ov.el.style.display = 'none';
          }
        }
      }
    }

    function removeOverlays(preview) {
      for (const ov of preview.overlays) ov.el.remove();
    }

    hitAreaEl.addEventListener('pointerdown', (e) => {
      if (isBlocked()) return;
      drag = { startX: e.clientX, startY: e.clientY, dir: null, preview: null, t: 0 };
      hitAreaEl.setPointerCapture(e.pointerId);
    });

    hitAreaEl.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.startX, dy = e.clientY - drag.startY;
      if (!drag.dir) {
        if (Math.hypot(dx, dy) < deadzone) return;
        drag.dir = pickDirection(dx, dy);
        drag.pitch = pitchForDir(drag.dir);
        drag.unit = unitForDir(drag.dir);
        drag.preview = buildPreview(drag.dir);
      }
      if (!drag.preview) return;
      const along = dx * drag.unit.x + dy * drag.unit.y;
      drag.t = Math.max(0, Math.min(1, along / drag.pitch));
      applyPreview(drag.preview, drag.t);
    });

    function finish() {
      if (!drag) return;
      const { dir, preview, t } = drag;
      drag = null;
      if (!preview) return;
      removeOverlays(preview);
      for (const id in preview.tiles) preview.tiles[id].el.style.transition = '';
      if (t >= commitFraction) {
        commit(dir);
      } else {
        for (const id in preview.tiles) {
          const { el, from } = preview.tiles[id];
          el.style.left = from.left + 'px';
          el.style.top = from.top + 'px';
        }
      }
    }
    hitAreaEl.addEventListener('pointerup', finish);
    hitAreaEl.addEventListener('pointercancel', finish);
  }

  // Wires a button to toggle fullscreen on the whole page, swapping its glyph
  // to reflect the current state. Silently no-ops if the browser refuses
  // (e.g. requires a user gesture, which a click already is, but just in case).
  function attachFullscreenToggle(btn) {
    if (!btn) return;
    btn.addEventListener('click', () => {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => {});
      } else {
        document.exitFullscreen().catch(() => {});
      }
    });
    document.addEventListener('fullscreenchange', () => {
      btn.textContent = document.fullscreenElement ? '⤢' : '⛶';
      btn.title = document.fullscreenElement ? 'Exit fullscreen' : 'Fullscreen';
    });
  }

  // Wires a trigger button to toggle a dropdown menu open/closed, closing it
  // on an outside click, an Escape press, or picking one of its links (a plain
  // navigation, so no explicit close handler needed there).
  function attachDropdownMenu(triggerBtn, menuEl) {
    function close() {
      menuEl.classList.remove('open');
      triggerBtn.setAttribute('aria-expanded', 'false');
    }
    triggerBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const opening = !menuEl.classList.contains('open');
      menuEl.classList.toggle('open', opening);
      triggerBtn.setAttribute('aria-expanded', String(opening));
    });
    document.addEventListener('click', (e) => {
      if (!menuEl.contains(e.target) && e.target !== triggerBtn) close();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') close();
    });
  }

  global.ThreesCommon = {
    WILD, shuffledBag, pickRandom, cellKey, parseKey,
    canMerge, partnerValue, mergeValue, collapseLineWithIds,
    resolveMove, isGameOver, triplesContaining,
    currentMaxValue, randomBonusValue, scoreForValue, boardScore,
    CANDY_PALETTE, tileColor, paintNumeral, paintTile,
    miniFontSize, makePreviewTile, renderNextIndicator, updatePageBackground,
    animateMove, attachDragControls, attachFullscreenToggle, attachDropdownMenu,
  };
})(window);
