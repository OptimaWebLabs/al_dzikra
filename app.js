(function () {
  'use strict';

  const STORAGE_KEY_COUNTS = 'al_dzikra_counts_v1';
  const STORAGE_KEY_PREFS = 'al_dzikra_prefs_v1';

  let categoriesData = [];
  let activeCategoryId = 'dzikir-pagi';
  let viewMode = 'list'; // 'list' | 'focus'
  let sholatMode = 'subuh'; // 'subuh' | 'maghrib' | 'umum'
  let focusIndex = 0;
  let searchQuery = '';
  let deferredInstallPrompt = null;
  let audioCtx = null;

  let countsState = {};
  let prefs = {
    theme: 'light',
    fontScale: 1.85, // rem
    showTranslation: true,
    autoAdvance: true,
    soundVibrate: true,
    optionalTenChoice: {} // key -> 1 or 10 for "1x atau 10x"
  };

  // DOM References
  const dzikirContainer = document.getElementById('dzikirContainer');
  const activeCategoryTitle = document.getElementById('activeCategoryTitle');
  const activeCategorySubtitle = document.getElementById('activeCategorySubtitle');
  const timeRecommendationText = document.getElementById('timeRecommendationText');
  const progressSummaryText = document.getElementById('progressSummaryText');
  const progressBarFill = document.getElementById('progressBarFill');
  const sholatTimeFilter = document.getElementById('sholatTimeFilter');
  const searchBarWrap = document.getElementById('searchBarWrap');
  const searchInput = document.getElementById('searchInput');
  const btnThemeToggle = document.getElementById('btnThemeToggle');
  const btnResetProgress = document.getElementById('btnResetProgress');
  const btnSettings = document.getElementById('btnSettings');
  const btnInstallApp = document.getElementById('btnInstallApp');
  const nativeInstallBanner = document.getElementById('nativeInstallBanner');
  const btnTriggerNativeInstall = document.getElementById('btnTriggerNativeInstall');
  const toastEl = document.getElementById('toast');

  // Load saved state
  function loadState() {
    try {
      const savedCounts = localStorage.getItem(STORAGE_KEY_COUNTS);
      if (savedCounts) countsState = JSON.parse(savedCounts);
    } catch (_) {}

    try {
      const savedPrefs = localStorage.getItem(STORAGE_KEY_PREFS);
      if (savedPrefs) {
        prefs = Object.assign({}, prefs, JSON.parse(savedPrefs));
      } else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
        prefs.theme = 'dark';
      }
    } catch (_) {}

    applyPrefs();
  }

  function saveCounts() {
    try {
      localStorage.setItem(STORAGE_KEY_COUNTS, JSON.stringify(countsState));
    } catch (_) {}
  }

  function savePrefs() {
    try {
      localStorage.setItem(STORAGE_KEY_PREFS, JSON.stringify(prefs));
    } catch (_) {}
  }

  function applyPrefs() {
    document.documentElement.setAttribute('data-theme', prefs.theme);
    btnThemeToggle.textContent = prefs.theme === 'dark' ? '☀️' : '🌙';
    document.documentElement.style.setProperty('--arabic-font-size', prefs.fontScale + 'rem');

    const chkShowTranslation = document.getElementById('chkShowTranslation');
    const chkAutoAdvance = document.getElementById('chkAutoAdvance');
    const chkSoundVibrate = document.getElementById('chkSoundVibrate');

    if (chkShowTranslation) chkShowTranslation.checked = prefs.showTranslation;
    if (chkAutoAdvance) chkAutoAdvance.checked = prefs.autoAdvance;
    if (chkSoundVibrate) chkSoundVibrate.checked = prefs.soundVibrate;
  }

  // Soft synthesized click/chime via Web Audio API
  function playFeedback(isCompleted) {
    if (!prefs.soundVibrate) return;

    if (navigator.vibrate) {
      navigator.vibrate(isCompleted ? [35, 50, 65] : 15);
    }

    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return;
      if (!audioCtx) audioCtx = new AudioContextClass();
      if (audioCtx.state === 'suspended') audioCtx.resume();

      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(audioCtx.destination);

      const now = audioCtx.currentTime;
      if (isCompleted) {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(523.25, now); // C5
        osc.frequency.setValueAtTime(659.25, now + 0.08); // E5
        gain.gain.setValueAtTime(0.08, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.24);
        osc.start(now);
        osc.stop(now + 0.24);
      } else {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(320, now);
        gain.gain.setValueAtTime(0.04, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.045);
        osc.start(now);
        osc.stop(now + 0.045);
      }
    } catch (_) {}
  }

  // Parse repetition string into target integer based on category & sholatMode
  function getTargetCount(categoryId, item) {
    const rep = (item.repetition || '1x').trim();
    const key = categoryId + '_' + item.id;

    if (rep === '1x atau 10x') {
      return prefs.optionalTenChoice[key] || 10;
    }

    if (categoryId === 'dzikir-sholat') {
      if (rep.includes('Maghrib') && rep.includes('Subuh')) {
        if (sholatMode === 'subuh') {
          const m = rep.match(/Subuh\s+(\d+)x/i);
          return m ? parseInt(m[1], 10) : 3;
        }
        return 1;
      }
      if (rep.toLowerCase().startsWith('subuh')) {
        return 1;
      }
    }

    const match = rep.match(/(\d+)\s*x/i);
    return match ? parseInt(match[1], 10) : 1;
  }

  function getItemCount(categoryId, itemId) {
    const key = categoryId + '_' + itemId;
    return countsState[key] || 0;
  }

  function setItemCount(categoryId, itemId, val) {
    const key = categoryId + '_' + itemId;
    countsState[key] = val;
    saveCounts();
  }

  function getActiveCategory() {
    return categoriesData.find((c) => c.id === activeCategoryId) || categoriesData[0];
  }

  // Time-of-day smart recommendation
  function initTimeRecommendation() {
    const hour = new Date().getHours();
    const urlParams = new URLSearchParams(window.location.search);
    const requestedCat = urlParams.get('category');

    if (requestedCat && ['dzikir-pagi', 'dzikir-petang', 'dzikir-sholat'].includes(requestedCat)) {
      activeCategoryId = requestedCat;
    } else if (hour >= 15 && hour < 20) {
      activeCategoryId = 'dzikir-petang';
    } else if (hour >= 4 && hour < 11) {
      activeCategoryId = 'dzikir-pagi';
    }

    if (hour >= 4 && hour < 11) {
      timeRecommendationText.textContent = 'Waktu Utama: Dzikir Pagi';
    } else if (hour >= 15 && hour < 19) {
      timeRecommendationText.textContent = 'Waktu Utama: Dzikir Petang';
    } else {
      timeRecommendationText.textContent = 'Senantiasa Basahi Lisan dengan Dzikir';
    }
  }

  function updateHeaderAndProgress() {
    const cat = getActiveCategory();
    if (!cat) return;

    activeCategoryTitle.textContent = cat.category;
    activeCategorySubtitle.textContent = cat.subtitle;

    // Update category tabs active state
    document.querySelectorAll('.category-tab').forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-category') === cat.id);
    });

    // Show/hide sholat time filter
    sholatTimeFilter.style.display = cat.id === 'dzikir-sholat' ? 'flex' : 'none';
    searchBarWrap.style.display = viewMode === 'list' ? 'flex' : 'none';

    // Calculate progress
    let completedItems = 0;
    cat.items.forEach((item) => {
      const target = getTargetCount(cat.id, item);
      const current = getItemCount(cat.id, item.id);
      if (current >= target) completedItems++;
    });

    const total = cat.items.length;
    const pct = total > 0 ? Math.round((completedItems / total) * 100) : 0;
    progressSummaryText.textContent = `Progres Selesai: ${completedItems} / ${total} (${pct}%)`;
    progressBarFill.style.width = `${pct}%`;
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function renderArabicParagraphs(arabicArray) {
    return arabicArray
      .map((line) => {
        const isBismillah =
          line.includes('بِسْمِ اللّٰهِ الرَّحْمٰنِ الرَّحِيْمِ') && arabicArray.length > 1;
        return `<p class="arabic-paragraph ${isBismillah ? 'arabic-bismillah' : ''}">${escapeHtml(line)}</p>`;
      })
      .join('');
  }

  function renderTranslationParagraphs(translationArray) {
    if (!prefs.showTranslation) return '';
    const inner = translationArray
      .map((line) => `<p class="translation-paragraph">${escapeHtml(line)}</p>`)
      .join('');
    return `<div class="translation-container">${inner}</div>`;
  }

  function render() {
    const cat = getActiveCategory();
    if (!cat) return;

    updateHeaderAndProgress();

    if (viewMode === 'focus') {
      renderFocusMode(cat);
    } else {
      renderListMode(cat);
    }
  }

  function renderListMode(cat) {
    const query = searchQuery.trim().toLowerCase();
    const filtered = cat.items.filter((item) => {
      if (!query) return true;
      const inTitle = item.title.toLowerCase().includes(query);
      const inTrans = item.translation.some((t) => t.toLowerCase().includes(query));
      return inTitle || inTrans;
    });

    if (filtered.length === 0) {
      dzikirContainer.innerHTML = `
        <div class="dzikir-card" style="text-align: center; padding: 2rem;">
          <p style="color: var(--text-muted);">Tidak ditemukan bacaan dzikir dengan kata kunci "${escapeHtml(searchQuery)}".</p>
        </div>
      `;
      return;
    }

    dzikirContainer.innerHTML = filtered
      .map((item) => {
        const target = getTargetCount(cat.id, item);
        const current = getItemCount(cat.id, item.id);
        const isDone = current >= target;
        const optKey = cat.id + '_' + item.id;
        const hasOptionalTen = item.repetition === '1x atau 10x';

        return `
          <article id="card-${cat.id}-${item.id}" class="dzikir-card ${isDone ? 'completed' : ''}">
            <div class="card-header">
              <div class="card-title-group">
                <span class="dzikir-number">${isDone ? '✓' : item.id}</span>
                <div>
                  <h2 class="card-title">${escapeHtml(item.title)}</h2>
                </div>
              </div>
              <div class="card-badges">
                ${
                  hasOptionalTen
                    ? `<button type="button" class="tool-btn" data-toggle-ten="${optKey}" title="Ubah target 1x atau 10x">Target: ${target}x ⇄</button>`
                    : ''
                }
                <span class="repetition-badge">Dibaca ${escapeHtml(item.repetition)}</span>
              </div>
            </div>

            <div class="arabic-container">
              ${renderArabicParagraphs(item.arabic)}
            </div>

            ${renderTranslationParagraphs(item.translation)}

            <div class="card-footer">
              <div class="card-tools">
                <button type="button" class="tool-btn" data-reset-item="${item.id}" title="Ulangi hitungan dzikir ini">
                  ↺ Reset
                </button>
                <button type="button" class="tool-btn" data-copy-item="${item.id}" title="Salin teks Arab & Terjemahan">
                  📋 Salin
                </button>
              </div>

              <button type="button" class="tasbih-btn ${isDone ? 'done' : ''}" data-tap-item="${item.id}">
                <span>${isDone ? '✓ Selesai Dibaca' : '📿 Ketuk Hitung Dzikir'}</span>
                <span class="tasbih-count-pill">${current} / ${target}</span>
              </button>
            </div>
          </article>
        `;
      })
      .join('');
  }

  function renderFocusMode(cat) {
    if (focusIndex < 0) focusIndex = 0;
    if (focusIndex >= cat.items.length) focusIndex = cat.items.length - 1;

    const item = cat.items[focusIndex];
    const target = getTargetCount(cat.id, item);
    const current = getItemCount(cat.id, item.id);
    const isDone = current >= target;
    const optKey = cat.id + '_' + item.id;
    const hasOptionalTen = item.repetition === '1x atau 10x';

    dzikirContainer.innerHTML = `
      <div class="focus-view">
        <div class="focus-nav">
          <button type="button" class="icon-btn" id="btnFocusPrev" ${focusIndex === 0 ? 'disabled style="opacity:0.45;cursor:not-allowed;"' : ''}>
            ← Sebelumnya
          </button>
          <span style="font-size: 0.85rem; font-weight: 700; color: var(--text-secondary);">
            Bacaan ${focusIndex + 1} dari ${cat.items.length}
          </span>
          <button type="button" class="icon-btn" id="btnFocusNext" ${focusIndex === cat.items.length - 1 ? 'disabled style="opacity:0.45;cursor:not-allowed;"' : ''}>
            Berikutnya →
          </button>
        </div>

        <article class="dzikir-card ${isDone ? 'completed' : ''}">
          <div class="card-header">
            <div class="card-title-group">
              <span class="dzikir-number">${isDone ? '✓' : item.id}</span>
              <h2 class="card-title">${escapeHtml(item.title)}</h2>
            </div>
            <div class="card-badges">
              ${
                hasOptionalTen
                  ? `<button type="button" class="tool-btn" data-toggle-ten="${optKey}">Target: ${target}x ⇄</button>`
                  : ''
              }
              <span class="repetition-badge">Dibaca ${escapeHtml(item.repetition)}</span>
            </div>
          </div>

          <div class="arabic-container">
            ${renderArabicParagraphs(item.arabic)}
          </div>

          ${renderTranslationParagraphs(item.translation)}

          <div class="focus-Tap-Pad" data-tap-item="${item.id}" role="button" tabindex="0" aria-label="Ketuk untuk menghitung dzikir">
            <div class="focus-ring-count">${current} / ${target}</div>
            <div class="focus-tap-hint">
              ${isDone ? '✓ Target Tercapai — Ketuk untuk lanjut / tambah' : '📿 Ketuk di area ini atau tekan Spasi untuk menghitung'}
            </div>
          </div>

          <div class="card-footer" style="margin-top: 0.75rem;">
            <div class="card-tools">
              <button type="button" class="tool-btn" data-reset-item="${item.id}">↺ Reset Hitungan</button>
              <button type="button" class="tool-btn" data-copy-item="${item.id}">📋 Salin Doa</button>
            </div>
          </div>
        </article>
      </div>
    `;

    const btnPrev = document.getElementById('btnFocusPrev');
    const btnNext = document.getElementById('btnFocusNext');
    if (btnPrev) {
      btnPrev.addEventListener('click', () => {
        if (focusIndex > 0) {
          focusIndex--;
          render();
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }
      });
    }
    if (btnNext) {
      btnNext.addEventListener('click', () => {
        if (focusIndex < cat.items.length - 1) {
          focusIndex++;
          render();
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }
      });
    }
  }

  function handleTapItem(itemId) {
    const cat = getActiveCategory();
    if (!cat) return;
    const item = cat.items.find((i) => i.id === Number(itemId));
    if (!item) return;

    const target = getTargetCount(cat.id, item);
    const prevCount = getItemCount(cat.id, item.id);
    const nextCount = prevCount + 1;
    const justCompleted = prevCount < target && nextCount >= target;

    setItemCount(cat.id, item.id, nextCount);
    playFeedback(justCompleted);
    render();

    if (justCompleted) {
      // Check if entire category is completed
      const allDone = cat.items.every((it) => getItemCount(cat.id, it.id) >= getTargetCount(cat.id, it));
      if (allDone) {
        showToast(`Alhamdulillah! Seluruh ${cat.category} telah selesai dibaca.`);
      }

      if (prefs.autoAdvance) {
        if (viewMode === 'focus') {
          if (focusIndex < cat.items.length - 1) {
            setTimeout(() => {
              focusIndex++;
              render();
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }, 350);
          }
        } else {
          // Scroll smoothly to next card in list mode
          const nextItem = cat.items.find((i) => i.id === item.id + 1);
          if (nextItem) {
            setTimeout(() => {
              const nextEl = document.getElementById(`card-${cat.id}-${nextItem.id}`);
              if (nextEl) {
                nextEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
              }
            }, 280);
          }
        }
      }
    }
  }

  function showToast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(showToast._timer);
    showToast._timer = setTimeout(() => {
      toastEl.classList.remove('show');
    }, 2800);
  }

  // Event Listeners
  document.addEventListener('click', (e) => {
    const tapBtn = e.target.closest('[data-tap-item]');
    if (tapBtn) {
      handleTapItem(tapBtn.getAttribute('data-tap-item'));
      return;
    }

    const resetBtn = e.target.closest('[data-reset-item]');
    if (resetBtn) {
      const itemId = Number(resetBtn.getAttribute('data-reset-item'));
      const cat = getActiveCategory();
      setItemCount(cat.id, itemId, 0);
      render();
      showToast('Hitungan dzikir direset ke 0');
      return;
    }

    const copyBtn = e.target.closest('[data-copy-item]');
    if (copyBtn) {
      const itemId = Number(copyBtn.getAttribute('data-copy-item'));
      const cat = getActiveCategory();
      const item = cat.items.find((i) => i.id === itemId);
      if (item && navigator.clipboard) {
        const text = `${item.title} (${item.repetition})\n\n${item.arabic.join('\n')}\n\nArti:\n${item.translation.join('\n')}\n\n— Al-Dzikra`;
        navigator.clipboard.writeText(text).then(() => {
          showToast('Teks dzikir berhasil disalin!');
        });
      }
      return;
    }

    const toggleTenBtn = e.target.closest('[data-toggle-ten]');
    if (toggleTenBtn) {
      const key = toggleTenBtn.getAttribute('data-toggle-ten');
      const currentTarget = prefs.optionalTenChoice[key] || 10;
      prefs.optionalTenChoice[key] = currentTarget === 10 ? 1 : 10;
      savePrefs();
      render();
      showToast(`Target diubah menjadi ${prefs.optionalTenChoice[key]}x`);
      return;
    }

    const catTab = e.target.closest('[data-category]');
    if (catTab) {
      activeCategoryId = catTab.getAttribute('data-category');
      focusIndex = 0;
      render();
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    const viewBtn = e.target.closest('[data-view-mode]');
    if (viewBtn) {
      viewMode = viewBtn.getAttribute('data-view-mode');
      document.querySelectorAll('[data-view-mode]').forEach((b) => {
        b.classList.toggle('active', b.getAttribute('data-view-mode') === viewMode);
      });
      render();
      return;
    }

    const sholatBtn = e.target.closest('[data-sholat-mode]');
    if (sholatBtn) {
      sholatMode = sholatBtn.getAttribute('data-sholat-mode');
      document.querySelectorAll('[data-sholat-mode]').forEach((b) => {
        b.classList.toggle('active', b.getAttribute('data-sholat-mode') === sholatMode);
      });
      render();
      return;
    }

    const closeModalBtn = e.target.closest('[data-close-modal]');
    if (closeModalBtn) {
      const modalId = closeModalBtn.getAttribute('data-close-modal');
      document.getElementById(modalId).classList.remove('open');
      return;
    }

    if (e.target.classList.contains('modal-backdrop')) {
      e.target.classList.remove('open');
    }
  });

  // Keyboard shortcuts for Desktop (Windows / Linux) in Focus Mode
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (viewMode === 'focus') {
      const cat = getActiveCategory();
      if (!cat) return;
      if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault();
        const item = cat.items[focusIndex];
        if (item) handleTapItem(item.id);
      } else if (e.code === 'ArrowRight') {
        if (focusIndex < cat.items.length - 1) {
          focusIndex++;
          render();
        }
      } else if (e.code === 'ArrowLeft') {
        if (focusIndex > 0) {
          focusIndex--;
          render();
        }
      }
    }
  });

  // Search filter
  searchInput.addEventListener('input', (e) => {
    searchQuery = e.target.value;
    render();
  });

  // Theme toggle
  btnThemeToggle.addEventListener('click', () => {
    prefs.theme = prefs.theme === 'dark' ? 'light' : 'dark';
    applyPrefs();
    savePrefs();
  });

  // Reset category progress
  btnResetProgress.addEventListener('click', () => {
    const cat = getActiveCategory();
    if (!cat) return;
    cat.items.forEach((item) => {
      setItemCount(cat.id, item.id, 0);
    });
    focusIndex = 0;
    render();
    showToast(`Seluruh hitungan ${cat.category} direset ke 0.`);
  });

  // Settings Modal controls
  btnSettings.addEventListener('click', () => {
    document.getElementById('settingsModal').classList.add('open');
  });

  document.getElementById('btnFontMinus').addEventListener('click', () => {
    prefs.fontScale = Math.max(1.35, Number((prefs.fontScale - 0.15).toFixed(2)));
    applyPrefs();
    savePrefs();
  });

  document.getElementById('btnFontReset').addEventListener('click', () => {
    prefs.fontScale = 1.85;
    applyPrefs();
    savePrefs();
  });

  document.getElementById('btnFontPlus').addEventListener('click', () => {
    prefs.fontScale = Math.min(2.65, Number((prefs.fontScale + 0.15).toFixed(2)));
    applyPrefs();
    savePrefs();
  });

  document.getElementById('chkShowTranslation').addEventListener('change', (e) => {
    prefs.showTranslation = e.target.checked;
    savePrefs();
    render();
  });

  document.getElementById('chkAutoAdvance').addEventListener('change', (e) => {
    prefs.autoAdvance = e.target.checked;
    savePrefs();
  });

  document.getElementById('chkSoundVibrate').addEventListener('change', (e) => {
    prefs.soundVibrate = e.target.checked;
    savePrefs();
  });

  // PWA Install Handling (Android, iOS, Windows, Linux)
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    nativeInstallBanner.style.display = 'block';
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    nativeInstallBanner.style.display = 'none';
    showToast('Alhamdulillah, aplikasi Al-Dzikra berhasil diinstal!');
  });

  btnInstallApp.addEventListener('click', async () => {
    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      const { outcome } = await deferredInstallPrompt.userChoice;
      if (outcome === 'accepted') {
        deferredInstallPrompt = null;
        return;
      }
    }
    document.getElementById('installModal').classList.add('open');
  });

  btnTriggerNativeInstall.addEventListener('click', async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    const { outcome } = await deferredInstallPrompt.userChoice;
    if (outcome === 'accepted') {
      deferredInstallPrompt = null;
      document.getElementById('installModal').classList.remove('open');
    }
  });

  // Register Service Worker for Offline & Installability
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    });
  }

  // Initialize Data & Render
  async function init() {
    loadState();
    initTimeRecommendation();
    try {
      const res = await fetch('./data/dzikir.json');
      categoriesData = await res.json();
      render();
    } catch (err) {
      dzikirContainer.innerHTML = `<div class="dzikir-card"><p>Gagal memuat data dzikir. Pastikan koneksi aktif saat membuka pertama kali.</p></div>`;
    }
  }

  init();
})();

