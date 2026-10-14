import { Link } from 'react-router-dom';
import { ArrowRight, ShieldAlert, Scale, Gavel } from 'lucide-react';
import LogoMotion from '../components/LogoMotion';
import ThemeToggle from '../components/ThemeToggle';
import './Landing.css';

export default function Landing() {
  const agentPreviewCards = [
    {
      type: 'prosecutor',
      name: 'Prosecutor',
      role: 'Finds the flaw & asserts bugs',
      icon: ShieldAlert,
      colorVar: '--prosecutor',
      bgVar: '--prosecutor-soft',
    },
    {
      type: 'defender',
      name: 'Defender',
      role: 'Tests edge cases & challenges fixes',
      icon: Scale,
      colorVar: '--defender',
      bgVar: '--defender-soft',
    },
    {
      type: 'judge',
      name: 'Judge',
      role: 'Synthesizes pytest harness & rules',
      icon: Gavel,
      colorVar: '--judge',
      bgVar: '--judge-soft',
    },
  ];

  return (
    <div className="landing-page bg-grid-pattern">
      {/* Minimal Top Navigation */}
      <header className="landing-topbar">
        <div className="landing-brand-tag">
          <span className="court-dot" />
          <span className="court-tag-text">Multi-Agent Code Review Court</span>
        </div>
        <div className="landing-top-actions">
          <ThemeToggle showLabel={false} />
          <Link to="/app" className="landing-launch-btn">
            <span>Enter App</span>
            <ArrowRight size={15} />
          </Link>
        </div>
      </header>

      {/* Main Hero Section */}
      <main className="landing-hero">
        {/* Centered Logo with Motion */}
        <div className="landing-logo-block">
          <LogoMotion variant="full" size="lg" />
        </div>

        {/* Headline & Subtitle */}
        <div className="landing-content-block">
          <div className="eyebrow-pill">
            <span>Autonomous Tri-Agent Review Bench</span>
          </div>

          <h1 className="landing-headline">
            Bring your code. <span className="headline-italic">We'll call the witnesses.</span>
          </h1>

          <p className="landing-subtitle">
            A three-agent review bench for finding bugs, testing assumptions, and reaching a verdict you can trust.
          </p>

          {/* Action Buttons */}
          <div className="landing-cta-row">
            <Link to="/app" className="btn-primary landing-main-cta">
              <span>Convene the court</span>
              <ArrowRight size={17} />
            </Link>
            <Link to="/app/agents" className="btn-ghost landing-secondary-cta">
              <span>Meet the agents</span>
            </Link>
          </div>
        </div>

        {/* 3 Small Agent Cards Row */}
        <div className="landing-agent-preview-row">
          {agentPreviewCards.map((agent, index) => {
            const Icon = agent.icon;
            return (
              <div
                key={agent.type}
                className="landing-agent-card card-surface"
                style={{
                  animationDelay: `${index * 120 + 200}ms`,
                  '--agent-color': `var(${agent.colorVar})`,
                  '--agent-bg': `var(${agent.bgVar})`,
                }}
              >
                <div className="preview-card-header">
                  <div className="preview-icon-box">
                    <Icon size={18} />
                  </div>
                  <span className="preview-agent-name">{agent.name}</span>
                </div>
                <p className="preview-agent-role">{agent.role}</p>
              </div>
            );
          })}
        </div>
      </main>

      {/* Minimal Footer */}
      <footer className="landing-footer">
        <p className="footer-credits">Built for Hacktopia</p>
      </footer>
    </div>
  );
}
