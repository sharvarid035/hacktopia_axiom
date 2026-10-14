import { useState } from 'react';
import {
  ArrowRight,
  RotateCcw,
  AlertCircle,
  RefreshCw,
  Search,
  ShieldAlert,
  Scale,
  Gavel,
  ChevronDown,
  ChevronRight,
  GitBranch,
  Key,
} from 'lucide-react';
import Stepper from '../components/Stepper';
import AgentCard from '../components/AgentCard';
import TestTable from '../components/TestTable';
import WinnerBanner from '../components/WinnerBanner';
import CommitTimeline from '../components/CommitTimeline';
import { DEMO_REPO_URL, DEMO_REPO_URL_2 } from '../hooks/useRepoStream';
import './RepoAudit.css';

const REPO_STAGES = [
  { id: 1, name: 'Investigator', role: 'Triages Commits', icon: Search, colorVar: '--judge' },
  { id: 2, name: 'Prosecutor', role: 'Finds Flaws', icon: ShieldAlert, colorVar: '--prosecutor' },
  { id: 3, name: 'Defender', role: 'Tests Fixes', icon: Scale, colorVar: '--defender' },
  { id: 4, name: 'Judge', role: 'Adjudicates', icon: Gavel, colorVar: '--judge' },
];

export default function RepoAudit({ repoState }) {
  const {
    repoUrl,
    setRepoUrl,
    branch,
    setBranch,
    limit,
    setLimit,
    githubToken,
    setGithubToken,
    isRunning,
    isDone,
    statusText,
    errorMessage,
    setErrorMessage,
    currentStage,
    elapsedTime,
    repoName,
    commits,
    suspect,
    prosecutorText,
    prosecutorStatus,
    defenderText,
    defenderStatus,
    judgeText,
    judgeStatus,
    testData,
    verdictData,
    runRepoAudit,
    resetAudit,
  } = repoState;

  const [showAdvanced, setShowAdvanced] = useState(false);

  const isAuditActive =
    isRunning ||
    isDone ||
    commits.length > 0 ||
    suspect ||
    prosecutorText ||
    defenderText ||
    judgeText ||
    currentStage > 0;

  return (
    <div className="repo-audit-page">
      {/* Header */}
      <div className="audit-header-block">
        <div className="eyebrow-pill">
          <span>REPOSITORY AUDIT</span>
        </div>
        <div className="audit-title-action-row">
          <div>
            <h1 className="audit-heading">Put the whole repo on trial.</h1>
            <p className="audit-subheading">
              Paste a GitHub repository. We'll read its recent commits and CI results, find the likely culprit, and let the agents argue it out.
            </p>
          </div>

          {isAuditActive && (
            <button
              type="button"
              className="btn-ghost audit-reset-btn"
              onClick={resetAudit}
              disabled={isRunning}
            >
              <RotateCcw size={16} />
              <span>New Audit</span>
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
              <strong className="alert-title">Audit Interrupted</strong>
              <p className="alert-message">{errorMessage}</p>
            </div>
          </div>
          <div className="alert-actions">
            <button
              type="button"
              className="btn-secondary retry-btn"
              onClick={runRepoAudit}
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

      {/* Repository Input Card (Initial View) */}
      {!isAuditActive && (
        <>
          <div className="repo-input-card card-surface">
            <div className="repo-card-header">
              <span className="repo-card-title">Repository Investigation Dossier</span>
              <span className="repo-card-badge">GitHub API v2022-11-28</span>
            </div>

            <div className="repo-card-body">
              {/* Repo URL Input */}
              <div className="form-group">
                <label htmlFor="repo-url-input" className="form-label">
                  GitHub Repository URL <span className="required-star">*</span>
                </label>
                <div className="input-with-icon">
                  <input
                    id="repo-url-input"
                    type="url"
                    className="text-input"
                    placeholder="https://github.com/owner/repo"
                    value={repoUrl}
                    onChange={(e) => setRepoUrl(e.target.value)}
                    disabled={isRunning}
                    required
                  />
                </div>
              </div>

              {/* Quick Demo Chips */}
              <div className="demo-chips-row">
                <span className="demo-chips-label">Try a public repository:</span>
                <button
                  type="button"
                  className="demo-chip-btn"
                  onClick={() => {
                    setRepoUrl(DEMO_REPO_URL);
                    setBranch('main');
                  }}
                >
                  pallets/click
                </button>
                <button
                  type="button"
                  className="demo-chip-btn"
                  onClick={() => {
                    setRepoUrl(DEMO_REPO_URL_2);
                    setBranch('main');
                  }}
                >
                  psf/requests
                </button>
              </div>

              {/* Branch & Commits Count Row */}
              <div className="form-grid-row">
                <div className="form-group">
                  <label htmlFor="repo-branch-input" className="form-label">
                    Branch <span className="optional-tag">(Optional)</span>
                  </label>
                  <div className="input-with-icon">
                    <GitBranch size={16} className="field-icon" />
                    <input
                      id="repo-branch-input"
                      type="text"
                      className="text-input with-left-icon"
                      placeholder="e.g. main or feature/fix"
                      value={branch}
                      onChange={(e) => setBranch(e.target.value)}
                      disabled={isRunning}
                    />
                  </div>
                </div>

                <div className="form-group">
                  <label htmlFor="commits-limit-select" className="form-label">
                    Commits to analyse
                  </label>
                  <select
                    id="commits-limit-select"
                    className="select-input"
                    value={limit}
                    onChange={(e) => setLimit(Number(e.target.value))}
                    disabled={isRunning}
                  >
                    <option value={3}>3 recent commits</option>
                    <option value={5}>5 recent commits (Default)</option>
                    <option value={10}>10 recent commits (Max)</option>
                  </select>
                </div>
              </div>

              {/* Collapsed Advanced Section for GitHub Token */}
              <div className="advanced-accordion">
                <button
                  type="button"
                  className="advanced-toggle-btn"
                  onClick={() => setShowAdvanced(!showAdvanced)}
                  aria-expanded={showAdvanced}
                >
                  <div className="toggle-left">
                    {showAdvanced ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    <Key size={15} />
                    <span>Advanced: GitHub Personal Access Token</span>
                  </div>
                  <span className="toggle-hint">For private repos or higher rate limits</span>
                </button>

                {showAdvanced && (
                  <div className="advanced-panel">
                    <div className="form-group">
                      <label htmlFor="github-token-input" className="form-label">
                        GitHub Token (Optional)
                      </label>
                      <input
                        id="github-token-input"
                        type="password"
                        className="text-input"
                        placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                        value={githubToken}
                        onChange={(e) => setGithubToken(e.target.value)}
                        disabled={isRunning}
                        autoComplete="off"
                      />
                      <p className="field-help-text">
                        Used only for this request, never stored. Required if analyzing private repositories or if IP rate limits are reached.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Footer with Submit Button */}
            <div className="repo-card-footer">
              <div className="audit-guarantee">
                <span className="bullet-dot">●</span>
                <span>The repo is never cloned or executed outside the isolated sandbox.</span>
              </div>

              <button
                type="button"
                className="btn-primary open-case-btn"
                onClick={runRepoAudit}
                disabled={isRunning || !repoUrl.trim()}
              >
                <span>Open the case</span>
                <ArrowRight size={17} />
              </button>
            </div>
          </div>
        </>
      )}

      {/* Live Audit Results View */}
      {isAuditActive && (
        <div className="audit-live-results">
          {/* Stepper with Investigator stage */}
          <Stepper
            currentStep={currentStage}
            statusText={statusText}
            isRunning={isRunning}
            isDone={isDone}
            elapsedTime={elapsedTime}
            stages={REPO_STAGES}
          />

          {/* Commit Timeline & Suspect Callout */}
          <CommitTimeline commits={commits} repo={repoName} suspect={suspect} />

          {/* Three Agent Cards Grid */}
          <div className="agent-cards-grid">
            <AgentCard
              type="prosecutor"
              name="Prosecutor"
              tagline="Flaw Discovery & Accusation"
              text={prosecutorText}
              status={prosecutorStatus}
              isActive={currentStage === 2 && isRunning}
              isStreaming={prosecutorStatus === 'speaking'}
            />

            <AgentCard
              type="defender"
              name="Defender"
              tagline="Challenge & Edge-Case Testing"
              text={defenderText}
              status={defenderStatus}
              isActive={currentStage === 3 && isRunning}
              isStreaming={defenderStatus === 'speaking'}
            />

            <AgentCard
              type="judge"
              name="Judge"
              tagline="Sandbox Adjudication & Verdict"
              text={judgeText}
              status={judgeStatus}
              isActive={currentStage === 4 && isRunning}
              isStreaming={judgeStatus === 'speaking'}
            />
          </div>

          {/* Winner Banner */}
          {verdictData && <WinnerBanner verdictData={verdictData} />}

          {/* Sandbox Test Matrix Table */}
          {testData && <TestTable testData={testData} />}
        </div>
      )}
    </div>
  );
}
