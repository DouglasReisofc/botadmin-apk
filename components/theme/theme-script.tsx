import { THEME_STORAGE_KEY, DEFAULT_THEME } from "./theme-types";

/** Script síncrono no <head> para evitar flash de tema errado. */
export const themeBootstrapScript = `
(function(){
  try {
    var key = ${JSON.stringify(THEME_STORAGE_KEY)};
    var stored = localStorage.getItem(key);
    var theme = (stored === 'dark' || stored === 'clean') ? stored : ${JSON.stringify(DEFAULT_THEME)};
    var root = document.documentElement;
    root.setAttribute('data-theme', theme);
    root.setAttribute('data-bs-theme', theme === 'dark' ? 'dark' : 'light');
    root.style.colorScheme = theme === 'dark' ? 'dark' : 'light';
  } catch (e) {}
})();
`;
