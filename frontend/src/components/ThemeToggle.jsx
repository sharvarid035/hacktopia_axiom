import { useTheme } from '../hooks/useTheme';
import { Sun, Moon } from 'lucide-react';
import './ThemeToggle.css';

export default function ThemeToggle({ className = '', showLabel = false }) {
  const { toggleTheme, isDark } = useTheme();

  return (
    <button
      type="button"
      className={`theme-toggle-btn ${className}`}
      onClick={toggleTheme}
      title={`Switch to ${isDark ? 'light' : 'dark'} mode`}
      aria-label={`Switch to ${isDark ? 'light' : 'dark'} mode`}
    >
      <div className="theme-toggle-icon-wrap">
        {isDark ? (
          <Sun className="theme-icon sun-icon" size={17} />
        ) : (
          <Moon className="theme-icon moon-icon" size={17} />
        )}
      </div>
      {showLabel && (
        <span className="theme-toggle-label">
          {isDark ? 'Light mode' : 'Dark mode'}
        </span>
      )}
    </button>
  );
}
