import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Trash2,
  Clock,
  Calendar,
  ArrowRight,
  ShieldAlert,
  Scale,
  Handshake,
  Code,
  FolderGit2,
} from 'lucide-react';
import './History.css';

const HISTORY_STORAGE_KEY = 'verdict_ai_case_history';

export default function History({ swarmState, repoState }) {
  const [historyList, setHistoryList] = useState(() => {
    try {
      const stored = localStorage.getItem(HISTORY_STORAGE_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch (e) {
      console.warn('Failed to load trial history from localStorage:', e);
      return [];
    }
  });

  const navigate = useNavigate();

  const handleClearHistory = () => {
    try {
      localStorage.removeItem(HISTORY_STORAGE_KEY);
      setHistoryList([]);
    } catch (e) {
      console.warn('Failed to clear history:', e);
    }
  };

  const handleSelectTrial = (trial) => {
    if (trial.type === 'repo' && repoState?.loadPastAudit) {
      repoState.loadPastAudit(trial);
      navigate('/app/repo');
    } else if (swarmState?.loadPastTrial) {
      swarmState.loadPastTrial(trial);
      navigate('/app');
    }
  };

  const formatDate = (isoString) => {
    try {
      const d = new Date(isoString);
      return d.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return isoString || 'Unknown date';
    }
  };

  const getFirstCodeLine = (trial) => {
    if (trial.type === 'repo') {
      const suspectFile = trial.suspect?.file || 'Suspect file';
      const suspectSha = trial.suspect?.short_sha || '';
      return `${trial.repo || trial.repoUrl} — ${suspectFile} ${suspectSha ? `(${suspectSha})` : ''}`;
    }
    const code = trial.code;
    if (!code) return 'No code recorded';
    const lines = code.trim().split('\n');
    for (const l of lines) {
      const trimmed = l.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        return trimmed;
      }
    }
    return lines[0] || 'Empty program';
  };

  const renderWinnerBadge = (winner) => {
    const w = (winner || '').toLowerCase();
    if (w === 'prosecutor') {
      return (
        <span className="winner-history-badge prosecutor">
          <ShieldAlert size={12} />
          <span>Prosecutor</span>
        </span>
      );
    }
    if (w === 'defender') {
      return (
        <span className="winner-history-badge defender">
          <Scale size={12} />
          <span>Defender</span>
        </span>
      );
    }
    return (
      <span className="winner-history-badge tie">
        <Handshake size={12} />
        <span>Tie</span>
      </span>
    );
  };

  return (
    <div className="history-page">
      {/* Header */}
      <div className="history-header-block">
        <div>
          <div className="eyebrow-pill">
            <span>DOCKET ARCHIVE</span>
          </div>
          <h1 className="history-heading">Case history.</h1>
          <p className="history-subheading">
            Review past rulings, inspect code petitions, and reopen complete multi-agent deliberations.
          </p>
        </div>

        {historyList.length > 0 && (
          <button
            type="button"
            className="btn-ghost clear-history-btn"
            onClick={handleClearHistory}
          >
            <Trash2 size={15} />
            <span>Clear history</span>
          </button>
        )}
      </div>

      {/* History List or Friendly Empty State */}
      {historyList.length === 0 ? (
        <div className="history-empty-card card-surface">
          <div className="empty-icon-bubble">
            <Calendar size={28} className="empty-icon" />
          </div>
          <h2 className="empty-title">No trials conducted yet</h2>
          <p className="empty-subtext">
            Submit a code snippet or audit a GitHub repository to convene the court. Your case records and sandboxed verdicts will appear here automatically.
          </p>
          <button
            type="button"
            className="btn-primary"
            onClick={() => navigate('/app')}
          >
            <span>Convene your first trial</span>
            <ArrowRight size={16} />
          </button>
        </div>
      ) : (
        <div className="history-list">
          {historyList.map((trial) => {
            const isRepoAudit = trial.type === 'repo';

            return (
              <div
                key={trial.id}
                className={`history-card card-surface ${isRepoAudit ? 'is-repo-card' : ''}`}
                onClick={() => handleSelectTrial(trial)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    handleSelectTrial(trial);
                  }
                }}
              >
                <div className="history-card-main">
                  <div className="history-meta-row">
                    {isRepoAudit ? (
                      <span className="history-type-badge repo">
                        <FolderGit2 size={12} />
                        <span>Repo: {trial.repo || 'Repository'}</span>
                      </span>
                    ) : (
                      <span className="history-type-badge snippet">
                        <Code size={12} />
                        <span>Snippet</span>
                      </span>
                    )}

                    <div className="meta-timestamp">
                      <Calendar size={13} />
                      <span>{formatDate(trial.timestamp)}</span>
                    </div>
                    <div className="meta-duration">
                      <Clock size={13} />
                      <span>{trial.duration}s duration</span>
                    </div>
                    {renderWinnerBadge(trial.winner)}
                  </div>

                  <div className="history-code-preview">
                    {isRepoAudit ? (
                      <FolderGit2 size={15} className="code-icon repo-icon" />
                    ) : (
                      <Code size={15} className="code-icon" />
                    )}
                    <code className="code-snippet-line">{getFirstCodeLine(trial)}</code>
                  </div>
                </div>

                <div className="history-card-action">
                  <span className="reopen-label">
                    {isRepoAudit ? 'Reopen Audit' : 'Reopen Trial'}
                  </span>
                  <ArrowRight size={16} className="reopen-arrow" />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
