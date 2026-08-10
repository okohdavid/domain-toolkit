// ============================================================
// Domain Toolkit — shared behavior (theme + mobile nav)
// ============================================================

(function () {
  const root = document.documentElement;
  const THEME_KEY = 'dt-theme';

  function applyTheme(theme) {
    root.setAttribute('data-theme', theme);
    document.querySelectorAll('[data-theme-icon]').forEach((btn) => {
      btn.innerHTML = theme === 'light' ? ICONS.moon : ICONS.sun;
    });
  }

  const ICONS = {
    sun: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
    moon: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z"/></svg>'
  };

  function initTheme() {
    const saved = localStorage.getItem(THEME_KEY) ||
      (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
    applyTheme(saved);

    document.querySelectorAll('[data-theme-icon]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const next = root.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
        localStorage.setItem(THEME_KEY, next);
        applyTheme(next);
      });
    });
  }

  function initMobileNav() {
    const toggle = document.querySelector('[data-sidebar-toggle]');
    const sidebar = document.querySelector('.sidebar');
    const backdrop = document.querySelector('.sidebar-backdrop');
    if (!toggle || !sidebar) return;

    function close() {
      sidebar.classList.remove('open');
      backdrop && backdrop.classList.remove('open');
    }
    toggle.addEventListener('click', () => {
      sidebar.classList.toggle('open');
      backdrop && backdrop.classList.toggle('open');
    });
    backdrop && backdrop.addEventListener('click', close);
    sidebar.querySelectorAll('a').forEach((a) => a.addEventListener('click', close));
  }

  document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    initMobileNav();
  });
})();
