import { Trophy, ShieldAlert, Scale, Handshake } from 'lucide-react';
import './WinnerBanner.css';

export default function WinnerBanner({ verdictData }) {
  if (!verdictData || !verdictData.winner) return null;

  const winner = verdictData.winner; // 'Prosecutor' | 'Defender' | 'Tie'
  const reason = verdictData.reason || 'The trial has reached an authoritative determination based on validated unit tests.';

  const getWinnerConfig = () => {
    switch (winner.toLowerCase()) {
      case 'prosecutor':
        return {
          title: 'Prosecutor Wins',
          icon: ShieldAlert,
          colorVar: '--prosecutor',
          bgVar: '--prosecutor-soft',
          badgeText: 'Prosecution Upheld',
        };
      case 'defender':
        return {
          title: 'Defender Wins',
          icon: Scale,
          colorVar: '--defender',
          bgVar: '--defender-soft',
          badgeText: 'Defense Upheld',
        };
      default:
        return {
          title: "It's a Tie",
          icon: Handshake,
          colorVar: '--judge',
          bgVar: '--judge-soft',
          badgeText: 'Equally Sound Patches',
        };
    }
  };

  const config = getWinnerConfig();
  const Icon = config.icon;

  return (
    <div
      className={`verdict-winner-banner banner-${winner.toLowerCase()}`}
      style={{
        '--winner-color': `var(${config.colorVar})`,
        '--winner-bg': `var(${config.bgVar})`,
      }}
    >
      {/* CSS celebration sparkles */}
      <div className="celebration-sparkles" aria-hidden="true">
        <span className="sparkle s1">✦</span>
        <span className="sparkle s2">✧</span>
        <span className="sparkle s3">✦</span>
        <span className="sparkle s4">✧</span>
      </div>

      <div className="winner-content-wrap">
        <div className="winner-icon-bubble">
          <Icon size={28} className="winner-main-icon" />
          <Trophy size={16} className="trophy-badge-icon" />
        </div>

        <div className="winner-text-block">
          <div className="winner-eyebrow-row">
            <span className="winner-eyebrow-badge">{config.badgeText}</span>
            <span className="official-ruling-tag">Official Court Ruling</span>
          </div>

          <h2 className="winner-headline">{config.title}</h2>
          <p className="winner-reason-text">{reason}</p>
        </div>
      </div>
    </div>
  );
}
