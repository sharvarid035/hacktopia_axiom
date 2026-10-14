import asyncio
import json
import os
import re
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from google import genai
from google.genai import types
from dotenv import load_dotenv
from pydantic import BaseModel

try:
    from backend import sandbox
except ImportError:
    import sandbox

load_dotenv()

app = FastAPI(title="Swarm Debugger API")


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
    """
    if not code or not code.strip():
        per_test = {name: "FAILED" for name in valid_test_names}
        return {
            "passed": 0,
            "total": len(valid_test_names),
            "per_test": per_test,
            "output": "No code provided to execute.",
        }

    res = sandbox.run_in_docker(code, test_code, mode=mode)
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
    Extract complete pytest test functions matching valid_names.
    Preserves multiline bodies and blank lines.
    """
    lines = full_test_code.splitlines()
    kept_funcs = []
    current_func = []
    current_name = None

    for line in lines:
        # A new top-level function starts at column zero.
        if line.startswith("def test_") or line.startswith("async def test_"):
            if current_func and current_name in valid_names:
                kept_funcs.append("\n".join(current_func).rstrip())

            match = re.match(r"(?:async\s+)?def\s+(test_[A-Za-z0-9_]+)\s*\(", line)
            current_name = match.group(1) if match else None
            current_func = [line]
        elif current_func:
            # Stop at the next top-level definition or class.
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



@app.post("/debug/stream")
async def swarm_debug_stream(request: CodeRequest):
    async def event_generator():
        original_code = request.code
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

            # DELAY BEFORE JUDGE (0.5s)
            yield f"data: {json.dumps({'agent': 'status', 'text': 'Judge is generating and validating test suite...'})}\n\n"
            await asyncio.sleep(0.5)

            # ==========================================
            # 3. JUDGE STAGE
            # ==========================================
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
                parsed_judge = await call_gemini_with_retry(generate_judge_tests)
                mode = parsed_judge.get("mode", "function")
                reference_code = parsed_judge.get("reference_code", "")
                raw_tests = parsed_judge.get("tests", "")
                ref_result = await asyncio.to_thread(sandbox.run_in_docker, reference_code, raw_tests, mode)
                ref_per_test = ref_result.get("per_test", {})
                valid_test_names = [name for name, status in ref_per_test.items() if status == "PASSED"]

            if len(valid_test_names) < 3:
                raise RuntimeError(f"Judge test generation failed validation: only {len(valid_test_names)} valid tests found.")

            # Filter test code to only validated tests
            validated_test_code = filter_test_code_to_names(raw_tests, set(valid_test_names))
            if not validated_test_code.strip():
                raise RuntimeError(
                    "Judge test validation failed: "
                    "could not extract the validated tests."
    )

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

            # Ask Judge LLM for an honest explanation and 1-line reason based on the REAL test execution
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

            # Retrieve one-line reason first or use stream's first sentence
            # To ensure the verdict reason is LLM-derived, do a quick one-sentence summary call or grab stream
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

            # Stream Judge explanation
            async for chunk in stream_with_retry(stream_judge):
                text = chunk.text or ""
                if not text:
                    continue
                judge_full_text += text
                yield f"data: {json.dumps({'agent': 'judge', 'text': text})}\n\n"

            print(f"[JUDGE RAW VERDICT]: {verdict_reason} | Full: {judge_full_text[:80]}...")

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


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)