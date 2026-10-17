import asyncio
import json
import os
import re
from typing import Any, Dict, List, Optional
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from google import genai
from google.genai import types
from dotenv import load_dotenv
from pydantic import BaseModel

try:
    from backend import sandbox
    from backend import github_client
except ImportError:
    import sandbox
    import github_client

load_dotenv()

app = FastAPI(title="Verdict AI API")


@app.get("/")
def root_redirect():
    from fastapi.responses import HTMLResponse
    return HTMLResponse(
        """<html>
        <head><meta http-equiv="refresh" content="0; url=http://127.0.0.1:5173/app/repo" /></head>
        <body style="font-family:sans-serif; text-align:center; padding:50px;">
            <h2>Verdict AI API Server is running!</h2>
            <p>Redirecting to the frontend website: <a href="http://127.0.0.1:5173/app/repo">http://127.0.0.1:5173/app/repo</a>...</p>
        </body></html>"""
    )


@app.get("/health")
def health_check():
    return {"status": "ok"}


# Fix CORS: allow_origins=["*"], allow_credentials=False
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

client = genai.Client()


class CodeRequest(BaseModel):
    code: str


class RepoRequest(BaseModel):
    repo_url: str
    branch: Optional[str] = None
    limit: int = 5
    github_token: Optional[str] = None


def extract_code(text: str) -> str:
    """
    Returns the contents of the first ```python block, or "" if none.
    Also handles unterminated final ``` fence.
    """
    if not text:
        return ""
    # Standard closed block
    match = re.search(r"```(?:python)?\s*\n?(.*?)```", text, re.DOTALL | re.IGNORECASE)
    if match:
        return match.group(1).strip()
    # Unterminated block at end
    match_unclosed = re.search(r"```(?:python)?\s*\n?(.*)", text, re.DOTALL | re.IGNORECASE)
    if match_unclosed:
        code_part = match_unclosed.group(1).strip()
        if code_part:
            return code_part
    return ""



async def call_gemini_with_retry(fn, *args, max_retries: int = 4, **kwargs):
    """Retry transient Gemini errors, but fail fast on exhausted quota."""
    backoffs = [1, 2, 4, 6]

    for attempt in range(max_retries + 1):
        try:
            return await fn(*args, **kwargs)
        except Exception as e:
            err_str = str(e)
            is_quota_exhausted = (
                "RESOURCE_EXHAUSTED" in err_str
                or "generate_content_free_tier_requests" in err_str
                or "GenerateRequestsPerDayPerModel" in err_str
                or "GenerateRequestsPerDayPerProjectPerModel" in err_str
            )

            if is_quota_exhausted:
                print("[GEMINI QUOTA] Quota exhausted; stopping retries.")
                raise RuntimeError(
                    "Gemini API quota exhausted. Please check your quota "
                    "and billing details, or retry when the quota resets."
                ) from e

            is_transient = any(
                code in err_str
                for code in ["429", "500", "503", "UNAVAILABLE", "high demand"]
            )

            if is_transient and attempt < max_retries:
                wait_time = backoffs[min(attempt, len(backoffs) - 1)]
                print(
                    f"[RETRY] Temporary Gemini error. Retrying in "
                    f"{wait_time}s (attempt {attempt + 1}/{max_retries})..."
                )
                await asyncio.sleep(wait_time)
            else:
                raise



async def stream_with_retry(make_stream_fn, max_retries: int = 4):
    """
    Consumes chunks from a stream generator, retrying the whole stream if a transient error occurs mid-stream.
    Yields chunks.
    """
    backoffs = [1, 2, 4, 6]
    for attempt in range(max_retries + 1):
        try:
            stream = await make_stream_fn()
            async for chunk in stream:
                yield chunk
            return
        except Exception as e:
            err_str = str(e)
            is_transient = any(code in err_str for code in ["429", "500", "503", "RESOURCE_EXHAUSTED", "UNAVAILABLE", "high demand"])
            if is_transient and attempt < max_retries:
                wait_time = backoffs[attempt] if attempt < len(backoffs) else 4
                print(f"[RETRY STREAM] Stream failed with {type(e).__name__}: {err_str[:60]}. Retrying in {wait_time}s...")
                await asyncio.sleep(wait_time)
            else:
                raise e


def run_tests_for_candidate(code: str, test_code: str, mode: str, valid_test_names: list[str]) -> dict:
    """
    Executes test_code on candidate code using sandbox.run_in_docker.
    Filters per_test to valid_test_names, counts passed/total.
    Catches import/execution errors gracefully and marks affected tests as ERROR/FAILED.
    """
    if not code or not code.strip():
        per_test = {name: "FAILED" for name in valid_test_names}
        return {
            "passed": 0,
            "total": len(valid_test_names),
            "per_test": per_test,
            "output": "No code provided to execute.",
        }

    try:
        res = sandbox.run_in_docker(code, test_code, mode=mode)
    except Exception as exc:
        per_test = {name: "ERROR" for name in valid_test_names}
        return {
            "passed": 0,
            "total": len(valid_test_names),
            "per_test": per_test,
            "output": f"Sandbox execution error: {str(exc)}",
        }

    raw_per_test = res.get("per_test", {})

    per_test = {}
    passed_count = 0
    for name in valid_test_names:
        status = raw_per_test.get(name, "FAILED")
        per_test[name] = status
        if status == "PASSED":
            passed_count += 1

    return {
        "passed": passed_count,
        "total": len(valid_test_names),
        "per_test": per_test,
        "output": res.get("output", ""),
    }


