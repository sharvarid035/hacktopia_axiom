import os
import json
from dotenv import load_dotenv
from google import genai
from google.genai import types
import sandbox

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))
api_key = os.getenv("GEMINI_API_KEY")
print(f"API KEY loaded: {bool(api_key)}")
client = genai.Client(api_key=api_key)

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
    "Original Code:\nprint(\"Hello, World!\")"
)

resp = client.models.generate_content(
    model="gemini-3.1-flash-lite",
    contents=test_gen_prompt,
    config=judge_gen_config,
)
print("RAW RESPONSE:")
print(resp.text)

parsed = json.loads(resp.text)
mode = parsed.get("mode")
ref_code = parsed.get("reference_code")
tests = parsed.get("tests")

print("\n--- RUNNING IN SANDBOX ---")
res = sandbox.run_in_docker(ref_code, tests, mode)
print("Sandbox result:")
print(res)
