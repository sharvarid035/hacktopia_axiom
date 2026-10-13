import os
import subprocess
import sys
import tempfile


def run_in_docker(code_str: str, test_str: str) -> dict:
    """
    Spins up an isolated container with no network access,
    runs pytest against the code, and destroys the container.
    If USE_DOCKER is false, runs pytest locally via subprocess.
    """
    use_docker = os.getenv("USE_DOCKER", "true").lower() in ("true", "1", "yes")

    with tempfile.TemporaryDirectory() as temp_dir:
        # 1. Write the code files to a temporary folder
        with open(os.path.join(temp_dir, "solution.py"), "w", encoding="utf-8") as f:
            f.write(code_str)

        test_file_content = test_str
        if "from solution import" not in test_str:
            test_file_content = f"from solution import *\n\n{test_str}"

        with open(os.path.join(temp_dir, "test_solution.py"), "w", encoding="utf-8") as f:
            f.write(test_file_content)

        if not use_docker:
            # Run pytest locally with subprocess inside temp dir with 10s timeout
            cmd = [
                sys.executable,
                "-m",
                "pytest",
                "test_solution.py",
                "-v",
                "--tb=short",
                "-p",
                "no:cacheprovider",
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
                return {
                    "passed": res.returncode == 0,
                    "output": output,
                }
            except subprocess.TimeoutExpired:
                return {
                    "passed": False,
                    "output": "Execution timed out (10s limit exceeded).",
                }
            except Exception as e:
                return {
                    "passed": False,
                    "output": f"Local execution error: {str(e)}",
                }

        # 2. Execute via Docker CLI with strict limits
        cmd = [
            "docker",
            "run",
            "--rm",
            "--network",
            "none",  # No internet access
            "--memory",
            "256m",  # Max 256MB RAM
            "--cpus",
            "0.5",  # Max 50% single CPU core
            "-v",
            f"{temp_dir}:/home/sandboxuser/app:ro",  # Read-only mount
            "-w",
            "/home/sandboxuser/app",
            "code-sandbox",
            "pytest",
            "test_solution.py",
            "-v",
            "--tb=short",
            "-p",
            "no:cacheprovider",
        ]

        try:
            res = subprocess.run(cmd, capture_output=True, text=True, timeout=15)
            output = f"{res.stdout or ''}\n{res.stderr or ''}".strip()
            return {
                "passed": res.returncode == 0,
                "output": output,
            }
        except subprocess.TimeoutExpired:
            return {
                "passed": False,
                "output": "Execution timed out (15s limit exceeded).",
            }
        except FileNotFoundError:
            return {
                "passed": False,
                "output": "Docker command not found. Set USE_DOCKER=false to run pytest locally.",
            }
        except Exception as e:
            return {
                "passed": False,
                "output": f"Docker execution error: {str(e)}",
            }