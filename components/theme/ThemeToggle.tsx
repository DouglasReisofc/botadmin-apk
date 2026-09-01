"use client";

import { useTheme } from "./ThemeProvider";

type ThemeToggleProps = {
  className?: string;
  compact?: boolean;
};

/** Ícones reais: sol (clean) e lua (dark). */
const SunIcon = ({ size = 18 }: { size?: number }) => (
  <svg
    viewBox="0 0 24 24"
    width={size}
    height={size}
    fill="none"
    stroke="currentColor"
    strokeWidth="1.9"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <circle cx="12" cy="12" r="4.2" fill="currentColor" stroke="none" />
    <path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2" />
    <path d="M5.1 5.1l1.55 1.55M17.35 17.35l1.55 1.55M18.9 5.1l-1.55 1.55M6.65 17.35l-1.55 1.55" />
  </svg>
);

const MoonIcon = ({ size = 18 }: { size?: number }) => (
  <svg
    viewBox="0 0 24 24"
    width={size}
    height={size}
    fill="currentColor"
    aria-hidden="true"
  >
    <path d="M20.2 14.35A8.35 8.35 0 0 1 9.65 3.8a.75.75 0 0 0-.9-.95A9.85 9.85 0 1 0 21.15 15.25a.75.75 0 0 0-.95-.9z" />
  </svg>
);

const ThemeToggle = ({ className = "", compact = false }: ThemeToggleProps) => {
  const { theme, toggleTheme, ready } = useTheme();
  const isDark = theme === "dark";

  return (
    <button
      type="button"
      className={`theme-toggle ${isDark ? "theme-toggle--dark" : "theme-toggle--clean"} ${compact ? "theme-toggle--compact" : ""} ${className}`.trim()}
      onClick={toggleTheme}
      aria-label={isDark ? "Ativar tema clean (sol)" : "Ativar tema dark (lua)"}
      title={isDark ? "Tema clean" : "Tema dark"}
      disabled={!ready}
    >
      <span className="theme-toggle__icon" aria-hidden="true">
        {/* No dark: mostra sol (para ir pro clean). No clean: mostra lua. */}
        {isDark ? <SunIcon /> : <MoonIcon />}
      </span>
      {!compact ? (
        <span className="theme-toggle__label">{isDark ? "Clean" : "Dark"}</span>
      ) : null}
    </button>
  );
};

export default ThemeToggle;
