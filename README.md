# Verdict AI

**Verdict AI** is an autonomous three-agent code review court: **Prosecutor**, **Defender**, and **Judge**. When a user submits Python code, the agents debate, challenge, and battle-test patches in an isolated sandbox in real time over Server-Sent Events (SSE) at `POST /debug/stream`:

1. **Prosecutor Agent**: Uncovers genuine runtime bugs, explains why they fail in clear terms with concrete failing inputs, and delivers a corrected implementation.
2. **Defender Agent**: Reviews the Prosecutor's patch, audits edge cases, declares either `VERDICT: CONCEDE` or `VERDICT: CHALLENGE`, and submits an alternative patch if challenged.
3. **Judge Agent**: Deduces program intent, synthesizes a comprehensive pytest suite, executes all candidates concurrently in a sandbox, calculates the empirical winner based on verified test pass rates, and streams an authoritative verdict.

---

## Architecture & SSE Event Flow

Each stream emits Server-Sent Events with JSON payloads:
- `{"agent": "status", "text": "..."}`: Real-time stage updates and progress notifications.
- `{"agent": "prosecutor", "text": "..."}`: Streaming Prosecutor analysis and code block.
- `{"agent": "defender", "text": "..."}`: Streaming Defender challenge/concession and code block.
- `{"agent": "tests", "mode": "function"|"script", "test_code": "...", "results": {"original": {...}, "prosecutor": {...}, "defender": {...}}}`: Pytest unit test results across all candidates.
- `{"agent": "verdict", "winner": "Prosecutor" | "Defender" | "Tie", "reason": "..."}`: Computed winner and verdict reason.
- `{"agent": "judge", "text": "..."}`: Streaming judicial reasoning and evaluation.
- `{"agent": "status", "text": "Done"}`: Stream completion.

---

## Backend Setup Instructions

### 1. Create and Activate Virtual Environment
```bash
python -m venv venv
```
- **Windows (PowerShell)**:
  ```powershell
  .\venv\Scripts\Activate.ps1
  ```
- **macOS / Linux**:
  ```bash
  source venv/bin/activate
  ```

### 2. Install Dependencies
```bash
pip install -r backend/requirements.txt
```

### 3. Configure Environment Variables
Copy `backend/.env.example` to `backend/.env`:
```bash
cp backend/.env.example backend/.env
```
Edit `backend/.env`:
```env
GEMINI_API_KEY=your_gemini_api_key_here
USE_DOCKER=false
```
> **Note**: Set `USE_DOCKER=false` to execute pytest locally in temporary directories without Docker. If `USE_DOCKER=true`, Docker must be installed and running.

### 4. Start Backend Server
From the `backend` directory:
```bash
cd backend
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```
The server will run on `http://127.0.0.1:8000`.

---

## Frontend Setup & Routes

The frontend is a modern, responsive React + Vite application featuring design tokens for both light and dark modes, smooth typography (Source Serif 4 + Inter + Fira Code), theme-aware transparent logos, and real-time streaming state management.

### 1. Install Dependencies
```bash
cd frontend
npm install
```

### 2. Run Development Server
```bash
npm run dev
```
The application will be live at:
**`http://127.0.0.1:5173/`** (or `http://localhost:5173/`)

### 3. Build for Production & Linting
```bash
npm run build
npm run lint
```

### Routes & Product Architecture

- **`/` — Landing Page**:
  - Centered full Verdict AI logo with theme-aware transparency, smooth floating animation (`translateY ±8px`, 6s loop), and a soft pulsing glow.
  - Serif headline *"Bring your code. We'll call the witnesses."* with italic primary styling and subtitle.
  - Call-to-action buttons: primary *"Convene the court →"* (`/app`) and ghost *"Meet the agents"* (`/app/agents`).
  - Staggered preview cards for Prosecutor, Defender, and Judge.
  - Subtle grid background, minimal top bar with theme toggle, and Hacktopia footer.

