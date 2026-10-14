import { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import './CodeBlock.css';

export default function CodeBlock({ code, title = 'Python', showLineNumbers = true }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code.trim());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.error('Failed to copy code:', e);
    }
  };

  const lines = code.trim().split('\n');

  return (
    <div className="code-block-container">
      <div className="code-block-header">
        <div className="code-lang-pill">
          <span className="code-lang-dot" />
          <span className="code-lang-text">{title}</span>
        </div>
        <button
          type="button"
          className="code-copy-btn"
          onClick={handleCopy}
          title="Copy code"
        >
          {copied ? (
            <>
              <Check size={14} className="copy-icon success" />
              <span>Copied!</span>
            </>
          ) : (
            <>
              <Copy size={14} className="copy-icon" />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>

      <div className="code-block-body">
        {showLineNumbers && (
          <div className="code-line-numbers" aria-hidden="true">
            {lines.map((_, i) => (
              <span key={i}>{i + 1}</span>
            ))}
          </div>
        )}
        <pre className="code-pre">
          <code>{code.trim()}</code>
        </pre>
      </div>
    </div>
  );
}
