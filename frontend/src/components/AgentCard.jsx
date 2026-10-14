import { ShieldAlert, Scale, Gavel, CheckCircle2 } from 'lucide-react';
import CodeBlock from './CodeBlock';
import './AgentCard.css';

export default function AgentCard({
  type, // 'prosecutor' | 'defender' | 'judge'
  name,
  tagline,
  text = '',
  status = 'waiting', // 'waiting' | 'thinking' | 'speaking' | 'done'
  isActive = false,
  isStreaming = false,
}) {
  // Determine agent icon and theme variable
  const getIcon = () => {
    switch (type) {
      case 'prosecutor':
        return <ShieldAlert size={20} className="agent-title-icon prosecutor" />;
      case 'defender':
        return <Scale size={20} className="agent-title-icon defender" />;
      case 'judge':
        return <Gavel size={20} className="agent-title-icon judge" />;
      default:
        return null;
    }
  };

  // Special badge parsing for Defender
  let defenderBadge = null;
  let displayText = text;

  if (type === 'defender' && text) {
    const trimmed = text.trim();
    const firstLineMatch = trimmed.match(/^VERDICT:\s*(CONCEDE|CHALLENGE)/i);
    if (firstLineMatch) {
      const decision = firstLineMatch[1].toUpperCase();
      defenderBadge = decision === 'CONCEDE' ? 'Conceded' : 'Challenged';
      // Strip the verdict declaration from text to avoid duplication
      displayText = trimmed.replace(/^VERDICT:\s*(?:CONCEDE|CHALLENGE)\s*\n*/i, '');
    }
  }

  // Parse text into paragraphs and code blocks
  const parseContent = (content) => {
    if (!content) return [];
    const parts = [];
    const regex = /```(?:python)?\s*\n?([\s\S]*?)```/gi;
    let lastIndex = 0;
    let match;

    while ((match = regex.exec(content)) !== null) {
      if (match.index > lastIndex) {
        parts.push({ type: 'text', content: content.substring(lastIndex, match.index) });
      }
      parts.push({ type: 'code', content: match[1] });
      lastIndex = regex.lastIndex;
    }

    if (lastIndex < content.length) {
      const remaining = content.substring(lastIndex);
      const unclosedMatch = remaining.match(/```(?:python)?\s*\n?([\s\S]*)/i);
      if (unclosedMatch) {
        const beforeCode = remaining.substring(0, unclosedMatch.index);
        if (beforeCode) parts.push({ type: 'text', content: beforeCode });
        parts.push({ type: 'code', content: unclosedMatch[1] });
      } else {
        parts.push({ type: 'text', content: remaining });
      }
    }

    return parts;
  };

  const parsedParts = parseContent(displayText);

  return (
    <div
      className={`agent-card card-surface agent-${type} ${isActive ? 'is-active' : ''} ${status === 'done' ? 'is-done' : ''}`}
    >
      {/* Colored Top Border Indicator */}
      <div className={`agent-card-accent-bar bar-${type}`} />

      {/* Card Header */}
      <div className="agent-card-header">
        <div className="agent-header-left">
          <div className={`agent-icon-box box-${type}`}>
            {getIcon()}
          </div>
          <div className="agent-title-meta">
            <div className="agent-title-row">
              <h3 className="agent-name">{name}</h3>
              {defenderBadge && (
                <span
                  className={`defender-decision-pill ${defenderBadge.toLowerCase()}`}
                >
                  {defenderBadge}
                </span>
              )}
            </div>
            <span className="agent-tagline">{tagline}</span>
          </div>
        </div>

        {/* Status Chip */}
        <div className={`agent-status-chip chip-${status}`}>
          {status === 'waiting' && <span className="status-label">Waiting</span>}
          {status === 'thinking' && (
            <div className="status-thinking">
              <span className="thinking-dots">
                <span className="dot" />
                <span className="dot" />
                <span className="dot" />
              </span>
              <span>Thinking…</span>
            </div>
          )}
          {status === 'speaking' && (
            <div className="status-speaking">
              <span className="speaking-pulse" />
              <span>Speaking</span>
            </div>
          )}
          {status === 'done' && (
            <div className="status-done">
              <CheckCircle2 size={13} />
              <span>Done</span>
            </div>
          )}
        </div>
      </div>

      {/* Card Body */}
      <div className="agent-card-body">
        {status === 'waiting' && !displayText && (
          <div className="agent-empty-state">
            <span className="empty-text">Awaiting court prompt and prior testimony...</span>
          </div>
        )}

        {status === 'thinking' && !displayText && (
          <div className="agent-thinking-state">
            <div className="thinking-skeleton-pulse">
              <div className="skeleton-line full" />
              <div className="skeleton-line long" />
              <div className="skeleton-line medium" />
            </div>
            <span className="thinking-subtext">Deliberating argument & inspecting code...</span>
          </div>
        )}

        {parsedParts.length > 0 && (
          <div className="agent-streamed-content">
            {parsedParts.map((part, index) => {
              if (part.type === 'code') {
                return (
                  <CodeBlock
                    key={index}
                    code={part.content}
                    title={type === 'prosecutor' ? 'Prosecutor Fix' : type === 'defender' ? 'Defender Fix' : 'Pytest Harness'}
                  />
                );
              }
              const paragraphs = part.content.split('\n\n').filter((p) => p.trim());
              return (
                <div key={index} className="agent-paragraphs">
                  {paragraphs.map((p, pIdx) => (
                    <p key={pIdx}>{p.trim()}</p>
                  ))}
                </div>
              );
            })}
            {isStreaming && <span className="cursor-blink" aria-hidden="true" />}
          </div>
        )}
      </div>
    </div>
  );
}