- **`/app` — App Shell & New Trial Page**:
  - Persistent left sidebar (collapsible on mobile into a drawer) with logo mark, navigation items, developer profile chip, and theme toggle.
  - Top bar with dynamic breadcrumbs (`Workspace / New trial`) and active status badge.
  - **Petition for review card**:
    - Monospace Python code editor with line numbers, tab-key indentation (4 spaces), and synched scrolling.
    - Python 3.12 tag and preloaded buggy examples selector:
      1. *Average of Empty List (ZeroDivisionError)*
      2. *Off-by-One Loop (IndexError)*
      3. *Mutable Default Argument (State Leaks)*
    - Clean footer with *"Convene the court →"* action.
  - **Trial View (Live Results)**:
    - Horizontal stepper *"Prosecutor → Defender → Judge"* with stage highlighting, pulsing status dot, and live elapsed timer.
    - Three responsive Agent cards with colored top borders, status chips (*Waiting*, *Thinking…*, *Speaking*, *Done*), streamed text with blinking cursor, active glow effects, copyable code blocks, and Defender *Conceded* / *Challenged* badges.
    - **Sandbox Pytest Matrix**: Per-test pass/fail statuses, score summaries, inspectable raw pytest logs for all candidates, and an expandable *Judge's Generated Test Suite* accordion.
    - **Prominent Winner Banner**: Celebratory styling with official ruling reason and winner accent colors.
    - Automatic persistence to local storage history on completion.

- **`/app/repo` — Repo Audit Page**:
  - Full-repository AI code audit powered by GitHub API and GitHub Actions integration.
  - Paste any public (or token-authenticated private) GitHub repository URL.
  - Interactive controls: target branch, number of recent commits (3, 5, 10), and optional GitHub personal access token (used strictly per-request, never persisted).
  - **Commit Timeline**: Displays recent commits with author, relative date, diff stats (`+N / -N`), and GitHub Actions CI badges (*Passing*, *Failing*, *No CI*).
  - **Investigator Suspect Callout**: Identifies the suspect commit and file, showing confidence level, rationale, and CI diagnostic excerpt.
  - Full three-agent adjudication court (**Prosecutor**, **Defender**, **Judge**) with sandbox verification on the suspect file.

- **`/app/agents` — The Review Bench**:
  - Overview of Prosecutor (*"Finds the flaw"*), Defender (*"Tests the fix"*), and Judge (*"Scores the case"*).
  - Model engine specifications (Gemini Flash), temperature settings, and core mandate checklists with green *"Ready"* status indicators.

- **`/app/history` — Case History Docket**:
  - Docket archive of all past completed trials stored in `localStorage`.
  - Distinguishes snippet trials and repository audits with dedicated badges (*Repo* vs *Snippet*).
  - Date, duration, winner badges, and code/suspect file snippets.
  - Click to reopen any past trial or repo audit directly in its respective view with complete results.
  - Clear history action and friendly empty state.

---

## Example Usage with cURL

### 1. Single Code Snippet Stream (`/debug/stream`)
```bash
curl -N -X POST http://127.0.0.1:8000/debug/stream \
  -H "Content-Type: application/json" \
  -d '{"code":"def average(nums):\n    return sum(nums) / len(nums)"}'
```

### 2. Repository Audit Stream (`/debug/repo/stream`)
```bash
curl -N -X POST http://127.0.0.1:8000/debug/repo/stream \
  -H "Content-Type: application/json" \
  -d '{"repo_url":"https://github.com/pallets/click","branch":"main","limit":5,"github_token":null}'
```

> **GitHub Token Note**: Public repositories can be audited without a token subject to GitHub's standard IP rate limit (60 requests/hr). Providing a personal access token (via `GITHUB_TOKEN` in `.env` or in the request body) increases the rate limit to 5,000 requests/hr and enables auditing of private repositories. Tokens are never logged or stored.