def filter_test_code_to_names(full_test_code: str, valid_names: set[str]) -> str:
    """
    Extracts complete top-level pytest test functions matching valid_names,
    including their decorators, multi-line signatures, and docstrings.
    """
    kept_funcs = []
    lines = full_test_code.splitlines()
    current_func = []
    current_name = None

    for line in lines:
        if line.startswith("@") or line.startswith("def ") or line.startswith("async def "):
            if current_func:
                if current_name in valid_names:
                    kept_funcs.append("\n".join(current_func).rstrip())
                current_func = []
                current_name = None

            match = re.match(r"(?:async\s+)?def\s+(test_[A-Za-z0-9_]+)\s*\(", line)
            current_name = match.group(1) if match else None
            current_func = [line]
        elif current_func:
            if line and not line[0].isspace() and (
                line.startswith("def ") or line.startswith("async def ")
                or line.startswith("class ")
            ):
                if current_name in valid_names:
                    kept_funcs.append("\n".join(current_func).rstrip())
                current_func = []
                current_name = None
            else:
                current_func.append(line)

    if current_func and current_name in valid_names:
        kept_funcs.append("\n".join(current_func).rstrip())

    return "\n\n".join(kept_funcs)


def get_active_model() -> str:
    """
    Selects gemini-2.5-flash by default, or auto-falls back to available flash models
    (gemini-3.1-flash-lite, gemini-3.8-flash) if 2.5-flash is retired (404) or experiencing spikes (503).
    """
    configured = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")
    candidates = [configured, "gemini-3.1-flash-lite", "gemini-3.8-flash"]
    for cand in candidates:
        try:
            client.models.generate_content(model=cand, contents="test")
            return cand
        except Exception as e:
            err = str(e).lower()
            if any(k in err for k in ["404", "no longer available", "not found", "503", "unavailable"]):
                continue
            return cand
    return "gemini-3.1-flash-lite"


