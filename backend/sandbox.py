import os
import re
import subprocess
import sys
import tempfile


from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))


def run_in_docker(code_str: str, test_str: str, mode: str = "function") -> dict:
    """
    Executes pytest tests against the candidate code in an isolated Docker container
    or locally via subprocess if USE_DOCKER is false.
    mode can be "function" or "script".
    Returns:
    {
        "passed": bool,
        "output": str,
        "per_test": {test_name: "PASSED" | "FAILED" | "ERROR"}
    }
    """
    use_docker = os.getenv("USE_DOCKER", "false").lower() in ("true", "1", "yes")

    with tempfile.TemporaryDirectory() as temp_dir:
        # 1. candidate code written to solution.py
        with open(os.path.join(temp_dir, "solution.py"), "w", encoding="utf-8") as f:
            f.write(code_str or "")

        # 2. harness.py containing run_solution for script mode
        harness_code = (
            "import subprocess\n"
            "import sys\n\n"
            "def run_solution(stdin_text=\"\"):\n"
            "    res = subprocess.run(\n"
            "        [sys.executable, \"solution.py\"],\n"
            "        input=stdin_text,\n"
            "        capture_output=True,\n"
            "        text=True,\n"
            "        timeout=5,\n"
            "    )\n"
            "    return res.stdout, res.returncode\n"
        )
        with open(os.path.join(temp_dir, "harness.py"), "w", encoding="utf-8") as f:
            f.write(harness_code)

        # 3. test_solution.py with appropriate header
        if mode == "script":
            header = (
                "import pytest\n"
                "from harness import run_solution\n\n"
                "@pytest.fixture(name=\"run_solution\")\n"
                "def _run_solution_fixture():\n"
                "    return run_solution\n\n"
            )
        else:
            header = "from solution import *\n\n"

        test_file_content = header + test_str
        with open(os.path.join(temp_dir, "test_solution.py"), "w", encoding="utf-8") as f:
            f.write(test_file_content)

        # Identify all expected test function names in test_str
        expected_tests = re.findall(r"def\s+(test_[a-zA-Z0-9_]+)\s*\(", test_str)

        if not use_docker:
            cmd = [
                sys.executable,
                "-m",
                "pytest",
                "test_solution.py",
                "-v",
                "-p",
                "no:cacheprovider",
                "--tb=short",
            ]
            try:
                res = subprocess.run(
                    cmd,
                    cwd=temp_dir,
                    capture_output=True,
                    text=True,
                    timeout=10,
                    encoding="utf-8",
                    errors="replace",
                )
                output = f"{res.stdout or ''}\n{res.stderr or ''}".strip()
                matches = re.findall(r"test_solution\.py::([a-zA-Z0-9_]+)\s+(PASSED|FAILED|ERROR)", output)
                per_test = {name: status for name, status in matches}

                # If collection or import error occurred, assign ERROR to expected tests not yet reported
                if res.returncode != 0 and len(per_test) < len(expected_tests):
                    for name in expected_tests:
                        if name not in per_test:
                            per_test[name] = "ERROR"

                return {
                    "passed": res.returncode == 0,
                    "output": output,
                    "per_test": per_test,
                }
            except subprocess.TimeoutExpired:
                per_test = {name: "FAILED" for name in expected_tests}
                return {
                    "passed": False,
                    "output": "Execution timed out (10s limit exceeded).",
                    "per_test": per_test,
                }
            except Exception as e:
                per_test = {name: "ERROR" for name in expected_tests}
                return {
                    "passed": False,
                    "output": f"Local execution error: {str(e)}",
                    "per_test": per_test,
                }

        # Docker execution
        cmd = [
            "docker",
            "run",
            "--rm",
            "--network",
            "none",
            "--memory",
            "256m",
            "--cpus",
            "0.5",
            "-v",
            f"{temp_dir}:/home/sandboxuser/app:ro",
            "-w",
            "/home/sandboxuser/app",
            "code-sandbox",
            "pytest",
            "test_solution.py",
            "-v",
            "-p",
            "no:cacheprovider",
            "--tb=short",
        ]

        try:
            res = subprocess.run(cmd, capture_output=True, text=True, timeout=15)
            output = f"{res.stdout or ''}\n{res.stderr or ''}".strip()
            matches = re.findall(r"test_solution\.py::([a-zA-Z0-9_]+)\s+(PASSED|FAILED|ERROR)", output)
            per_test = {name: status for name, status in matches}

            if res.returncode != 0 and len(per_test) < len(expected_tests):
                for name in expected_tests:
                    if name not in per_test:
                        per_test[name] = "ERROR"

            return {
                "passed": res.returncode == 0,
                "output": output,
                "per_test": per_test,
            }
        except subprocess.TimeoutExpired:
            per_test = {name: "FAILED" for name in expected_tests}
            return {
                "passed": False,
                "output": "Execution timed out (15s limit exceeded).",
                "per_test": per_test,
            }
        except FileNotFoundError:
            per_test = {name: "ERROR" for name in expected_tests}
            return {
                "passed": False,
                "output": "Docker command not found. Set USE_DOCKER=false to run pytest locally.",
                "per_test": per_test,
            }
        except Exception as e:
            per_test = {name: "ERROR" for name in expected_tests}
            return {
                "passed": False,
                "output": f"Docker execution error: {str(e)}",
                "per_test": per_test,
            }