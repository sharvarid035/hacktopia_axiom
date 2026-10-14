import { GitCommit, CheckCircle2, XCircle, Clock, AlertTriangle, FileCode, ShieldAlert } from 'lucide-react';
import './CommitTimeline.css';

export default function CommitTimeline({ commits = [], repo = '', suspect = null }) {
  if (!commits || commits.length === 0) return null;

  const formatCommitDate = (isoString) => {
    if (!isoString) return '';
    try {
      const date = new Date(isoString);
      return date.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
    } catch {
      return isoString || '';
    }
  };

  const renderCiBadge = (ciState) => {
    switch (ciState) {
      case 'passing':
        return (
          <span className="ci-badge passing">
            <CheckCircle2 size={13} />
            <span>Passing</span>
          </span>
        );
      case 'failing':
        return (
          <span className="ci-badge failing">
            <XCircle size={13} />
            <span>Failing</span>
          </span>
        );
      case 'pending':
        return (
          <span className="ci-badge pending">
            <Clock size={13} />
            <span>Pending</span>
          </span>
        );
      default:
        return (
          <span className="ci-badge none">
            <span className="ci-dash">—</span>
            <span>No CI</span>
          </span>
        );
    }
  };

  const renderConfidenceBadge = (confidence) => {
    const conf = (confidence || 'medium').toLowerCase();
    return (
      <span className={`confidence-badge ${conf}`}>
        <span>{conf.toUpperCase()} CONFIDENCE</span>
      </span>
    );
  };

  return (
    <div className="commit-timeline-section card-surface">
      <div className="timeline-header">
        <div className="timeline-title-row">
          <GitCommit size={18} className="timeline-icon" />
          <h3 className="timeline-title">Recent Commit Activity</h3>
          {repo && <span className="timeline-repo-badge">{repo}</span>}
        </div>
        <span className="timeline-subtitle">
          Audited {commits.length} commits & GitHub Actions check runs
        </span>
      </div>

      {/* Suspect Callout Card if suspect identified */}
      {suspect && (
        <div className="suspect-callout-card">
          <div className="suspect-callout-header">
            <div className="suspect-tag-group">
              <ShieldAlert size={16} className="suspect-alert-icon" />
              <span className="suspect-eyebrow">Investigator's Primary Suspect</span>
            </div>
            {renderConfidenceBadge(suspect.confidence)}
          </div>

          <div className="suspect-target-row">
            <div className="suspect-file-meta">
              <FileCode size={16} className="file-icon" />
              <span className="suspect-file-label">Suspect File:</span>
              <code className="suspect-file-name">{suspect.file}</code>
            </div>
            <div className="suspect-commit-meta">
              <span className="suspect-sha-label">Commit:</span>
              <code className="suspect-sha-code">{suspect.short_sha || suspect.sha?.slice(0, 7)}</code>
            </div>
          </div>

          <p className="suspect-reason-text">{suspect.reason}</p>

          {suspect.ci_error_summary && (
            <div className="suspect-ci-box">
              <div className="ci-box-title">
                <AlertTriangle size={13} />
                <span>CI Diagnostics / Failure Context</span>
              </div>
              <pre className="ci-box-code">
                <code>{suspect.ci_error_summary}</code>
              </pre>
            </div>
          )}
        </div>
      )}

      {/* Commits Vertical List */}
      <div className="commits-list">
        {commits.map((c, idx) => {
          const isSuspect = suspect && (suspect.sha === c.sha || suspect.short_sha === c.short_sha);

          return (
            <div
              key={c.sha}
              className={`commit-item-row ${isSuspect ? 'is-suspect-commit' : ''}`}
              style={{ animationDelay: `${idx * 120}ms` }}
            >
              <div className="commit-left-col">
                <div className="commit-sha-badge">
                  <code>{c.short_sha || c.sha.slice(0, 7)}</code>
                </div>
                {isSuspect && (
                  <span className="suspect-pill-badge">
                    <ShieldAlert size={11} />
                    <span>Suspect</span>
                  </span>
                )}
              </div>

              <div className="commit-center-col">
                <div className="commit-message-line" title={c.message}>
                  {c.message.split('\n')[0]}
                </div>
                <div className="commit-sub-meta">
                  <span className="commit-author">{c.author}</span>
                  <span className="meta-sep">•</span>
                  <span className="commit-time">{formatCommitDate(c.date)}</span>
                  <span className="meta-sep">•</span>
                  <span className="commit-files-count">
                    {c.files?.length || 0} file{c.files?.length !== 1 ? 's' : ''}
                  </span>
                  {(c.additions > 0 || c.deletions > 0) && (
                    <>
                      <span className="meta-sep">•</span>
                      <span className="commit-diff-stats">
                        <span className="stat-add">+{c.additions}</span>{' '}
                        <span className="stat-del">-{c.deletions}</span>
                      </span>
                    </>
                  )}
                </div>
              </div>

              <div className="commit-right-col">
                {renderCiBadge(c.ci_state)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