async def run_judge_pipeline(
    original_code: str,
    prosecutor_code: str,
    defender_code: str,
    model_name: str,
    agent_config: Any,
    extra_instructions: str = "",
):
    """
    Shared Judge pipeline:
    1. Generates reference code + pytest test suite with Gemini JSON schema
    2. Validates tests against reference code in the sandbox
    3. Runs validated tests concurrently across original, prosecutor, defender
    4. Emits 'tests' SSE event
    5. Computes winner in Python
    6. Generates 1-line verdict reason
    7. Emits 'verdict' SSE event
    8. Streams full Judge deliberation explanation
    """
    yield f"data: {json.dumps({'agent': 'status', 'text': 'Judge is generating and validating test suite...'})}\n\n"
    await asyncio.sleep(0.5)

    judge_schema = {
        "type": "OBJECT",
        "properties": {
            "mode": {"type": "STRING", "enum": ["function", "script"]},
            "reference_code": {"type": "STRING"},
            "tests": {"type": "STRING"},
        },
        "required": ["mode", "reference_code", "tests"],
    }
    judge_gen_config = types.GenerateContentConfig(
        temperature=0.0,
        response_mime_type="application/json",
        response_schema=judge_schema,
    )

    test_gen_prompt = (
        "You are the Judge Agent creating an automated pytest test harness.\n"
        "Analyze the user's ORIGINAL code to deduce what it was clearly trying to do.\n"
        f"{extra_instructions}"
        "Return a JSON object with:\n"
        "1. \"mode\": \"script\" if the code prints/reads input at top level (e.g. Hello World, top-level print loops); \"function\" if it defines functions or classes.\n"
        "2. \"reference_code\": Your OWN completely correct implementation of what the original code intended to do.\n"
        "3. \"tests\": 5-6 pytest test functions (plain asserts only, no external libraries) covering standard and edge cases.\n"
        "   - If function mode: tests import nothing (harness prepends 'from solution import *') and call the functions directly with asserts.\n"
        "   - If script mode: tests use helper `run_solution(stdin_text=\"\")` which returns `(stdout, returncode)`. Assert on stdout (using .strip() or expected content) and returncode == 0. Do NOT import solution in script mode.\n\n"
        f"Original Code:\n{original_code}"
    )

    async def generate_judge_tests():
        resp = await client.aio.models.generate_content(
            model=model_name,
            contents=test_gen_prompt,
            config=judge_gen_config,
        )
        return json.loads(resp.text)

    parsed_judge = await call_gemini_with_retry(generate_judge_tests)
    mode = parsed_judge.get("mode", "function")
    reference_code = parsed_judge.get("reference_code", "")
    raw_tests = parsed_judge.get("tests", "")

    print(f"[JUDGE TEST PLAN] mode: {mode}, raw test length: {len(raw_tests)}")

    # Validate tests against reference_code
    ref_result = await asyncio.to_thread(sandbox.run_in_docker, reference_code, raw_tests, mode)
    ref_per_test = ref_result.get("per_test", {})
    valid_test_names = [name for name, status in ref_per_test.items() if status == "PASSED"]

    print(f"[VALIDATION ON REFERENCE] Passed {len(valid_test_names)} tests: {valid_test_names}")

    # If fewer than 3 valid tests remain, regenerate once
    if len(valid_test_names) < 3:
        print("[VALIDATION WARNING] Fewer than 3 valid tests. Regenerating once...")
        try:
            parsed_judge = await call_gemini_with_retry(generate_judge_tests)
            mode = parsed_judge.get("mode", "function")
            reference_code = parsed_judge.get("reference_code", "")
            raw_tests = parsed_judge.get("tests", "")
            ref_result = await asyncio.to_thread(sandbox.run_in_docker, reference_code, raw_tests, mode)
            ref_per_test = ref_result.get("per_test", {})
            valid_test_names = [name for name, status in ref_per_test.items() if status == "PASSED"]
        except Exception as e:
            print(f"[REGEN ERROR]: {e}")

    # Fallback to test function names from raw_tests if validation couldn't pass 3
    if not valid_test_names:
        func_matches = re.findall(r"def\s+(test_[A-Za-z0-9_]+)\s*\(", raw_tests)
        if func_matches:
            valid_test_names = func_matches[:5]
            validated_test_code = raw_tests
        else:
            raise RuntimeError("Judge test generation failed validation: no valid test functions could be produced.")
    else:
        validated_test_code = filter_test_code_to_names(raw_tests, set(valid_test_names))
        if not validated_test_code.strip():
            validated_test_code = raw_tests

    # Run validated tests concurrently across original, prosecutor, defender
    original_task = asyncio.to_thread(run_tests_for_candidate, original_code, validated_test_code, mode, valid_test_names)
    prosecutor_task = asyncio.to_thread(run_tests_for_candidate, prosecutor_code, validated_test_code, mode, valid_test_names)
    defender_task = asyncio.to_thread(run_tests_for_candidate, defender_code, validated_test_code, mode, valid_test_names)

    orig_results, pros_results, def_results = await asyncio.gather(original_task, prosecutor_task, defender_task)

    print(f"[TEST RESULTS] Original: {orig_results['passed']}/{len(valid_test_names)}, Prosecutor: {pros_results['passed']}/{len(valid_test_names)}, Defender: {def_results['passed']}/{len(valid_test_names)}")

    # Emit tests SSE event
    tests_event_data = {
        "agent": "tests",
        "mode": mode,
        "test_code": validated_test_code,
        "results": {
            "original": orig_results,
            "prosecutor": pros_results,
            "defender": def_results,
        },
    }
    yield f"data: {json.dumps(tests_event_data)}\n\n"

    # Compute winner in Python
    p_pass = pros_results["passed"]
    d_pass = def_results["passed"]
    if p_pass > d_pass:
        winner = "Prosecutor"
    elif d_pass > p_pass:
        winner = "Defender"
    else:
        winner = "Tie"

    # Verdict reason prompt
    verdict_reason_prompt = (
        f"Given that the calculated winner is {winner} with Prosecutor passing {p_pass}/{len(valid_test_names)} tests and Defender passing {d_pass}/{len(valid_test_names)} tests, "
        "write exactly ONE plain sentence explaining the reason for this outcome."
    )
    reason_resp = await call_gemini_with_retry(
        client.aio.models.generate_content,
        model=model_name,
        contents=verdict_reason_prompt,
        config=types.GenerateContentConfig(temperature=0.2, max_output_tokens=100),
    )
    verdict_reason = reason_resp.text.strip().replace("\n", " ") if reason_resp.text else f"{winner} selected based on pytest test score ({p_pass} vs {d_pass})."

    # Emit verdict event
    yield f"data: {json.dumps({'agent': 'verdict', 'winner': winner, 'reason': verdict_reason})}\n\n"

    # Judge evaluation prompt
    judge_eval_prompt = (
        "You are the Judge Agent giving your official verdict on the debugging trial.\n"
        "Your audience is a beginner who has never seen this code.\n"
        "Based on the REAL automated pytest execution results below, explain why the winner won or why it was a tie in under 120 words.\n"
        "- Name specific test cases that passed or failed.\n"
        "- If both Prosecutor and Defender wrote working fixes and tied, state that honestly.\n"
        "- Your FIRST sentence must be a concise, one-sentence summary of the decision (e.g. 'Both candidates tied by passing all edge-case tests.').\n\n"
        f"Mode: {mode}\n"
        f"Validated Test Cases: {', '.join(valid_test_names)}\n"
        f"Original Code ({orig_results['passed']}/{len(valid_test_names)} passed):\n{orig_results['per_test']}\n\n"
        f"Prosecutor Fix ({pros_results['passed']}/{len(valid_test_names)} passed):\n{pros_results['per_test']}\nFailure output: {pros_results['output'][:400] if pros_results['passed'] < len(valid_test_names) else 'None'}\n\n"
        f"Defender Fix ({def_results['passed']}/{len(valid_test_names)} passed):\n{def_results['per_test']}\nFailure output: {def_results['output'][:400] if def_results['passed'] < len(valid_test_names) else 'None'}\n\n"
        f"Calculated Winner: {winner}"
    )

    judge_full_text = ""

    async def stream_judge():
        return await client.aio.models.generate_content_stream(
            model=model_name, contents=judge_eval_prompt, config=agent_config
        )

    # Stream Judge explanation
    async for chunk in stream_with_retry(stream_judge):
        text = chunk.text or ""
        if not text:
            continue
        judge_full_text += text
        yield f"data: {json.dumps({'agent': 'judge', 'text': text})}\n\n"

    print(f"[JUDGE RAW VERDICT]: {verdict_reason} | Full: {judge_full_text[:80]}...")


