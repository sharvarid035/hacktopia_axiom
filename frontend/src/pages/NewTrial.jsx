import { useRef } from 'react';
import { ArrowRight, RotateCcw, AlertCircle, RefreshCw, ShieldAlert, Scale, Gavel } from 'lucide-react';
import Stepper from '../components/Stepper';
import AgentCard from '../components/AgentCard';
import TestTable from '../components/TestTable';
import WinnerBanner from '../components/WinnerBanner';
import { PRELOADED_EXAMPLES } from '../hooks/useSwarmStream';
import './NewTrial.css';

export default function NewTrial({ swarmState }) {
  const {
    code,
    setCode,
    selectedExample,
    selectExample,
    isRunning,
    isDone,
    statusText,
    errorMessage,
    setErrorMessage,
    currentStage,
    elapsedTime,
    prosecutorText,
    prosecutorStatus,
    defenderText,
    defenderStatus,
    judgeText,
    judgeStatus,
    testData,
    verdictData,
    runSwarm,
    resetTrial,
  } = swarmState;

  // Track if we have entered the trial view (either running, completed, or with agent output)
  const isTrialActive = isRunning || isDone || prosecutorText || defenderText || judgeText || currentStage > 0;

  const textareaRef = useRef(null);
  const lineNumbersRef = useRef(null);

  // Handle Tab key in code editor
  const handleKeyDown = (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const textarea = textareaRef.current;
      if (!textarea) return;

      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const spaces = '    '; // 4 spaces

      const newCode = code.substring(0, start) + spaces + code.substring(end);
      setCode(newCode);

      // Restore cursor position after state update
      setTimeout(() => {
        textarea.selectionStart = textarea.selectionEnd = start + spaces.length;
      }, 0);
    }
  };

  // Sync scrolling between line numbers and textarea
  const handleScroll = () => {
    if (textareaRef.current && lineNumbersRef.current) {
      lineNumbersRef.current.scrollTop = textareaRef.current.scrollTop;
    }
  };

  const lineCount = Math.max(8, code.split('\n').length);

  return (
    <div className="new-trial-page">
      {/* Top Header / Eyebrow */}
      <div className="trial-header-block">
        <div className="eyebrow-pill">
          <span>AI-ASSISTED CODE ADJUDICATION</span>
        </div>
        <div className="trial-title-action-row">
          <div>
            <h1 className="trial-heading">
              Bring your code. <span className="headline-italic">We'll call the witnesses.</span>
            </h1>
            <p className="trial-subheading">
              The Prosecutor uncovers bugs, the Defender challenges with edge cases, and the Judge verifies patches in an isolated sandbox.
            </p>
          </div>

          {/* New Trial Reset button when trial is active */}
          {isTrialActive && (
            <button
              type="button"
              className="btn-ghost new-trial-reset-btn"
              onClick={resetTrial}
              disabled={isRunning}
            >
              <RotateCcw size={16} />
              <span>New Trial</span>
            </button>
          )}
        </div>
      </div>

      {/* Dismissible Error Alert */}
      {errorMessage && (
        <div className="trial-error-alert" role="alert">
          <div className="alert-content">
            <AlertCircle className="alert-icon" size={20} />
            <div className="alert-text-group">
              <strong className="alert-title">Adjudication Error</strong>
              <p className="alert-message">{errorMessage}</p>
            </div>
          </div>
          <div className="alert-actions">
            <button
              type="button"
              className="btn-secondary retry-btn"
              onClick={runSwarm}
              disabled={isRunning}
            >
              <RefreshCw size={14} />
              <span>Retry</span>
            </button>
            <button
              type="button"
              className="alert-dismiss-btn"
              onClick={() => setErrorMessage('')}
              aria-label="Dismiss error"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Petition Card (Editor View) - shown before running or when reset */}
      {!isTrialActive && (
        <>
          <div className="petition-card card-surface">
            {/* Card Header */}
            <div className="petition-card-header">
              <div className="petition-header-left">
                <span className="petition-card-title">Petition for review</span>
                <span className="petition-tagline">Submit code for multi-agent adversarial examination</span>
              </div>

              <div className="petition-header-right">
                <span className="python-version-tag">Python 3.12</span>
                <div className="example-dropdown-wrap">
                  <label htmlFor="example-select" className="sr-only">
                    Load preloaded example:
                  </label>
                  <select
                    id="example-select"
                    className="example-select"
                    value={selectedExample}
                    onChange={(e) => selectExample(e.target.value)}
                    disabled={isRunning}
                  >
                    {PRELOADED_EXAMPLES.map((ex) => (
                      <option key={ex.id} value={ex.id}>
                        {ex.title}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* Code Editor Area */}
            <div className="petition-editor-wrapper">
              <div
                ref={lineNumbersRef}
                className="petition-line-numbers"
                aria-hidden="true"
              >
                {Array.from({ length: lineCount }).map((_, i) => (
                  <span key={i}>{i + 1}</span>
                ))}
              </div>
              <textarea
                ref={textareaRef}
                id="petition-code-editor"
                className="petition-textarea"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                onKeyDown={handleKeyDown}
                onScroll={handleScroll}
                disabled={isRunning}
                placeholder="# Paste your Python code here..."
                rows={lineCount}
                spellCheck="false"
              />
            </div>

            {/* Card Footer with Convene CTA */}
            <div className="petition-card-footer">
              <div className="petition-hint">
                <span className="hint-bullet">●</span>
                <span>The court automatically synthesizes pytest harnesses without requiring manual test cases.</span>
              </div>

              <button
                type="button"
                className="btn-primary convene-cta-btn"
                onClick={runSwarm}
                disabled={isRunning || !code.trim()}
              >
                <span>Convene the court</span>
                <ArrowRight size={17} />
              </button>
            </div>
          </div>

          {/* Three Agent Perspectives Ribbon */}
          <div className="perspectives-row">
            <span className="perspectives-label">Three perspectives. One clear verdict.</span>
            <div className="perspective-chips">
              <div className="perspective-chip prosecutor">
                <ShieldAlert size={14} />
                <span>Prosecutor</span>
              </div>
              <span className="perspective-sep">→</span>
              <div className="perspective-chip defender">
                <Scale size={14} />
                <span>Defender</span>
              </div>
              <span className="perspective-sep">→</span>
              <div className="perspective-chip judge">
                <Gavel size={14} />
                <span>Judge</span>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Trial View (Live Results) */}
      {isTrialActive && (
        <div className="trial-live-view">
          {/* Horizontal Stepper & Timer */}
          <Stepper
            currentStep={currentStage}
            statusText={statusText}
            isRunning={isRunning}
            isDone={isDone}
            elapsedTime={elapsedTime}
          />

          {/* 3 Agent Cards Grid */}
          <div className="agent-cards-grid">
            {/* Prosecutor Card */}
            <AgentCard
              type="prosecutor"
              name="Prosecutor"
              tagline="Flaw Discovery & Accusation"
              text={prosecutorText}
              status={prosecutorStatus}
              isActive={currentStage === 1 && isRunning}
              isStreaming={prosecutorStatus === 'speaking'}
            />

            {/* Defender Card */}
            <AgentCard
              type="defender"
              name="Defender"
              tagline="Challenge & Edge-Case Testing"
              text={defenderText}
              status={defenderStatus}
              isActive={currentStage === 2 && isRunning}
              isStreaming={defenderStatus === 'speaking'}
            />

            {/* Judge Card */}
            <AgentCard
              type="judge"
              name="Judge"
              tagline="Sandbox Adjudication & Verdict"
              text={judgeText}
              status={judgeStatus}
              isActive={currentStage === 3 && isRunning}
              isStreaming={judgeStatus === 'speaking'}
            />
          </div>

          {/* Prominent Winner Banner */}
          {verdictData && <WinnerBanner verdictData={verdictData} />}

          {/* Sandbox Test Results Matrix */}
          {testData && <TestTable testData={testData} />}
        </div>
      )}
    </div>
  );
}
