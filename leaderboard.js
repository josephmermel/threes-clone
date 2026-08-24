// Shared personal-best + global-leaderboard module for the Threes! family
// (classic square, hex, wheel). Same plain-<script>/global-object style as
// threes-common.js - no bundler, no modules. Depends on firebase-config.js
// (for FIREBASE_CONFIG) and, when that's non-null, the Firebase compat SDK
// <script> tags having already loaded - see each game's own <script> tags,
// all three of which load in that order right before this file.
(function (global) {
  const PERSONAL_BEST_PREFIX = 'threes-personal-best-';
  const SAVED_NAME_KEY = 'threes-leaderboard-name';
  const TOP_N = 10;

  // --- Firebase setup - entirely optional. FIREBASE_CONFIG is null until a
  // real project exists (see firebase-config.js); init also just as easily
  // fails if the CDN scripts didn't load (offline, ad blocker, etc.) - either
  // way `db` stays null and every function below degrades to a local-only
  // no-op instead of throwing, so the game itself never breaks on this.
  let db = null;
  try {
    if (typeof FIREBASE_CONFIG !== 'undefined' && FIREBASE_CONFIG && typeof firebase !== 'undefined') {
      firebase.initializeApp(FIREBASE_CONFIG);
      db = firebase.firestore();
    }
  } catch (err) {
    db = null;
  }
  function isEnabled() { return db != null; }

  // --- Personal best (localStorage, always available regardless of Firebase) ---
  function getPersonalBest(variant) {
    try {
      const raw = localStorage.getItem(PERSONAL_BEST_PREFIX + variant);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (typeof parsed.score !== 'number' || typeof parsed.highestTile !== 'number') return null;
      return parsed;
    } catch (err) {
      return null;
    }
  }
  // Saves {score, highestTile} as the new best if score beats the existing
  // one (or there isn't one yet); returns whether this call actually set a
  // new best, so the caller can show a "new best" badge.
  function maybeUpdatePersonalBest(variant, score, highestTile) {
    const current = getPersonalBest(variant);
    if (current && current.score >= score) return false;
    try {
      localStorage.setItem(PERSONAL_BEST_PREFIX + variant, JSON.stringify({ score, highestTile }));
    } catch (err) { /* storage unavailable (private browsing, quota) - best effort only */ }
    return true;
  }

  function getSavedName() {
    try { return localStorage.getItem(SAVED_NAME_KEY) || ''; } catch (err) { return ''; }
  }
  function saveName(name) {
    try { localStorage.setItem(SAVED_NAME_KEY, name); } catch (err) { /* best effort */ }
  }

  // --- Global leaderboard (Firestore) ---
  function submitScore(variant, name, score, highestTile) {
    if (!db) return Promise.resolve(false);
    return db.collection('scores').add({
      variant, name,
      score: Math.round(score),
      highestTile: Math.round(highestTile),
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    }).then(() => true).catch(() => false);
  }
  function fetchTopScores(variant, limitN) {
    if (!db) return Promise.resolve([]);
    return db.collection('scores')
      .where('variant', '==', variant)
      .orderBy('score', 'desc')
      .limit(limitN || TOP_N)
      .get()
      .then(snap => snap.docs.map(d => d.data()))
      .catch(() => []);
  }

  // --- Shared panel rendering ---
  function sanitizeName(raw) {
    return raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  }

  function renderScoreList(listEl, scores) {
    if (!isEnabled()) {
      listEl.innerHTML = '<li class="lb-empty">Global leaderboard unavailable</li>';
      return;
    }
    if (scores.length === 0) {
      listEl.innerHTML = '<li class="lb-empty">No scores yet - be the first!</li>';
      return;
    }
    listEl.innerHTML = scores.map((s, i) => `
      <li class="lb-row">
        <span class="lb-rank">${i + 1}</span>
        <span class="lb-name">${escapeHtml(s.name)}</span>
        <span class="lb-tile">${s.highestTile}</span>
        <span class="lb-points">${s.score.toLocaleString()}</span>
      </li>`).join('');
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function personalBestLine(variant) {
    const best = getPersonalBest(variant);
    if (!best) return 'No personal best yet';
    return `Personal best: ${best.score.toLocaleString()} (highest tile ${best.highestTile})`;
  }

  // Builds the game-over panel: this game's score/highest tile, a "new best"
  // badge when applicable, a 6-character name entry for the global board
  // (old-school arcade style), and the live top-10 list underneath.
  function showGameOverPanel(containerEl, { variant, score, highestTile }) {
    const isNewBest = maybeUpdatePersonalBest(variant, score, highestTile);
    const savedName = getSavedName() || 'PLAYER';
    containerEl.innerHTML = `
      <div class="leaderboard-panel">
        <div class="lb-summary">
          <div class="lb-stat"><span class="lb-stat-value">${Math.round(score).toLocaleString()}</span><span class="lb-stat-label">Score</span></div>
          <div class="lb-stat"><span class="lb-stat-value">${highestTile}</span><span class="lb-stat-label">Highest Tile</span></div>
        </div>
        ${isNewBest ? '<div class="lb-new-best">New personal best!</div>' : ''}
        <div class="lb-personal-best">${personalBestLine(variant)}</div>
        <form class="lb-name-form">
          <input class="lb-name-input" maxlength="6" autocomplete="off" autocapitalize="characters" value="${escapeHtml(savedName)}" aria-label="Your name (up to 6 characters)">
          <button type="submit" class="game-btn lb-submit-btn">Submit</button>
        </form>
        <div class="lb-submit-status"></div>
        <div class="lb-list-title">Top Scores</div>
        <ol class="lb-list"><li class="lb-empty">Loading...</li></ol>
      </div>`;

    const nameInput = containerEl.querySelector('.lb-name-input');
    const form = containerEl.querySelector('.lb-name-form');
    const status = containerEl.querySelector('.lb-submit-status');
    const listEl = containerEl.querySelector('.lb-list');

    nameInput.addEventListener('input', () => {
      const cursor = nameInput.selectionStart;
      nameInput.value = sanitizeName(nameInput.value);
      nameInput.setSelectionRange(cursor, cursor);
    });

    function refreshList() {
      fetchTopScores(variant, TOP_N).then(scores => renderScoreList(listEl, scores));
    }
    refreshList();

    if (!isEnabled()) {
      form.querySelector('.lb-submit-btn').disabled = true;
      status.textContent = 'Global leaderboard unavailable';
    }

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = sanitizeName(nameInput.value) || 'PLAYER';
      nameInput.value = name;
      saveName(name);
      if (!isEnabled()) return;
      const btn = form.querySelector('.lb-submit-btn');
      btn.disabled = true;
      nameInput.disabled = true;
      status.textContent = 'Saving...';
      submitScore(variant, name, score, highestTile).then(ok => {
        status.textContent = ok ? 'Saved!' : 'Could not save - try again later';
        btn.disabled = false;
        nameInput.disabled = false;
        if (ok) refreshList();
      });
    });
  }

  // Builds the standalone "just look at the scores" panel (opened any time
  // via a header button, not just after losing) - same list and personal
  // best, but its own Close button instead of a name-entry/submit flow.
  function showViewerPanel(containerEl, variant, onClose) {
    containerEl.innerHTML = `
      <div class="leaderboard-panel">
        <div class="lb-personal-best">${personalBestLine(variant)}</div>
        <div class="lb-list-title">Top Scores</div>
        <ol class="lb-list"><li class="lb-empty">Loading...</li></ol>
        <button class="game-btn lb-close-btn">Close</button>
      </div>`;

    const listEl = containerEl.querySelector('.lb-list');
    fetchTopScores(variant, TOP_N).then(scores => renderScoreList(listEl, scores));
    containerEl.querySelector('.lb-close-btn').addEventListener('click', () => {
      containerEl.innerHTML = '';
      if (onClose) onClose();
    });
  }

  global.Leaderboard = {
    isEnabled,
    getPersonalBest, maybeUpdatePersonalBest,
    getSavedName, saveName,
    submitScore, fetchTopScores,
    showGameOverPanel, showViewerPanel,
  };
})(window);