@app.post("/debug/stream")
async def swarm_debug_stream(request: CodeRequest):
    async def event_generator():
        original_code = request.code
        test_cases_text = "None provided. Deduce intended behavior from original code."
        model_name = get_active_model()
        agent_config = types.GenerateContentConfig(
            temperature=0.3,
            max_output_tokens=4096,
            thinking_config=types.ThinkingConfig(thinking_budget=512),
        )

        try:
            # ==========================================
            # 1. PROSECUTOR AGENT
            # ==========================================
            yield f"data: {json.dumps({'agent': 'status', 'text': 'Prosecutor is analyzing the code...'})}\n\n"
            prosecutor_prompt = (
                "You are the Prosecutor Agent in a three-agent debugging panel. Your voice is precise and exact: "
                "state findings as claims tied to specific lines, inputs and outputs.\n"
                "The audience is a beginner, so use plain English and define any jargon you must use.\n\n"
                "TASK\n"
                "Analyze the ORIGINAL code and the SUPPLIED TEST CASES. Decide whether the code has a genuine bug.\n"
                "- Base every claim on the code and tests below. Do not invent bugs. If the original already satisfies the tests "
                "and its evident intent, say \"No bugs found\" and return the ORIGINAL code unchanged.\n"
                "- You cannot run code. NEVER claim or imply that any code passed or will pass tests. Only the backend execution "
                "system can establish that. Use wording such as \"should\" or \"is intended to\", and walk through the logic instead.\n\n"
                "RESPONSE FORMAT (keep the explanation under 200 words in total)\n"
                "1. Root cause: the exact line(s) or logic that fail, and why. Name at least one supplied test it affects, "
                "with the input, the expected output, and what the original code would produce.\n"
                "2. Why the fix works: how your change addresses that root cause specifically.\n"
                "3. Assumptions: any assumption you made about intended behavior that the tests do not settle. "
                "If there are none, write \"None\".\n"
                "4. The COMPLETE corrected program in exactly one ```python fenced block.\n\n"
                "CODE REQUIREMENTS\n"
                "- The program must be complete and executable, and must expose `solve(input_data)`.\n"
                "- Preserve the original behavior and structure wherever it was not buggy. Make the smallest change that fixes the root cause.\n"
                "- Do not add unrelated refactors, new dependencies, or debug prints.\n\n"
                f"ORIGINAL CODE:\n{original_code}\n\n"
                f"SUPPLIED TEST CASES:\n{test_cases_text}"
)

            prosecutor_output = ""

            async def stream_prosecutor():
                return await client.aio.models.generate_content_stream(
                    model=model_name, contents=prosecutor_prompt, config=agent_config
                )

            async for chunk in stream_with_retry(stream_prosecutor):
                text = chunk.text or ""
                if not text:
                    continue
                prosecutor_output += text
                yield f"data: {json.dumps({'agent': 'prosecutor', 'text': text})}\n\n"

            print(f"[PROSECUTOR RAW OUTPUT]: {prosecutor_output[:100]}...")

            prosecutor_code = extract_code(prosecutor_output)
            # If no code was extracted, execute repair call
            if not prosecutor_code:
                repair_prompt = (
                    "Return ONLY the complete corrected Python code in one ```python block for the following task/explanation:\n\n"
                    f"Code:\n{original_code}\n\n"
                    f"Explanation:\n{prosecutor_output}"
                )
                repair_resp = await call_gemini_with_retry(
                    client.aio.models.generate_content,
                    model=model_name,
                    contents=repair_prompt,
                    config=agent_config,
                )
                repair_text = repair_resp.text or ""
                prosecutor_code = extract_code(repair_text) or repair_text.strip()
                if repair_text:
                    append_chunk = f"\n\n```python\n{prosecutor_code}\n```"
                    yield f"data: {json.dumps({'agent': 'prosecutor', 'text': append_chunk})}\n\n"

            # DELAY BEFORE DEFENDER (0.5s)
            yield f"data: {json.dumps({'agent': 'status', 'text': 'Defender is getting ready...'})}\n\n"
            await asyncio.sleep(0.5)

            # ==========================================
            # 2. DEFENDER AGENT
            # ==========================================
            defender_prompt = (
                "You are the Defender Agent. Your role is to be a strict but fair CRITIC of the Prosecutor's response. "
                "Your voice is skeptical, specific and professional. You are not the Prosecutor's ally, and you do not "
                "agree by default. You also do not disagree just to disagree.\n\n"
                "SCOPE\n"
                "- Do NOT diagnose or fix the original code from scratch. Your job is to examine the Prosecutor's diagnosis, "
                "reasoning, assumptions and proposed code. Use the original code and the supplied tests only as the reference "
                "for checking the Prosecutor's claims.\n"
                "- Address the Prosecutor's actual statements directly, for example \"The Prosecutor claims X, but...\" "
                "or \"The Prosecutor's check of Y holds because...\".\n\n"
                "WHAT TO EXAMINE\n"
                "- Mistakes or gaps in the diagnosis: does the stated root cause really explain the failure?\n"
                "- Unsupported claims or assumptions about intended behavior that the code or tests do not justify.\n"
                "- Edge cases the proposed code mishandles (empty input, zero, negatives, very large values, wrong types, "
                "whitespace, whatever fits the program).\n"
                "- Regressions: behavior the original handled correctly that the fix might break.\n"
                "- Whether the fix matches the behavior the supplied tests expect.\n\n"
                "RULES\n"
                "- Each criticism must be concrete: cite the Prosecutor's claim or line of code, give a specific input, "
                "and say what the Prosecutor's code would produce and why that is wrong. Never be vague.\n"
                "- Do not invent flaws. If the Prosecutor's work holds up, say what you examined and why it is convincing.\n"
                "- You cannot run code. NEVER claim or imply that either program passed or will pass tests. "
                "Only the backend execution system can establish that.\n\n"
                "RESPONSE FORMAT\n"
                "Your very first line MUST be exactly \"VERDICT: CONCEDE\" or \"VERDICT: CHALLENGE\".\n\n"
                "- If CONCEDE: In under 120 words, list what you examined in the Prosecutor's diagnosis and code, and why it "
                "holds up. Then provide your COMPLETE alternative program in one ```python block. Since you found no "
                "meaningful flaw, say so and explain why a different implementation is unnecessary (it may be identical "
                "to the Prosecutor's code).\n"
                "- If CHALLENGE: In under 120 words, name each specific flaw in the Prosecutor's reasoning or code, with the "
                "concrete input or claim involved and why it fails. Then provide your COMPLETE improved program in one "
                "```python block, and briefly explain each meaningful difference from the Prosecutor's code and why it is justified.\n\n"
                "CODE REQUIREMENTS\n"
                "- Your program must be complete and executable, must expose `solve(input_data)`, and must preserve the "
                "original program's intended behavior and structure.\n\n"
                f"Original Code:\n{original_code}\n\n"
                f"Supplied Test Cases:\n{test_cases_text}\n\n"
                f"Prosecutor's Explanation:\n{prosecutor_output}\n\n"
                f"Prosecutor's Fixed Code:\n{prosecutor_code}"
        )

            defender_output = ""

            async def stream_defender():
                return await client.aio.models.generate_content_stream(
                    model=model_name, contents=defender_prompt, config=agent_config
                )

            async for chunk in stream_with_retry(stream_defender):
                text = chunk.text or ""
                if not text:
                    continue
                defender_output += text
                yield f"data: {json.dumps({'agent': 'defender', 'text': text})}\n\n"

            print(f"[DEFENDER RAW OUTPUT]: {defender_output[:100]}...")

            first_line = defender_output.strip().splitlines()[0] if defender_output.strip() else ""
            if "CONCEDE" in first_line.upper():
                defender_code = prosecutor_code
            else:
                defender_code = extract_code(defender_output)
                if not defender_code:
                    repair_prompt = (
                        "Return ONLY the complete improved Python code in one ```python block for the following challenge:\n\n"
                        f"Explanation:\n{defender_output}"
                    )
                    repair_resp = await call_gemini_with_retry(
                        client.aio.models.generate_content,
                        model=model_name,
                        contents=repair_prompt,
                        config=agent_config,
                    )
                    repair_text = repair_resp.text or ""
                    defender_code = extract_code(repair_text) or prosecutor_code
                    if repair_text:
                        append_chunk = f"\n\n```python\n{defender_code}\n```"
                        yield f"data: {json.dumps({'agent': 'defender', 'text': append_chunk})}\n\n"

            # ==========================================
            # 3. JUDGE STAGE (Shared Pipeline)
            # ==========================================
            async for judge_event in run_judge_pipeline(
                original_code,
                prosecutor_code,
                defender_code,
                model_name,
                agent_config,
            ):
                yield judge_event

            # FINISHED
            yield f"data: {json.dumps({'agent': 'status', 'text': 'Done'})}\n\n"

        except Exception as e:
            err_msg = str(e)
            print(f"[STREAM ERROR]: {err_msg}")
            yield f"data: {json.dumps({'agent': 'error', 'text': err_msg})}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.post("/debug/repo/stream")
