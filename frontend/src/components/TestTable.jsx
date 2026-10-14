import { useState } from 'react';
import { ChevronDown, ChevronRight, Terminal, FileCode, Check, Copy } from 'lucide-react';
import CodeBlock from './CodeBlock';
import './TestTable.css';

export default function TestTable({ testData }) {
  const [showTestCode, setShowTestCode] = useState(false);
  const [expandedLog, setExpandedLog] = useState(null);
  const [copiedTests, setCopiedTests] = useState(false);

  // Extract unique validated test names safely
  const testNames = (() => {
    if (!testData?.results) return [];
    const names = new Set();
    ['original', 'prosecutor', 'defender'].forEach((cand) => {
      const perTest = testData.results[cand]?.per_test;
      if (perTest && typeof perTest === 'object') {
        Object.keys(perTest).forEach((n) => names.add(n));
      }
    });
    return Array.from(names);
  })();

  const renderStatus = (status) => {
    if (status === 'PASSED') {
      return (
        <span className="status-pill pass">
          <span className="pill-icon">✓</span>
          <span className="pill-text">Pass</span>
        </span>
      );
    }
    if (status === 'FAILED') {
      return (
        <span className="status-pill fail">
          <span className="pill-icon">✗</span>
          <span className="pill-text">Fail</span>
        </span>
      );
    }
    if (status === 'ERROR') {
      return (
        <span className="status-pill error">
          <span className="pill-icon">!</span>
          <span className="pill-text">Error</span>
        </span>
      );
    }
    return <span className="status-pill neutral">—</span>;
  };

  const handleCopyTests = async () => {
    if (!testData?.test_code) return;
    try {
      await navigator.clipboard.writeText(testData.test_code);
      setCopiedTests(true);
      setTimeout(() => setCopiedTests(false), 2000);
    } catch (e) {
      console.error('Failed to copy tests:', e);
    }
  };

  const origPassed = testData?.results?.original?.passed ?? 0;
  const origTotal = testData?.results?.original?.total ?? testNames.length;
  const prosPassed = testData?.results?.prosecutor?.passed ?? 0;
  const prosTotal = testData?.results?.prosecutor?.total ?? testNames.length;
  const defPassed = testData?.results?.defender?.passed ?? 0;
  const defTotal = testData?.results?.defender?.total ?? testNames.length;

  return (
    <div className="test-results-card card-surface">
      <div className="test-results-header">
        <div className="test-header-info">
          <div className="test-title-row">
            <Terminal size={18} className="test-header-icon" />
            <h3 className="test-section-title">Sandbox Pytest Matrix</h3>
          </div>
          <p className="test-section-subtitle">
            Automated verification across {testNames.length} test cases in {testData?.mode || 'function'} mode.
          </p>
        </div>

        {/* Pytest Output Log Selectors */}
        <div className="log-pill-selectors">
          <span className="selector-label">Inspect Raw Logs:</span>
          {['original', 'prosecutor', 'defender'].map((candidate) => (
            <button
              key={candidate}
              type="button"
              className={`log-pill-btn ${expandedLog === candidate ? 'active' : ''}`}
              onClick={() => setExpandedLog(expandedLog === candidate ? null : candidate)}
            >
              {candidate.charAt(0).toUpperCase() + candidate.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Raw Output Log Drawer if open */}
      {expandedLog && (
        <div className="raw-log-container">
          <div className="raw-log-header">
            <span>Pytest Output: {expandedLog.toUpperCase()}</span>
            <button
              type="button"
              className="raw-log-close"
              onClick={() => setExpandedLog(null)}
            >
              Close
            </button>
          </div>
          <pre className="raw-log-pre">
            <code>{testData?.results?.[expandedLog]?.output || 'No output recorded.'}</code>
          </pre>
        </div>
      )}

      {/* Test Matrix Table */}
      <div className="table-wrapper">
        <table className="test-matrix-table">
          <thead>
            <tr>
              <th className="th-test">Test Case</th>
              <th className="th-cand original-col">Original Code</th>
              <th className="th-cand prosecutor-col">Prosecutor Patch</th>
              <th className="th-cand defender-col">Defender Patch</th>
            </tr>
          </thead>
          <tbody>
            {testNames.map((name, idx) => {
              const origStatus = testData?.results?.original?.per_test?.[name];
              const prosStatus = testData?.results?.prosecutor?.per_test?.[name];
              const defStatus = testData?.results?.defender?.per_test?.[name];

              return (
                <tr
                  key={name}
                  className="test-row-stagger"
                  style={{ animationDelay: `${idx * 150}ms` }}
                >
                  <td className="test-name-cell">
                    <span className="test-fn-badge">def</span>
                    <code className="test-fn-name">{name}()</code>
                  </td>
                  <td className="status-cell original-col">{renderStatus(origStatus)}</td>
                  <td className="status-cell prosecutor-col">{renderStatus(prosStatus)}</td>
                  <td className="status-cell defender-col">{renderStatus(defStatus)}</td>
                </tr>
              );
            })}

            {/* Totals Row */}
            <tr className="totals-row">
              <td className="totals-label">
                <strong>Score Summary</strong>
              </td>
              <td className="totals-score original-col">
                <span className="score-badge muted">
                  {origPassed} / {origTotal}
                </span>
              </td>
              <td className="totals-score prosecutor-col">
                <span className={`score-badge ${prosPassed === prosTotal && prosTotal > 0 ? 'perfect' : 'prosecutor'}`}>
                  {prosPassed} / {prosTotal}
                </span>
              </td>
              <td className="totals-score defender-col">
                <span className={`score-badge ${defPassed === defTotal && defTotal > 0 ? 'perfect' : 'defender'}`}>
                  {defPassed} / {defTotal}
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Expandable Judge's Test Code */}
      <div className="judge-code-accordion">
        <button
          type="button"
          className="judge-accordion-trigger"
          onClick={() => setShowTestCode(!showTestCode)}
          aria-expanded={showTestCode}
        >
          <div className="accordion-left">
            {showTestCode ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
            <FileCode size={16} className="accordion-icon" />
            <span className="accordion-text">See Judge's Generated Test Suite</span>
          </div>
          <span className="accordion-badge">
            {testNames.length} pytest cases
          </span>
        </button>

        {showTestCode && testData?.test_code && (
          <div className="judge-code-panel">
            <div className="panel-actions">
              <button
                type="button"
                className="btn-secondary copy-tests-btn"
                onClick={handleCopyTests}
              >
                {copiedTests ? (
                  <>
                    <Check size={14} />
                    <span>Copied!</span>
                  </>
                ) : (
                  <>
                    <Copy size={14} />
                    <span>Copy Full Suite</span>
                  </>
                )}
              </button>
            </div>
            <CodeBlock
              code={testData.test_code}
              title="test_adjudication.py"
              showLineNumbers={true}
            />
          </div>
        )}
      </div>
    </div>
  );
}
