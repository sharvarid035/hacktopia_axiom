import { useState, useRef, useEffect, useCallback } from 'react';

export const BACKEND_URL = import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000';

export const PRELOADED_EXAMPLES = [
  {
    id: 'empty_list',
    title: '1. Average of Empty List (ZeroDivisionError)',
    code: `def average(nums):
    # Bug: Crashes with ZeroDivisionError if nums is empty []
    return sum(nums) / len(nums)`,
  },
  {
    id: 'off_by_one',
    title: '2. Off-by-One Loop (IndexError)',
    code: `def find_element(items, target):
    # Bug: range(len(items) + 1) iterates one past the last valid index
    for i in range(len(items) + 1):
        if items[i] == target:
            return i
    return -1`,
  },
  {
    id: 'mutable_default',
    title: '3. Mutable Default Argument (State Leaks)',
    code: `def append_to_list(val, my_list=[]):
    # Bug: Default mutable list [] is shared across calls
    my_list.append(val)
    return my_list`,
  },
];

const HISTORY_STORAGE_KEY = 'verdict_ai_case_history';

export function useSwarmStream() {
  const [code, setCode] = useState(PRELOADED_EXAMPLES[0].code);
  const [selectedExample, setSelectedExample] = useState(PRELOADED_EXAMPLES[0].id);
  const [isRunning, setIsRunning] = useState(false);
  const [isDone, setIsDone] = useState(false);
  const [statusText, setStatusText] = useState('Ready to convene');
  const [errorMessage, setErrorMessage] = useState('');

  // Active stage: 0 = Idle, 1 = Prosecutor, 2 = Defender, 3 = Judge, 4 = Done
  const [currentStage, setCurrentStage] = useState(0);

  // Agent outputs & active states
  const [prosecutorText, setProsecutorText] = useState('');
  const [prosecutorStatus, setProsecutorStatus] = useState('waiting'); // waiting, thinking, speaking, done

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

  // Helper to save trial to localStorage
  const saveTrialToHistory = useCallback((trialRecord) => {
    try {
      const stored = localStorage.getItem(HISTORY_STORAGE_KEY);
      const history = stored ? JSON.parse(stored) : [];
      const updated = [trialRecord, ...history].slice(0, 50); // Keep last 50
      localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(updated));
    } catch (e) {
      console.warn('Could not save trial to localStorage history:', e);
    }
  }, []);

  const selectExample = (exampleId) => {
    setSelectedExample(exampleId);
    const found = PRELOADED_EXAMPLES.find((ex) => ex.id === exampleId);
    if (found) {
      setCode(found.code);
    }
  };

  const resetTrial = () => {
    setIsRunning(false);
    setIsDone(false);
    setErrorMessage('');
    setStatusText('Ready to convene');
    setCurrentStage(0);
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

  const loadPastTrial = (pastTrial) => {
    setCode(pastTrial.code || '');
    setProsecutorText(pastTrial.prosecutorText || '');
    setProsecutorStatus('done');
    setDefenderText(pastTrial.defenderText || '');
    setDefenderStatus('done');
    setJudgeText(pastTrial.judgeText || '');
    setJudgeStatus('done');
    setTestData(pastTrial.testData || null);
    setVerdictData(pastTrial.verdictData || null);
    setElapsedTime(pastTrial.duration || 0);
    setIsDone(true);
    setIsRunning(false);
    setStatusText('Reviewing archived verdict');
    setCurrentStage(4);
    setErrorMessage('');
  };

  const runSwarm = async () => {
    if (!code.trim() || isRunning) return;

    setIsRunning(true);
    setElapsedTime(0);
    setIsDone(false);
    setErrorMessage('');
    setStatusText('Convening the court...');
    setCurrentStage(1);

    setProsecutorText('');
    setProsecutorStatus('thinking');

    setDefenderText('');
    setDefenderStatus('waiting');

    setJudgeText('');
    setJudgeStatus('waiting');

    setTestData(null);
    setVerdictData(null);

    const startTime = Date.now();
    let finalProsText = '';
    let finalDefText = '';
    let finalJudgeText = '';
    let finalTestData = null;
    let finalVerdictData = null;

    try {
      const response = await fetch(`${BACKEND_URL}/debug/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ code }),
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
            if (data.text.includes('Prosecutor is analyzing')) {
              setCurrentStage(1);
              setProsecutorStatus((prev) => (prev === 'speaking' ? 'speaking' : 'thinking'));
            } else if (data.text.includes('Defender is getting ready')) {
              setCurrentStage(2);
              setProsecutorStatus('done');
              setDefenderStatus('thinking');
            } else if (data.text.includes('Judge is generating')) {
              setCurrentStage(3);
              setDefenderStatus('done');
              setJudgeStatus('thinking');
            } else if (data.text === 'Done') {
              setIsDone(true);
              setCurrentStage(4);
              setJudgeStatus('done');
            }
          } else if (data.agent === 'prosecutor') {
            setCurrentStage(1);
            setProsecutorStatus('speaking');
            finalProsText += (data.text || '');
            setProsecutorText((prev) => prev + (data.text || ''));
          } else if (data.agent === 'defender') {
            setCurrentStage(2);
            setProsecutorStatus('done');
            setDefenderStatus('speaking');
            finalDefText += (data.text || '');
            setDefenderText((prev) => prev + (data.text || ''));
          } else if (data.agent === 'tests') {
            setCurrentStage(3);
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
            setCurrentStage(3);
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

      // Finalize trial and save to history
      const durationSeconds = Math.max(1, Math.floor((Date.now() - startTime) / 1000));
      setProsecutorStatus('done');
      setDefenderStatus('done');
      setJudgeStatus('done');
      setIsDone(true);
      setCurrentStage(4);

      if (finalVerdictData || finalTestData) {
        saveTrialToHistory({
          id: `trial_${Date.now()}`,
          code,
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
      console.error('Swarm stream error:', err);
      setErrorMessage(
        `Failed to reach backend at ${BACKEND_URL}. Ensure the backend is active on http://127.0.0.1:8000. (${err.message})`
      );
    } finally {
      setIsRunning(false);
    }
  };

  return {
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
    loadPastTrial,
  };
}
