import { ShieldAlert, Scale, Gavel, Clock, CheckCircle2 } from 'lucide-react';
import './Stepper.css';

const DEFAULT_STEPS = [
  { id: 1, name: 'Prosecutor', role: 'Finds Flaws', icon: ShieldAlert, colorVar: '--prosecutor' },
  { id: 2, name: 'Defender', role: 'Tests Fixes', icon: Scale, colorVar: '--defender' },
  { id: 3, name: 'Judge', role: 'Adjudicates', icon: Gavel, colorVar: '--judge' },
];

export default function Stepper({
  currentStep,
  statusText,
  isRunning,
  isDone,
  elapsedTime,
  stages = DEFAULT_STEPS,
}) {
  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  return (
    <div className="stepper-container card-surface">
      <div className="stepper-track">
        {stages.map((s, idx) => {
          const Icon = s.icon;
          const isActive = currentStep === s.id;
          const isPassed = currentStep > s.id || isDone;

          return (
            <div key={s.id} className="stepper-item-wrap">
              <div
                className={`stepper-step ${isActive ? 'active' : ''} ${isPassed ? 'completed' : ''}`}
                style={{ '--step-color': `var(${s.colorVar})` }}
              >
                <div className="step-icon-circle">
                  {isPassed ? (
                    <CheckCircle2 size={18} className="step-check" />
                  ) : (
                    <Icon size={18} className="step-icon" />
                  )}
                  {isActive && <span className="step-pulse-ring" />}
                </div>

                <div className="step-label-group">
                  <div className="step-header-row">
                    <span className="step-number">Stage 0{s.id}</span>
                    <span className="step-name">{s.name}</span>
                  </div>
                  <span className="step-role">{s.role}</span>
                </div>
              </div>

              {idx < stages.length - 1 && (
                <div
                  className={`stepper-connector ${currentStep > s.id || isDone ? 'filled' : ''}`}
                />
              )}
            </div>
          );
        })}
      </div>

      <div className="stepper-status-bar">
        <div className="stepper-status-msg">
          <span className={`status-indicator-dot ${isRunning ? 'pulsing' : isDone ? 'done' : ''}`} />
          <span className="status-label">Status:</span>
          <span className="status-current-text">{statusText}</span>
        </div>

        <div className="stepper-timer-badge">
          <Clock size={15} />
          <span>{isDone ? 'Total Time:' : 'Elapsed:'} {formatTime(elapsedTime)}</span>
        </div>
      </div>
    </div>
  );
}
