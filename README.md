# Swarm Debugger

A multi-agent AI debugging backend powered by **FastAPI** and **Google Gemini** (`gemini-2.5-flash`). When a user submits buggy Python code, three LLM agents debate and test fixes in real time over Server-Sent Events (SSE) at `POST /debug/stream`:

1. **Prosecutor Agent**: Identifies bugs, explains where/why they fail in simple terms, and provides a complete corrected code block.
2. **Defender Agent**: Reviews the prosecutor's fix, either concedes or challenges it with edge cases, and provides an alternative or improved code block.
3. **Judge Agent**: Generates 5 pytest unit tests testing the original code's intended edge cases, executes them against both candidates in a sandbox (Docker or local subprocess), computes the winner in Python, and streams an honest, beginner-friendly explanation.

---

## Architecture & SSE Event Flow

Each stream emits Server-Sent Events with JSON payloads:
- `{"agent": "status", "text": "..."}`: Progress notifications.
- `{"agent": "prosecutor", "text": "..."}`: Streaming Prosecutor response and code.
- `{"agent": "defender", "text": "..."}`: Streaming Defender response and code.
- `{"agent": "tests", "test_code": "...", "results": {"prosecutor": {"passed": n, "total": n, "output": "..."}, "defender": {"passed": n, "total": n, "output": "..."}}}`: Real pytest run results.
- `{"agent": "verdict", "winner": "Prosecutor" | "Defender" | "Tie", "reason": "..."}`: Winner computed from test pass counts.
- `{"agent": "judge", "text": "..."}`: Streaming explanation from the Judge.
- `{"agent": "status", "text": "Done"}`: Stream completion.

---

## Setup Instructions

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

### 4. (Optional) Build Docker Sandbox Image
If running with Docker enabled (`USE_DOCKER=true`):
```bash
docker build -t code-sandbox -f backend/dockerfile.sandbox backend/
```

### 5. Start the Server
From the `backend` directory:
```bash
cd backend
uvicorn main:app --reload
```
The server will run on `http://127.0.0.1:8000`.

---

## Example Usage with cURL

Send buggy Python code to `/debug/stream`:

```bash
curl -N -X POST http://127.0.0.1:8000/debug/stream \
  -H "Content-Type: application/json" \
  -d '{"code":"def average(nums):\n    return sum(nums) / len(nums)"}'
```

On Windows PowerShell:
```powershell
curl.exe -N -X POST http://127.0.0.1:8000/debug/stream `
  -H "Content-Type: application/json" `
  -d '{\"code\":\"def average(nums):\n    return sum(nums) / len(nums)\"}'
```

---

## Frontend

The frontend is a single-page React + Vite application (built with JavaScript and Vanilla CSS) that streams real-time agent debates and sandbox test results over Server-Sent Events.

### 1. Install Dependencies
```bash
cd frontend
npm install
```

### 2. Start Vite Development Server
```bash
npm run dev
```

The application will be available at:
**`http://localhost:5173/`** (or `http://127.0.0.1:5173/`)

### Features
- **3 Preloaded Buggy Python Examples**: ZeroDivisionError in average calculation, off-by-one loop indexing, and mutable default arguments.
- **Real-Time Streaming Debates**: Three dedicated cards for **Prosecutor** (red), **Defender** (blue), and **Judge** (gold) displaying thoughts and fenced Python code blocks.
- **Sandbox Pytest Scoreboard**: Automated test pass rates and raw pytest stdout/stderr inspection.
- **Judge's Test Suite Viewer**: Expandable accordion displaying the 5 pytest functions dynamically authored by the Judge.
- **Winner Banner**: Prominent verdict banner declaring the debate winner or tie with an honest sentence rationale.

