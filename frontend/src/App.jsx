import { useState } from 'react';
import './App.css';

const BACKEND_URL = "http://127.0.0.1:8000";

const PRELOADED_EXAMPLES = [
  {
    id: "empty_list",
    title: "1. Average of Empty List (ZeroDivisionError)",
    code: `def average(nums):
    # Bug: Crashes with ZeroDivisionError if nums is empty []
    return sum(nums) / len(nums)`,
  },
  {
    id: "off_by_one",
    title: "2. Off-by-One Loop (IndexError)",
    code: `def find_element(items, target):
    # Bug: range(len(items) + 1) iterates one past the last valid index
    for i in range(len(items) + 1):
        if items[i] == target:
            return i
    return -1`,
  },
  {
    id: "mutable_default",
    title: "3. Mutable Default Argument (State Leaks)",
    code: `def append_to_list(val, my_list=[]):
    # Bug: Default mutable list [] is shared across calls
    my_list.append(val)
    return my_list`,
  },
];

function FormattedAgentText({ text, isThinking }) {
  if (isThinking && !text) {
    return (
      <div className="thinking-container">
        <div className="pulse-dots">
          <span className="dot"></span>
          <span className="dot"></span>
          <span className="dot"></span>
        </div>
        <span className="thinking-text">Deliberating argument...</span>
      </div>
    );
  }

  if (!text) {
    return <div className="empty-state">Waiting for agent to speak...</div>;
  }

  const parts = [];
  const regex = /```(?:python)?\s*\n?([\s\S]*?)```/gi;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: "text", content: text.substring(lastIndex, match.index) });
    }
    parts.push({ type: "code", content: match[1] });
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    const remaining = text.substring(lastIndex);
    const unclosedMatch = remaining.match(/```(?:python)?\s*\n?([\s\S]*)/i);
    if (unclosedMatch) {
      const beforeCode = remaining.substring(0, unclosedMatch.index);
      if (beforeCode) parts.push({ type: "text", content: beforeCode });
      parts.push({ type: "code", content: unclosedMatch[1] });
    } else {
      parts.push({ type: "text", content: remaining });
    }
  }

  return (
    <div className="agent-text-content">
      {parts.map((p, idx) =>
        p.type === "code" ? (
          <div key={idx} className="code-block-wrapper">
            <div className="code-block-header">
              <span className="code-tag">Python Fix</span>
              <button
                type="button"
                className="copy-btn"
                onClick={() => navigator.clipboard.writeText(p.content.trim())}
                title="Copy code to clipboard"
              >
                Copy
              </button>
            </div>
            <pre className="code-block">
              <code>{p.content.trim()}</code>
            </pre>
          </div>
        ) : (
          <div key={idx} className="text-paragraphs">
            {p.content.split("\n\n").map((para, pIdx) => {
              const trimmed = para.trim();
              if (!trimmed) return null;
              return <p key={pIdx}>{trimmed}</p>;
            })}
          </div>
        )
      )}
    </div>
  );
}

export default function App() {
  const [code, setCode] = useState(PRELOADED_EXAMPLES[0].code);
  const [selectedExample, setSelectedExample] = useState(PRELOADED_EXAMPLES[0].id);
  const [isRunning, setIsRunning] = useState(false);
  const [isDone, setIsDone] = useState(false);
  const [statusText, setStatusText] = useState("Ready to debug");
  const [errorMessage, setErrorMessage] = useState("");

  const [prosecutorText, setProsecutorText] = useState("");
  const [prosecutorStarted, setProsecutorStarted] = useState(false);

  const [defenderText, setDefenderText] = useState("");
  const [defenderStarted, setDefenderStarted] = useState(false);

  const [judgeText, setJudgeText] = useState("");
  const [judgeStarted, setJudgeStarted] = useState(false);

  const [testData, setTestData] = useState(null);
  const [verdictData, setVerdictData] = useState(null);
  const [showTestCode, setShowTestCode] = useState(false);
  const [expandedCandidate, setExpandedCandidate] = useState(null);

  const handleSelectExample = (e) => {
    const selectedId = e.target.value;
    setSelectedExample(selectedId);
    const found = PRELOADED_EXAMPLES.find((ex) => ex.id === selectedId);
    if (found) {
      setCode(found.code);
    }
  };

  const handleRunSwarm = async () => {
    if (!code.trim() || isRunning) return;

    setIsRunning(true);
    setIsDone(false);
    setErrorMessage("");
    setStatusText("Connecting to Swarm...");
    setProsecutorText("");
    setProsecutorStarted(false);
    setDefenderText("");
    setDefenderStarted(false);
    setJudgeText("");
    setJudgeStarted(false);
    setTestData(null);
    setVerdictData(null);
    setExpandedCandidate(null);

    try {
      const response = await fetch(`${BACKEND_URL}/debug/stream`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ code }),
      });

      if (!response.ok) {
        throw new Error(`Server returned HTTP ${response.status}: ${response.statusText}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let buffer = "";

      const processJsonEvent = (jsonStr) => {
        try {
          const data = JSON.parse(jsonStr);
          if (data.agent === "status") {
            setStatusText(data.text);
            if (data.text === "Done") {
              setIsDone(true);
            }
          } else if (data.agent === "prosecutor") {
            setProsecutorStarted(true);
            setProsecutorText((prev) => prev + (data.text || ""));
          } else if (data.agent === "defender") {
            setDefenderStarted(true);
            setDefenderText((prev) => prev + (data.text || ""));
          } else if (data.agent === "tests") {
            setTestData({
              mode: data.mode,
              test_code: data.test_code,
              results: data.results,
            });
          } else if (data.agent === "verdict") {
            setVerdictData({
              winner: data.winner,
              reason: data.reason,
            });
          } else if (data.agent === "judge") {
            setJudgeStarted(true);
            setJudgeText((prev) => prev + (data.text || ""));
          } else if (data.agent === "error") {
            setErrorMessage(data.text);
          }
        } catch (err) {
          console.error("Failed to parse event JSON:", jsonStr, err);
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop();

        for (const part of parts) {
          const lines = part.split("\n");
          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith("data:")) {
              const jsonStr = trimmed.replace(/^data:\s*/, "");
              if (jsonStr) {
                processJsonEvent(jsonStr);
              }
            }
          }
        }
      }

      if (buffer.trim()) {
        const lines = buffer.split("\n");
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith("data:")) {
            const jsonStr = trimmed.replace(/^data:\s*/, "");
            if (jsonStr) {
              processJsonEvent(jsonStr);
            }
          }
        }
      }
    } catch (err) {
      console.error("Swarm stream failed:", err);
      setErrorMessage(
        `Failed to reach backend at ${BACKEND_URL}. Ensure the backend is running with 'uvicorn main:app --reload'. (${err.message})`
      );
    } finally {
      setIsRunning(false);
    }
  };

  // Extract unique validated test names
  const testNames = (() => {
    if (!testData?.results) return [];
    const names = new Set();
    ["original", "prosecutor", "defender"].forEach((cand) => {
      const perTest = testData.results[cand]?.per_test;
      if (perTest) {
        Object.keys(perTest).forEach((n) => names.add(n));
      }
    });
    return Array.from(names);
  })();

  const renderStatusIcon = (status) => {
    if (status === "PASSED") return <span className="test-icon pass">✅</span>;
    if (status === "FAILED") return <span className="test-icon fail">❌</span>;
    if (status === "ERROR") return <span className="test-icon error">⚠️</span>;
    return <span className="test-icon neutral">-</span>;
  };

  return (
    <div className="app-container">
      {/* Header */}
      <header className="header">
        <div className="badge-pill">Autonomous Multi-Agent AI System</div>
        <h1 className="title">Swarm Debugger</h1>
        <p className="subtitle">
          Prosecutor, Defender, and Judge debate, propose fixes, and battle-test your Python code in a sandbox.
        </p>
      </header>

      {/* Editor & Control Panel */}
      <section className="editor-card">
        <div className="editor-top-bar">
          <div className="select-wrapper">
            <label htmlFor="example-select" className="select-label">
              Load Buggy Example:
            </label>
            <select
              id="example-select"
              className="example-dropdown"
              value={selectedExample}
              onChange={handleSelectExample}
              disabled={isRunning}
            >
              {PRELOADED_EXAMPLES.map((ex) => (
                <option key={ex.id} value={ex.id}>
                  {ex.title}
                </option>
              ))}
            </select>
          </div>

          <button
            className={`run-button ${isRunning ? "running" : ""}`}
            onClick={handleRunSwarm}
            disabled={isRunning || !code.trim()}
          >
            {isRunning ? (
              <>
                <span className="spinner"></span>
                Swarm Deliberating...
              </>
            ) : (
              <>
                <span className="run-icon">▶</span>
                Run Swarm
              </>
            )}
          </button>
        </div>

        <div className="textarea-container">
          <div className="code-gutter">
            {code.split("\n").map((_, i) => (
              <span key={i}>{i + 1}</span>
            ))}
          </div>
          <textarea
            id="buggy-code-input"
            className="code-textarea"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            disabled={isRunning}
            placeholder="# Paste your buggy Python code here..."
            rows={Math.max(6, code.split("\n").length + 1)}
            spellCheck="false"
          />
        </div>
      </section>

      {/* Status Banner */}
      <div className={`status-banner ${isDone ? "done" : isRunning ? "active" : ""}`}>
        <div className="status-indicator">
          {isRunning ? <span className="pulse-dot"></span> : isDone ? "✓" : "●"}
        </div>
        <span className="status-label">Status:</span>
        <span className="status-text">{statusText}</span>
      </div>

      {/* Red Error Message Banner */}
      {errorMessage && (
        <div className="error-banner">
          <div className="error-icon">⚠️</div>
          <div className="error-content">
            <strong>Error:</strong> {errorMessage}
          </div>
        </div>
      )}

      {/* Three Agent Cards Grid */}
      <section className="agent-grid">
        {/* Prosecutor Card */}
        <div className={`agent-card prosecutor-card ${prosecutorStarted ? "active" : ""}`}>
          <div className="agent-card-header">
            <div className="agent-title-group">
              <span className="agent-badge prosecutor-badge">Prosecutor</span>
              <span className="agent-role">Bugs & Accusation</span>
            </div>
            {isRunning && !prosecutorStarted && <span className="card-status">Analyzing...</span>}
          </div>
          <div className="agent-card-body">
            <FormattedAgentText
              text={prosecutorText}
              isThinking={isRunning && !prosecutorStarted}
            />
          </div>
        </div>

        {/* Defender Card */}
        <div className={`agent-card defender-card ${defenderStarted ? "active" : ""}`}>
          <div className="agent-card-header">
            <div className="agent-title-group">
              <span className="agent-badge defender-badge">Defender</span>
              <span className="agent-role">Challenge / Concession</span>
            </div>
            {isRunning && !defenderStarted && prosecutorStarted && (
              <span className="card-status">Preparing Defense...</span>
            )}
          </div>
          <div className="agent-card-body">
            <FormattedAgentText
              text={defenderText}
              isThinking={isRunning && !defenderStarted}
            />
          </div>
        </div>

        {/* Judge Card */}
        <div className={`agent-card judge-card ${judgeStarted ? "active" : ""}`}>
          <div className="agent-card-header">
            <div className="agent-title-group">
              <span className="agent-badge judge-badge">Judge</span>
              <span className="agent-role">Trial & Evaluation</span>
            </div>
            {isRunning && !judgeStarted && defenderStarted && (
              <span className="card-status">Testing & Evaluating...</span>
            )}
          </div>
          <div className="agent-card-body">
            <FormattedAgentText
              text={judgeText}
              isThinking={isRunning && !judgeStarted}
            />
          </div>
        </div>
      </section>

      {/* Prominent Winner Banner */}
      {verdictData && (
        <section
          className={`winner-banner winner-${verdictData.winner.toLowerCase()}`}
        >
          <div className="winner-icon">
            {verdictData.winner === "Prosecutor" ? "⚖️" : verdictData.winner === "Defender" ? "🛡️" : "🤝"}
          </div>
          <div className="winner-info">
            <div className="winner-title">
              Verdict Winner: <strong>{verdictData.winner}</strong>
            </div>
            <p className="winner-reason">{verdictData.reason}</p>
          </div>
        </section>
      )}

      {/* Test Results Table & Sandbox Outputs */}
      {testData && (
        <section className="results-section">
          <div className="section-header">
            <h2 className="section-title">Sandbox Pytest Results</h2>
            <span className="section-subtitle">
              Validated {testNames.length} unit tests in {testData.mode || "function"} mode
            </span>
          </div>

          <div className="table-responsive">
            <table className="results-table per-test-table">
              <thead>
                <tr>
                  <th>Test Case</th>
                  <th className="muted-col">Original Code</th>
                  <th>Prosecutor's Patch</th>
                  <th>Defender's Patch</th>
                </tr>
              </thead>
              <tbody>
                {testNames.map((tName) => (
                  <tr key={tName}>
                    <td className="test-name-cell">
                      <code>{tName}</code>
                    </td>
                    <td className="muted-col">
                      {renderStatusIcon(testData.results?.original?.per_test?.[tName])}
                    </td>
                    <td>
                      {renderStatusIcon(testData.results?.prosecutor?.per_test?.[tName])}
                    </td>
                    <td>
                      {renderStatusIcon(testData.results?.defender?.per_test?.[tName])}
                    </td>
                  </tr>
                ))}
                {/* Totals Row */}
                <tr className="totals-row">
                  <td>
                    <strong>Total Passed</strong>
                  </td>
                  <td className="muted-col">
                    <span className="score-pill muted">
                      {testData.results?.original?.passed ?? 0} / {testData.results?.original?.total ?? testNames.length}
                    </span>
                  </td>
                  <td>
                    <span className="score-pill score-prosecutor">
                      {testData.results?.prosecutor?.passed ?? 0} / {testData.results?.prosecutor?.total ?? testNames.length}
                    </span>
                  </td>
                  <td>
                    <span className="score-pill score-defender">
                      {testData.results?.defender?.passed ?? 0} / {testData.results?.defender?.total ?? testNames.length}
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Candidate Output Logs Button Strip */}
          <div className="log-buttons-strip">
            <span>View Pytest Output:</span>
            {["original", "prosecutor", "defender"].map((cName) => (
              <button
                key={cName}
                className={`view-log-btn ${expandedCandidate === cName ? "active" : ""}`}
                onClick={() => setExpandedCandidate(expandedCandidate === cName ? null : cName)}
              >
                {cName.charAt(0).toUpperCase() + cName.slice(1)} Log
              </button>
            ))}
          </div>

          {/* Expanded Output Details */}
          {expandedCandidate && (
            <div className="log-viewer">
              <div className="log-viewer-header">
                <span>
                  Pytest Raw Output ({expandedCandidate.toUpperCase()})
                </span>
                <button className="copy-btn" onClick={() => setExpandedCandidate(null)}>
                  Close
                </button>
              </div>
              <pre className="log-content">
                <code>
                  {testData.results?.[expandedCandidate]?.output || "No output recorded."}
                </code>
              </pre>
            </div>
          )}

          {/* Expandable Judge's Test Code Section */}
          <div className="judge-tests-accordion">
            <button
              className="accordion-trigger"
              onClick={() => setShowTestCode(!showTestCode)}
            >
              <span className="accordion-icon">{showTestCode ? "▼" : "▶"}</span>
              <span className="accordion-title">See Judge's Generated Test Code</span>
              <span className="accordion-badge">{testNames.length} validated pytest tests</span>
            </button>

            {showTestCode && (
              <div className="accordion-content">
                <div className="code-block-wrapper">
                  <div className="code-block-header">
                    <span className="code-lang">test_solution.py</span>
                    <button
                      type="button"
                      className="copy-btn"
                      onClick={() => navigator.clipboard.writeText(testData.test_code)}
                    >
                      Copy Tests
                    </button>
                  </div>
                  <pre className="code-block">
                    <code>{testData.test_code}</code>
                  </pre>
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Footer */}
      <footer className="footer">
        <p>Swarm Debugger &bull; FastAPI + Gemini 2.5 Flash + Isolated Pytest Sandbox</p>
      </footer>
    </div>
  );
}
