import subprocess
import tempfile
import os

def run_in_docker(code_str: str, test_str: str) -> dict:
    """
    Spins up an isolated container with no network access,
    runs pytest against the code, and destroys the container.
    """
    with tempfile.TemporaryDirectory() as temp_dir:
        # 1. Write the code files to a temporary folder
        with open(os.path.join(temp_dir, "solution.py"), "w") as f:
            f.write(code_str)
        with open(os.path.join(temp_dir, "test_solution.py"), "w") as f:
            f.write(f"from solution import *\n\n{test_str}")

        # 2. Execute via Docker CLI with strict limits
        cmd = [
            "docker", "run", "--rm",
            "--network", "none",               # No internet access
            "--memory", "256m",                 # Max 256MB RAM
            "--cpus", "0.5",                    # Max 50% single CPU core
            "-v", f"{temp_dir}:/home/sandboxuser/app:ro", # Read-only mount
            "-w", "/home/sandboxuser/app",
            "code-sandbox",
            "pytest", "test_solution.py", "-v", "--tb=short"
        ]

        try:
            res = subprocess.run(cmd, capture_output=True, text=True, timeout=5)
            return {
                "passed": res.returncode == 0,
                "output": res.stdout if res.returncode == 0 else res.stderr or res.stdout
            }
        except subprocess.TimeoutExpired:
            return {
                "passed": False,
                "output": "Execution timed out (5s limit exceeded)."
            }