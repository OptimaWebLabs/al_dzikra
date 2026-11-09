(function () {
  'use strict';

  const PREFS_KEY = 'al_dzikra_prefs_v3';

  let categoriesData = [];
  let activeScreen = 'beranda'; // 'beranda' | 'reader' | 'pengaturan' | 'tentang'
  let activeCategoryId = 'dzikir-pagi';

  let prefs = {
    themeMode: 'dark', // 'system' | 'light' | 'dark'
    arabicSp: 30
  };

  // DOM Elements
  const screens = {
    beranda: document.getElementById('screen-beranda'),
    reader: document.getElementById('screen-reader'),
    pengaturan: document.getElementById('screen-pengaturan'),
    tentang: document.getElementById('screen-tentang')
  };

  const navButtons = document.querySelectorAll('[data-nav-target]');
  const readerCategoryTitle = document.getElementById('readerCategoryTitle');
  const readerCategorySubtitle = document.getElementById('readerCategorySubtitle');
  const dzikirItemsList = document.getElementById('dzikirItemsList');
  const btnBackToHome = document.getElementById('btnBackToHome');
  const fontSizeSlider = document.getElementById('fontSizeSlider');
  const fontSizeLabel = document.getElementById('fontSizeLabel');
  const themeRadios = document.querySelectorAll('input[name="themeMode"]');

  function loadPrefs() {
    try {
      const raw = localStorage.getItem(PREFS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        prefs = Object.assign({}, prefs, parsed);
      }
    } catch (_) {}
    applyPrefs();
  }

  function savePrefs() {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch (_) {}
  }

  function resolveEffectiveTheme() {
    if (prefs.themeMode === 'system') {
      const isDark =
        window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      return isDark ? 'dark' : 'light';
    }
    return prefs.themeMode === 'light' ? 'light' : 'dark';
  }

  function applyPrefs() {
    const effectiveTheme = resolveEffectiveTheme();
    document.documentElement.setAttribute('data-theme', effectiveTheme);

    // Apply Arabic font size (sp -> px)
    const sp = Number(prefs.arabicSp) || 30;
    document.documentElement.style.setProperty('--arabic-sp', sp + 'px');
    if (fontSizeSlider) fontSizeSlider.value = String(sp);
    if (fontSizeLabel) fontSizeLabel.textContent = `Ukuran Teks Arab: ${sp} sp`;

    // Sync radio buttons
    themeRadios.forEach((radio) => {
      radio.checked = radio.value === prefs.themeMode;
    });
  }

  function switchScreen(screenName, pushHistory = true) {
    activeScreen = screenName;
    Object.keys(screens).forEach((key) => {
      if (screens[key]) {
        screens[key].classList.toggle('active', key === screenName);
      }
    });

    // Highlight bottom nav (Reader belongs under Beranda tab)
    const navKey = screenName === 'reader' ? 'beranda' : screenName;
    navButtons.forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-nav-target') === navKey);
    });

    window.scrollTo({ top: 0, behavior: 'instant' });

    if (pushHistory && window.history && window.history.pushState) {
      window.history.pushState({ screen: screenName, categoryId: activeCategoryId }, '');
    }
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function openCategory(categoryId) {
    activeCategoryId = categoryId;
    const cat = categoriesData.find((c) => c.id === categoryId) || categoriesData[0];
    if (!cat) return;

    readerCategoryTitle.textContent = cat.category;
    readerCategorySubtitle.textContent = cat.subtitle || `${cat.items.length} Item Dzikir`;

    dzikirItemsList.innerHTML = cat.items
      .map((item) => {
        const arabicHtml = item.arabic
          .map((line) => `<p class="arabic-text" dir="rtl">${escapeHtml(line)}</p>`)
          .join('');
        const translationHtml = item.translation
          .map((line) => `<p class="dzikir-translation">${escapeHtml(line)}</p>`)
          .join('');

        return `
          <article class="dzikir-item-card">
            <div class="dzikir-item-top">
              <h2 class="dzikir-item-title">${item.id}. ${escapeHtml(item.title)}</h2>
              <span class="dzikir-item-rep">${escapeHtml(item.repetition)}</span>
            </div>
            ${arabicHtml}
            ${translationHtml}
          </article>
        `;
      })
      .join('');

    switchScreen('reader');
  }

  // Event Listeners
  document.addEventListener('click', (e) => {
    const catBtn = e.target.closest('[data-open-category]');
    if (catBtn) {
      openCategory(catBtn.getAttribute('data-open-category'));
      return;
    }

    const navBtn = e.target.closest('[data-nav-target]');
    if (navBtn) {
      const target = navBtn.getAttribute('data-nav-target');
      switchScreen(target);
      return;
    }
  });

  if (btnBackToHome) {
    btnBackToHome.addEventListener('click', () => {
      switchScreen('beranda');
    });
  }

  // Handle hardware/browser Back button
  window.addEventListener('popstate', (e) => {
    if (e.state && e.state.screen) {
      if (e.state.screen === 'reader' && e.state.categoryId) {
        activeCategoryId = e.state.categoryId;
      }
      switchScreen(e.state.screen, false);
    } else if (activeScreen !== 'beranda') {
      switchScreen('beranda', false);
    }
  });

  // Font size slider
  if (fontSizeSlider) {
    fontSizeSlider.addEventListener('input', (e) => {
      prefs.arabicSp = Number(e.target.value);
      applyPrefs();
      savePrefs();
    });
  }

  // Theme radio buttons
  themeRadios.forEach((radio) => {
    radio.addEventListener('change', (e) => {
      if (e.target.checked) {
        prefs.themeMode = e.target.value;
        applyPrefs();
        savePrefs();
      }
    });
  });

  // Watch system color scheme if in 'system' mode
  if (window.matchMedia) {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    if (mq.addEventListener) {
      mq.addEventListener('change', () => {
        if (prefs.themeMode === 'system') applyPrefs();
      });
    }
  }

  // Register Service Worker
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    });
  }

  // Initialize
  async function init() {
    loadPrefs();
    try {
      const res = await fetch('./data/dzikir.json');
      categoriesData = await res.json();

      const params = new URLSearchParams(window.location.search);
      const catParam = params.get('category');
      if (catParam && categoriesData.some((c) => c.id === catParam)) {
        openCategory(catParam);
      }
    } catch (_) {}
  }

  init();
})();
