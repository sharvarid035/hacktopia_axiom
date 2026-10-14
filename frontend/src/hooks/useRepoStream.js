import { useState, useRef, useEffect, useCallback } from 'react';

export const BACKEND_URL = import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000';

// Preloaded demo repo URLs (placeholder constants user can click/replace)
export const DEMO_REPO_URL = 'https://github.com/pallets/click';
export const DEMO_REPO_URL_2 = 'https://github.com/psf/requests';

const HISTORY_STORAGE_KEY = 'verdict_ai_case_history';

export function useRepoStream() {
  const [repoUrl, setRepoUrl] = useState(DEMO_REPO_URL);
  const [branch, setBranch] = useState('');
  const [limit, setLimit] = useState(5);
  const [githubToken, setGithubToken] = useState('');

  const [isRunning, setIsRunning] = useState(false);
  const [isDone, setIsDone] = useState(false);
  const [statusText, setStatusText] = useState('Ready to audit');
  const [errorMessage, setErrorMessage] = useState('');

  // Stages: 0: Idle, 1: Investigator, 2: Prosecutor, 3: Defender, 4: Judge, 5: Done
  const [currentStage, setCurrentStage] = useState(0);

  // Commits & Suspect Data
  const [repoName, setRepoName] = useState('');
  const [commits, setCommits] = useState([]);
  const [suspect, setSuspect] = useState(null);

  // Agent outputs & active states
  const [prosecutorText, setProsecutorText] = useState('');
  const [prosecutorStatus, setProsecutorStatus] = useState('waiting');

  const [defenderText, setDefenderText] = useState('');
  const [defenderStatus, setDefenderStatus] = useState('waiting');

  const [judgeText, setJudgeText] = useState('');
  const [judgeStatus, setJudgeStatus] = useState('waiting');

  const [testData, setTestData] = useState(null);
  const [verdictData, setVerdictData] = useState(null);

  // Elapsed time tracker
  const [elapsedTime, setElapsedTime] = useState(0);
  const timerRef = useRef(null);

  useEffect(() => {
    if (isRunning) {
      const start = Date.now();
      timerRef.current = setInterval(() => {
        setElapsedTime(Math.floor((Date.now() - start) / 1000));
      }, 1000);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isRunning]);

  const saveAuditToHistory = useCallback((record) => {
    try {
      const stored = localStorage.getItem(HISTORY_STORAGE_KEY);
      const history = stored ? JSON.parse(stored) : [];
      const updated = [record, ...history].slice(0, 50);
      localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(updated));
    } catch (e) {
      console.warn('Could not save audit to localStorage history:', e);
    }
  }, []);

  const resetAudit = () => {
    setIsRunning(false);
    setIsDone(false);
    setErrorMessage('');
    setStatusText('Ready to audit');
    setCurrentStage(0);
    setCommits([]);
    setSuspect(null);
    setProsecutorText('');
    setProsecutorStatus('waiting');
    setDefenderText('');
    setDefenderStatus('waiting');
    setJudgeText('');
    setJudgeStatus('waiting');
    setTestData(null);
    setVerdictData(null);
    setElapsedTime(0);
  };

  const loadPastAudit = (pastRecord) => {
    setRepoUrl(pastRecord.repoUrl || '');
    setRepoName(pastRecord.repo || '');
    setCommits(pastRecord.commits || []);
    setSuspect(pastRecord.suspect || null);
    setProsecutorText(pastRecord.prosecutorText || '');
    setProsecutorStatus('done');
    setDefenderText(pastRecord.defenderText || '');
    setDefenderStatus('done');
    setJudgeText(pastRecord.judgeText || '');
    setJudgeStatus('done');
    setTestData(pastRecord.testData || null);
    setVerdictData(pastRecord.verdictData || null);
    setElapsedTime(pastRecord.duration || 0);
    setIsDone(true);
    setIsRunning(false);
    setStatusText('Reviewing archived repository audit');
    setCurrentStage(5);
    setErrorMessage('');
  };

  const runRepoAudit = async () => {
    if (!repoUrl.trim() || isRunning) return;

    setIsRunning(true);
    setElapsedTime(0);
    setIsDone(false);
    setErrorMessage('');
    setStatusText('Contacting GitHub API...');
    setCurrentStage(1);

    setCommits([]);
    setSuspect(null);
    setProsecutorText('');
    setProsecutorStatus('waiting');
    setDefenderText('');
    setDefenderStatus('waiting');
    setJudgeText('');
    setJudgeStatus('waiting');
    setTestData(null);
    setVerdictData(null);

    const startTime = Date.now();
    let currentRepoName = '';
    let finalCommits = [];
    let finalSuspect = null;
    let finalProsText = '';
    let finalDefText = '';
    let finalJudgeText = '';
    let finalTestData = null;
    let finalVerdictData = null;

    try {
      const response = await fetch(`${BACKEND_URL}/debug/repo/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          repo_url: repoUrl.trim(),
          branch: branch.trim() || null,
          limit: Number(limit) || 5,
          github_token: githubToken.trim() || null,
        }),
      });

      if (!response.ok) {
        throw new Error(`Server returned HTTP ${response.status}: ${response.statusText}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      const processJsonEvent = (jsonStr) => {
        try {
          const data = JSON.parse(jsonStr);

          if (data.agent === 'status') {
            setStatusText(data.text);
            if (data.text.includes('Prosecutor')) {
              setCurrentStage(2);
              setProsecutorStatus((prev) => (prev === 'speaking' ? 'speaking' : 'thinking'));
            } else if (data.text.includes('Defender')) {
              setCurrentStage(3);
              setProsecutorStatus('done');
              setDefenderStatus('thinking');
            } else if (data.text.includes('Judge')) {
              setCurrentStage(4);
              setDefenderStatus('done');
              setJudgeStatus('thinking');
            } else if (data.text === 'Done') {
              setIsDone(true);
              setCurrentStage(5);
              setJudgeStatus('done');
            }
          } else if (data.agent === 'commits') {
            currentRepoName = data.repo || '';
            setRepoName(currentRepoName);
            finalCommits = data.commits || [];
            setCommits(finalCommits);
          } else if (data.agent === 'suspect') {
            finalSuspect = {
              sha: data.sha,
              short_sha: data.short_sha,
              file: data.file,
              reason: data.reason,
              confidence: data.confidence,
              ci_error_summary: data.ci_error_summary,
            };
            setSuspect(finalSuspect);
          } else if (data.agent === 'prosecutor') {
            setCurrentStage(2);
            setProsecutorStatus('speaking');
            finalProsText += (data.text || '');
            setProsecutorText((prev) => prev + (data.text || ''));
          } else if (data.agent === 'defender') {
            setCurrentStage(3);
            setProsecutorStatus('done');
            setDefenderStatus('speaking');
            finalDefText += (data.text || '');
            setDefenderText((prev) => prev + (data.text || ''));
          } else if (data.agent === 'tests') {
            setCurrentStage(4);
            finalTestData = {
              mode: data.mode,
              test_code: data.test_code,
              results: data.results,
            };
            setTestData(finalTestData);
          } else if (data.agent === 'verdict') {
            finalVerdictData = {
              winner: data.winner,
              reason: data.reason,
            };
            setVerdictData(finalVerdictData);
          } else if (data.agent === 'judge') {
            setCurrentStage(4);
            setDefenderStatus('done');
            setJudgeStatus('speaking');
            finalJudgeText += (data.text || '');
            setJudgeText((prev) => prev + (data.text || ''));
          } else if (data.agent === 'error') {
            setErrorMessage(data.text);
          }
        } catch (err) {
          console.error('Failed to parse SSE event JSON:', jsonStr, err);
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop();

        for (const part of parts) {
          const lines = part.split('\n');
          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith('data:')) {
              const jsonStr = trimmed.replace(/^data:\s*/, '');
              if (jsonStr) {
                processJsonEvent(jsonStr);
              }
            }
          }
        }
      }

      if (buffer.trim()) {
        const lines = buffer.split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('data:')) {
            const jsonStr = trimmed.replace(/^data:\s*/, '');
            if (jsonStr) {
              processJsonEvent(jsonStr);
            }
          }
        }
      }

      const durationSeconds = Math.max(1, Math.floor((Date.now() - startTime) / 1000));
      setProsecutorStatus('done');
      setDefenderStatus('done');
      setJudgeStatus('done');
      setIsDone(true);
      setCurrentStage(5);

      if (finalVerdictData || finalTestData || finalSuspect) {
        saveAuditToHistory({
          id: `repo_${Date.now()}`,
          type: 'repo',
          repo: currentRepoName || repoUrl,
          repoUrl,
          commits: finalCommits,
          suspect: finalSuspect,
          timestamp: new Date().toISOString(),
          duration: durationSeconds,
          prosecutorText: finalProsText,
          defenderText: finalDefText,
          judgeText: finalJudgeText,
          testData: finalTestData,
          verdictData: finalVerdictData,
          winner: finalVerdictData?.winner || 'Unknown',
        });
      }
    } catch (err) {
      console.error('Repo audit stream error:', err);
      setErrorMessage(
        `Failed to reach backend at ${BACKEND_URL}. (${err.message})`
      );
    } finally {
      setIsRunning(false);
    }
  };

  return {
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
    loadPastAudit,
  };
}
