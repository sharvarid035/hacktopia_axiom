import { useTheme } from '../hooks/useTheme';
import './LogoMotion.css';

export default function LogoMotion({ variant = 'full', size = 'default', className = '' }) {
  const { isDark } = useTheme();

  // Pick logo based on theme and variant
  let src = '';
  if (variant === 'full') {
    src = isDark ? '/logo/logo-for-dark-mode.png' : '/logo/logo-for-light-mode.png';
  } else {
    src = isDark ? '/logo/logo-mark-for-dark-mode.png' : '/logo/logo-mark-for-light-mode.png';
  }

  if (variant === 'mark-only') {
    return (
      <div className={`logo-mark-wrapper size-${size} ${className}`}>
        <img
          src={src}
          alt="Verdict AI Mark"
          className="logo-mark-img"
        />
      </div>
    );
  }

  return (
    <div className={`logo-motion-container size-${size} ${className}`}>
      {/* Soft pulsing glow behind */}
      <div className="logo-pulse-glow" aria-hidden="true" />
      
      {/* Floating logo image */}
      <div className="logo-floating-wrapper animate-float">
        <div className="logo-shimmer-wrap">
          <img
            src={src}
            alt="Verdict AI Logo"
            className="logo-full-img"
          />
          <div className="logo-shimmer-overlay" aria-hidden="true" />
        </div>
      </div>
    </div>
  );
}