async def repo_debug_stream(request: RepoRequest):
    async def event_generator():
        model_name = get_active_model()
        agent_config = types.GenerateContentConfig(
            temperature=0.3,
            max_output_tokens=4096,
            thinking_config=types.ThinkingConfig(thinking_budget=512),
        )

        try:
            # 1. Parse repository URL & parameters
            try:
                owner, repo, branch_from_url = github_client.parse_repo_url(request.repo_url)
                branch = request.branch or branch_from_url
                limit = max(1, min(10, request.limit))
                token = github_client.resolve_token(request.github_token)
            except ValueError as val_err:
                yield f"data: {json.dumps({'agent': 'error', 'text': str(val_err)})}\n\n"
                return

            # Stage A: Fetch recent commits + details + CI state
            yield f"data: {json.dumps({'agent': 'status', 'text': f'Connecting to GitHub and fetching recent commits for {owner}/{repo}...'})}\n\n"
            raw_commits = await github_client.get_recent_commits(owner, repo, branch=branch, limit=limit, token=token)
            if not raw_commits:
                yield f"data: {json.dumps({'agent': 'error', 'text': f'No commits found in {owner}/{repo}.'})}\n\n"
                return

            yield f"data: {json.dumps({'agent': 'status', 'text': f'Auditing CI check runs and commit diffs across {len(raw_commits)} commits...'})}\n\n"

            async def audit_commit(c: dict) -> dict:
                sha = c["sha"]
                detail, ci = await asyncio.gather(
                    github_client.get_commit_detail(owner, repo, sha, token=token),
                    github_client.get_commit_ci(owner, repo, sha, token=token),
                )
                return {
                    "sha": sha,
                    "short_sha": sha[:7],
                    "message": detail["message"],
                    "author": detail["author"],
                    "date": detail["date"],
                    "ci_state": ci["ci_state"],
                    "files": [f["filename"] for f in detail["files"]],
                    "additions": detail["additions"],
                    "deletions": detail["deletions"],
                    "ci_summary": ci["summary"],
                    "raw_files": detail["files"],
                }

            commit_records = await asyncio.gather(*[audit_commit(c) for c in raw_commits])

            # Emit 'commits' SSE event
            client_commits = [
                {
                    "sha": c["sha"],
                    "short_sha": c["short_sha"],
                    "message": c["message"],
                    "author": c["author"],
                    "date": c["date"],
                    "ci_state": c["ci_state"],
                    "files": c["files"],
                    "additions": c["additions"],
                    "deletions": c["deletions"],
                }
                for c in commit_records
            ]
            yield f"data: {json.dumps({'agent': 'commits', 'repo': f'{owner}/{repo}', 'commits': client_commits})}\n\n"

            # Check for Python files in recent commits
            all_py_files = []
            for c in commit_records:
                for f in c["raw_files"]:
                    fn = f["filename"]
                    if fn.endswith(".py") and fn not in all_py_files:
                        all_py_files.append(fn)

            if not all_py_files:
                yield f"data: {json.dumps({'agent': 'error', 'text': 'No Python (.py) files were found in recent commits. Verdict AI Repo Audit currently supports Python repositories only.'})}\n\n"
                return

            # Retrieve failed CI log excerpt if any commit is failing
            newest_failing = next((c for c in commit_records if c["ci_state"] == "failing"), None)
            failed_log_excerpt = ""
            if newest_failing:
                failing_sha = newest_failing["short_sha"]
                yield f"data: {json.dumps({'agent': 'status', 'text': f'Retrieving CI failure logs for commit {failing_sha}...'})}\n\n"
                failed_log_excerpt = await github_client.get_failed_log_excerpt(owner, repo, newest_failing["sha"], token=token)

            # Stage B: TRIAGE (One non-streaming Gemini call, temperature 0, JSON schema output)
            yield f"data: {json.dumps({'agent': 'status', 'text': 'Investigator AI is triaging commits to pinpoint suspect commit and file...'})}\n\n"

            triage_schema = {
                "type": "OBJECT",
                "properties": {
                    "suspect_sha": {"type": "STRING"},
                    "suspect_file": {"type": "STRING"},
                    "reason": {"type": "STRING"},
                    "confidence": {"type": "STRING", "enum": ["low", "medium", "high"]},
                    "ci_error_summary": {"type": "STRING"},
                },
                "required": ["suspect_sha", "suspect_file", "reason", "confidence", "ci_error_summary"],
            }
            triage_gen_config = types.GenerateContentConfig(
                temperature=0.0,
                response_mime_type="application/json",
                response_schema=triage_schema,
            )

            # Build concise summaries of commits with patches
            commits_summary_text = ""
            for c in commit_records:
                commits_summary_text += f"\n--- Commit {c['short_sha']} ({c['sha']}) ---\n"
                commits_summary_text += f"Author: {c['author']} | Date: {c['date']} | CI State: {c['ci_state']}\n"
                commits_summary_text += f"Message: {c['message'].strip()}\n"
                commits_summary_text += f"Files: {', '.join(c['files'])}\n"
                if c["ci_summary"]:
                    commits_summary_text += f"CI Summary: {c['ci_summary']}\n"
                for rf in c["raw_files"]:
                    if rf["filename"].endswith(".py") and rf["patch"]:
                        commits_summary_text += f"\nDiff for {rf['filename']}:\n{rf['patch'][:1200]}\n"

            triage_prompt = (
                "You are the Investigator Agent in Verdict AI.\n"
                "Your mission: Examine the recent commits and GitHub Actions CI results to identify the single commit and Python (.py) file most likely responsible for a regression or bug.\n\n"
                "Rules:\n"
                "1. 'suspect_sha' MUST be one of the commit SHAs listed below.\n"
                "2. 'suspect_file' MUST be a valid .py file touched in that commit or recent commits.\n"
                "3. If a commit has failing CI, prioritize that commit and the Python file whose changes correlate to the failure.\n"
                "4. If no commit is failing and nothing looks clearly broken, pick the riskiest commit/file and set confidence to 'low'.\n"
                "5. 'confidence': 'high' (clear CI failure matching file diff), 'medium' (suspicious logic error or untested change), 'low' (clean commits, picking highest risk).\n"
                "6. 'reason': 1-2 concise sentences explaining why this commit and file were selected.\n"
                "7. 'ci_error_summary': 1 concise sentence summarizing the CI failure or potential regression.\n\n"
                f"Available Python files: {', '.join(all_py_files)}\n\n"
                f"Commits Data:\n{commits_summary_text}\n\n"
                f"Failed CI Log Excerpt (if any):\n{failed_log_excerpt or 'None'}"
            )

            async def run_triage():
                resp = await client.aio.models.generate_content(
                    model=model_name,
                    contents=triage_prompt,
                    config=triage_gen_config,
                )
                return json.loads(resp.text)

            triage_result = await call_gemini_with_retry(run_triage)

            suspect_sha = triage_result.get("suspect_sha", "").strip()
            suspect_file = triage_result.get("suspect_file", "").strip()
            triage_reason = triage_result.get("reason", "").strip() or "Identified as primary suspect based on recent changes."
            confidence = triage_result.get("confidence", "medium").lower()
            if confidence not in ("low", "medium", "high"):
                confidence = "medium"
            ci_error_summary = triage_result.get("ci_error_summary", "").strip() or "No active CI failures recorded."

            # Validate suspect_sha against real commit records
            valid_shas = [c["sha"] for c in commit_records]
            chosen_commit = next((c for c in commit_records if c["sha"] == suspect_sha or c["short_sha"] == suspect_sha), None)
            if not chosen_commit:
                chosen_commit = newest_failing if newest_failing else commit_records[0]
                suspect_sha = chosen_commit["sha"]

            # Validate suspect_file against real Python files
            if suspect_file not in all_py_files:
                commit_py = [fn for fn in chosen_commit["files"] if fn.endswith(".py")]
                suspect_file = commit_py[0] if commit_py else all_py_files[0]

            # Emit 'suspect' SSE event
            yield f"data: {json.dumps({'agent': 'suspect', 'sha': suspect_sha, 'short_sha': suspect_sha[:7], 'file': suspect_file, 'reason': triage_reason, 'confidence': confidence, 'ci_error_summary': ci_error_summary})}\n\n"

            # Stage C: Fetch suspect file content at suspect commit
            yield f"data: {json.dumps({'agent': 'status', 'text': f'Loading {suspect_file} at commit {suspect_sha[:7]} from GitHub...'})}\n\n"
            original_code = await github_client.get_file_content(owner, repo, suspect_file, suspect_sha, token=token)

            # Find patch for this file in suspect commit
            file_patch = next((rf["patch"] for rf in chosen_commit["raw_files"] if rf["filename"] == suspect_file), "")

            # Stage D: PROSECUTOR AGENT
            yield f"data: {json.dumps({'agent': 'status', 'text': f'Prosecutor is examining charges for {suspect_file}...'})}\n\n"

            prosecutor_prompt = (
                "You are the Prosecutor Agent in Verdict AI's repository code audit.\n"
                f"Repository: {owner}/{repo}\n"
                f"Suspect Commit: {suspect_sha[:7]} - {chosen_commit['message'].strip()} (Author: {chosen_commit['author']})\n"
                f"Suspect File: {suspect_file}\n"
                f"Investigator Triage Reason: {triage_reason}\n"
                f"CI Error Context: {ci_error_summary}\n"
                f"{('CI Log Excerpt:\n' + failed_log_excerpt[:1000] + '\n\n') if failed_log_excerpt else ''}"
                f"Diff of {suspect_file} in this commit:\n{file_patch or 'No direct diff available.'}\n\n"
                "Your task:\n"
                "1. In 2-3 plain sentences, state which change introduced the bug/flaw and why, citing the CI error when present.\n"
                "2. If the code is already correct and the CI failure is completely external/unrelated, say plainly 'No bugs found in this file' and return the original code unchanged. NEVER invent bugs.\n"
                "3. If there is a bug, give the COMPLETE corrected Python file in exactly one ```python block.\n\n"
                f"File Content ({suspect_file}):\n{original_code}"
            )

            prosecutor_output = ""

            async def stream_prosecutor():
                return await client.aio.models.generate_content_stream(
                    model=model_name, contents=prosecutor_prompt, config=agent_config
                )

            async for chunk in stream_with_retry(stream_prosecutor):
                text = chunk.text or ""
                if not text:
                    continue
                prosecutor_output += text
                yield f"data: {json.dumps({'agent': 'prosecutor', 'text': text})}\n\n"

            prosecutor_code = extract_code(prosecutor_output)
            if not prosecutor_code:
                repair_prompt = (
                    "Return ONLY the complete corrected Python code in one ```python block for the following task/explanation:\n\n"
                    f"Code:\n{original_code}\n\n"
                    f"Explanation:\n{prosecutor_output}"
                )
                repair_resp = await call_gemini_with_retry(
                    client.aio.models.generate_content,
                    model=model_name,
                    contents=repair_prompt,
                    config=agent_config,
                )
                repair_text = repair_resp.text or ""
                prosecutor_code = extract_code(repair_text) or repair_text.strip()
                if repair_text:
                    append_chunk = f"\n\n```python\n{prosecutor_code}\n```"
                    yield f"data: {json.dumps({'agent': 'prosecutor', 'text': append_chunk})}\n\n"

            # DELAY BEFORE DEFENDER (0.5s)
            yield f"data: {json.dumps({'agent': 'status', 'text': 'Defender is reviewing the prosecution charges...'})}\n\n"
            await asyncio.sleep(0.5)

            # Stage E: DEFENDER AGENT
            defender_prompt = (
                "You are the Defender Agent in Verdict AI's repository code audit.\n"
                f"Repository: {owner}/{repo}\n"
                f"Suspect Commit: {suspect_sha[:7]} ({chosen_commit['message'].strip()})\n"
                f"Suspect File: {suspect_file}\n"
                f"Triage & CI Context: {triage_reason} | {ci_error_summary}\n\n"
                "Review the Prosecutor's proposed fix and accusation.\n"
                "Your very first line MUST be exactly \"VERDICT: CONCEDE\" or \"VERDICT: CHALLENGE\".\n\n"
                "- If CONCEDE: The Prosecutor's accusation and fix are correct. Briefly explain why in under 120 words. Do not provide code; your fix will equal the prosecutor's code.\n"
                "- If CHALLENGE: You may argue the commit is innocent (e.g. the test is wrong, the CI failure is unrelated or flaky, or the prosecutor's fix breaks other behavior), or that the prosecutor's fix is flawed. You MUST name a specific failing input or scenario, and provide a COMPLETE improved Python file in one ```python block.\n\n"
                f"Original File Content ({suspect_file}):\n{original_code}\n\n"
                f"Prosecutor's Explanation:\n{prosecutor_output}\n\n"
                f"Prosecutor's Fixed Code:\n{prosecutor_code}"
            )

            defender_output = ""

            async def stream_defender():
                return await client.aio.models.generate_content_stream(
                    model=model_name, contents=defender_prompt, config=agent_config
                )

            async for chunk in stream_with_retry(stream_defender):
                text = chunk.text or ""
                if not text:
                    continue
                defender_output += text
                yield f"data: {json.dumps({'agent': 'defender', 'text': text})}\n\n"

            first_line = defender_output.strip().splitlines()[0] if defender_output.strip() else ""
            if "CONCEDE" in first_line.upper():
                defender_code = prosecutor_code
            else:
                defender_code = extract_code(defender_output)
                if not defender_code:
                    repair_prompt = (
                        "Return ONLY the complete improved Python code in one ```python block for the following challenge:\n\n"
                        f"Explanation:\n{defender_output}"
                    )
                    repair_resp = await call_gemini_with_retry(
                        client.aio.models.generate_content,
                        model=model_name,
                        contents=repair_prompt,
                        config=agent_config,
                    )
                    repair_text = repair_resp.text or ""
                    defender_code = extract_code(repair_text) or prosecutor_code
                    if repair_text:
                        append_chunk = f"\n\n```python\n{defender_code}\n```"
                        yield f"data: {json.dumps({'agent': 'defender', 'text': append_chunk})}\n\n"

            # Stage F: JUDGE AGENT & SANDBOX EXECUTION (Shared Pipeline)
            async for judge_event in run_judge_pipeline(
                original_code,
                prosecutor_code,
                defender_code,
                model_name,
                agent_config,
                extra_instructions="IMPORTANT: Only this single file is available in the sandbox. Any imports of other local modules in the project cannot be resolved. Keep reference_code and tests strictly self-contained to the logic and functions defined in this single file.\n",
            ):
                yield judge_event

            # Stage G: FINISHED
            yield f"data: {json.dumps({'agent': 'status', 'text': 'Done'})}\n\n"

        except Exception as e:
            err_msg = str(e)
            print(f"[REPO STREAM ERROR]: {err_msg}")
            yield f"data: {json.dumps({'agent': 'error', 'text': err_msg})}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)