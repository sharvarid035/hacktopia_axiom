import { ShieldAlert, Scale, Gavel, Cpu, CheckCircle2 } from 'lucide-react';
import './Agents.css';

export default function Agents() {
  const agents = [
    {
      id: 'prosecutor',
      name: 'Prosecutor',
      role: 'Finds the flaw',
      tagline: 'Code Bug Accusation & Vulnerability Discovery',
      icon: ShieldAlert,
      colorVar: '--prosecutor',
      softVar: '--prosecutor-soft',
      borderVar: '--prosecutor-border',
      description:
        'Scrutinizes submitted Python programs for genuine runtime defects, logic errors, and anti-patterns. Identifies failing inputs and drafts an immediate corrected implementation.',
      responsibilities: [
        'Discovers genuine runtime crashes & unhandled exceptions',
        'Provides a concrete failing input triggering the bug',
        'Generates an initial clean, working replacement patch',
      ],
      model: 'Gemini Flash',
      temperature: '0.3',
    },
    {
      id: 'defender',
      name: 'Defender',
      role: 'Tests the fix',
      tagline: 'Adversarial Edge-Case Stress Testing',
      icon: Scale,
      colorVar: '--defender',
      softVar: '--defender-soft',
      borderVar: '--defender-border',
      description:
        'Acts as devil\'s advocate against the Prosecutor\'s proposed patch. Stress tests the code against edge cases (empty inputs, zeroes, negatives, boundary extremes), deciding whether to CONCEDE or CHALLENGE with an improved patch.',
      responsibilities: [
        'Audits proposed fixes against rigorous boundary cases',
        'Issues formal CONCEDE or CHALLENGE rulings',
        'Supplies improved robust patches when edge cases fail',
      ],
      model: 'Gemini Flash',
      temperature: '0.3',
    },
    {
      id: 'judge',
      name: 'Judge',
      role: 'Scores the case',
      tagline: 'Sandbox Test Harness & Objective Adjudication',
      icon: Gavel,
      colorVar: '--judge',
      softVar: '--judge-soft',
      borderVar: '--judge-border',
      description:
        'Deduces program intent, synthesizes a comprehensive pytest suite, executes all candidates concurrently in an isolated containerized sandbox, and awards victory based on empirical pass rates.',
      responsibilities: [
        'Synthesizes validated pytest harnesses across input domains',
        'Executes sandbox runs in real isolated Python environments',
        'Calculates empirical winner based on verified test passing score',
      ],
      model: 'Gemini Flash',
      temperature: '0.0 (Deterministic)',
    },
  ];

  return (
    <div className="agents-page">
      {/* Page Header */}
      <div className="agents-header-block">
        <div className="eyebrow-pill">
          <span>THE REVIEW BENCH</span>
        </div>
        <h1 className="agents-heading">Meet your agents.</h1>
        <p className="agents-subheading">
          Three specialized AI models operating under structured adversarial checks and balances to reach undeniable consensus.
        </p>
      </div>

      {/* Agents 3 Cards Grid */}
      <div className="bench-cards-grid">
        {agents.map((agent) => {
          const Icon = agent.icon;
          return (
            <div
              key={agent.id}
              className={`bench-agent-card card-surface card-${agent.id}`}
              style={{
                '--agent-color': `var(${agent.colorVar})`,
                '--agent-soft': `var(${agent.softVar})`,
                '--agent-border': `var(${agent.borderVar})`,
              }}
            >
              <div className="bench-card-accent-bar" />

              <div className="bench-card-header">
                <div className="bench-header-left">
                  <div className="bench-icon-box">
                    <Icon size={22} />
                  </div>
                  <div className="bench-title-meta">
                    <h2 className="bench-agent-name">{agent.name}</h2>
                    <span className="bench-agent-role">{agent.role}</span>
                  </div>
                </div>

                <div className="badge-ready">
                  <span>Ready</span>
                </div>
              </div>

              <div className="bench-card-body">
                <p className="bench-description">{agent.description}</p>

                <div className="bench-responsibilities">
                  <span className="resp-title">Core Mandate</span>
                  <ul className="resp-list">
                    {agent.responsibilities.map((r, idx) => (
                      <li key={idx} className="resp-item">
                        <CheckCircle2 size={14} className="resp-check-icon" />
                        <span>{r}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              <div className="bench-card-footer">
                <div className="engine-meta">
                  <Cpu size={14} className="engine-icon" />
                  <span className="engine-text">Engine: {agent.model}</span>
                </div>
                <span className="temp-badge">Temp: {agent.temperature}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
