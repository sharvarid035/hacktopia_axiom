import asyncio
import base64
import os
import re
import time
from typing import Any, Dict, List, Optional, Tuple
import httpx

# In-memory cache with 5-minute TTL (300 seconds)
_CACHE: Dict[Tuple, Tuple[Any, float]] = {}
CACHE_TTL_SECONDS = 300.0


def _get_from_cache(key: Tuple) -> Optional[Any]:
    now = time.time()
    if key in _CACHE:
        val, expiry = _CACHE[key]
        if now < expiry:
            return val
        del _CACHE[key]
    return None


def _set_in_cache(key: Tuple, val: Any) -> None:
    now = time.time()
    _CACHE[key] = (val, now + CACHE_TTL_SECONDS)


def resolve_token(provided_token: Optional[str]) -> Optional[str]:
    """
    Returns provided_token if given, else os.getenv("GITHUB_TOKEN"), else None.
    NEVER logs or exposes the token.
    """
    if provided_token and provided_token.strip():
        return provided_token.strip()
    env_token = os.getenv("GITHUB_TOKEN")
    if env_token and env_token.strip():
        return env_token.strip()
    return None


def parse_repo_url(url: str) -> Tuple[str, str, Optional[str]]:
    """
    Accepts only https://github.com/{owner}/{repo} (optionally with .git, trailing slash, /tree/{branch}).
    Validates owner and repo with strict regex ^[A-Za-z0-9_.-]+$.
    Rejects anything else to prevent SSRF.
    Returns (owner, repo, branch_or_none).
    """
    if not url or not isinstance(url, str):
        raise ValueError("Repository URL must be a non-empty string.")

    cleaned = url.strip()
    # Must start with https://github.com/
    pattern = r"^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?(?:\/tree\/([A-Za-z0-9_.\-\/]+)|\/?)$"
    match = re.match(pattern, cleaned)
    if not match:
        raise ValueError(
            "Invalid GitHub repository URL. Must be in the format 'https://github.com/owner/repo' (optionally with /tree/branch)."
        )

    owner, repo, branch = match.groups()
    if repo.endswith(".git"):
        repo = repo[:-4]

    ident_pattern = re.compile(r"^[A-Za-z0-9_.-]+$")
    if not ident_pattern.match(owner) or not ident_pattern.match(repo):
        raise ValueError(
            f"Invalid repository owner '{owner}' or name '{repo}'. Only alphanumeric, '.', '-', and '_' characters are permitted."
        )

    return owner, repo, branch if branch else None


async def _request_github(
    client: httpx.AsyncClient,
    method: str,
    endpoint_or_url: str,
    token: Optional[str] = None,
    params: Optional[Dict[str, Any]] = None,
    follow_redirects: bool = True,
) -> httpx.Response:
    """
    Executes an async request to api.github.com with 1 retry on 5xx, 15s timeout,
    and checks rate limits and 404s.
    """
    if endpoint_or_url.startswith("https://"):
        # Strictly verify URL is on api.github.com
        if not endpoint_or_url.startswith("https://api.github.com/"):
            raise ValueError("Direct URLs must target https://api.github.com/")
        url = endpoint_or_url
    else:
        url = f"https://api.github.com{endpoint_or_url}"

    headers = {
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "VerdictAI-RepoAudit/1.0",
    }
    if token:
        headers["Authorization"] = f"Bearer {token}"

    retries = 1
    last_exc = None
    for attempt in range(retries + 1):
        try:
            resp = await client.request(
                method,
                url,
                headers=headers,
                params=params,
                timeout=15.0,
                follow_redirects=follow_redirects,
            )
            # Check rate limit headers
            rate_remaining = resp.headers.get("X-RateLimit-Remaining")
            if rate_remaining == "0" or resp.status_code in (403, 429):
                raise RuntimeError("GitHub rate limit reached. Add a GITHUB_TOKEN.")

            if resp.status_code == 404:
                raise RuntimeError("Repo not found or private (provide a token)")

            if resp.status_code >= 500 and attempt < retries:
                await asyncio.sleep(1.0)
                continue

            return resp
        except (httpx.TimeoutException, httpx.NetworkError) as exc:
            last_exc = exc
            if attempt < retries:
                await asyncio.sleep(1.0)
                continue
            raise RuntimeError(f"Network error communicating with GitHub: {str(exc)}")

    if last_exc:
        raise RuntimeError(f"GitHub request failed: {str(last_exc)}")
    raise RuntimeError("GitHub request failed after retries.")


async def get_recent_commits(
    owner: str,
    repo: str,
    branch: Optional[str] = None,
    limit: int = 5,
    token: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """
    GET /repos/{owner}/{repo}/commits?per_page={limit}&sha={branch}
    """
    limit = max(1, min(10, limit))
    params: Dict[str, Any] = {"per_page": limit}
    if branch:
        params["sha"] = branch

    async with httpx.AsyncClient() as client:
        resp = await _request_github(
            client,
            "GET",
            f"/repos/{owner}/{repo}/commits",
            token=token,
            params=params,
        )
        if resp.status_code != 200:
            raise RuntimeError(f"Failed to fetch commits from GitHub (HTTP {resp.status_code})")
        return resp.json()


async def get_commit_detail(
    owner: str,
    repo: str,
    sha: str,
    token: Optional[str] = None,
) -> Dict[str, Any]:
    """
    GET /repos/{owner}/{repo}/commits/{sha} -> message, author, date, files[]
    Truncate each patch to ~3000 chars and cap at 8 files per commit.
    Cached in-memory for 5 minutes.
    """
    cache_key = (owner, repo, sha, "detail")
    cached = _get_from_cache(cache_key)
    if cached is not None:
        return cached

    async with httpx.AsyncClient() as client:
        resp = await _request_github(
            client,
            "GET",
            f"/repos/{owner}/{repo}/commits/{sha}",
            token=token,
        )
        if resp.status_code != 200:
            raise RuntimeError(f"Failed to fetch commit {sha[:7]} detail (HTTP {resp.status_code})")
        data = resp.json()

        commit_obj = data.get("commit", {})
        author_obj = commit_obj.get("author", {}) or {}
        committer_obj = commit_obj.get("committer", {}) or {}

        message = commit_obj.get("message", "")
        author_name = author_obj.get("name") or committer_obj.get("name") or data.get("author", {}).get("login") or "Unknown"
        date_str = author_obj.get("date") or committer_obj.get("date") or ""

        raw_files = data.get("files", []) or []
        processed_files = []
        for f in raw_files[:8]:
            patch = f.get("patch", "") or ""
            if len(patch) > 3000:
                patch = patch[:3000] + "\n... [diff truncated]"
            processed_files.append({
                "filename": f.get("filename", ""),
                "status": f.get("status", "modified"),
                "additions": f.get("additions", 0),
                "deletions": f.get("deletions", 0),
                "patch": patch,
            })

        detail = {
            "sha": data.get("sha", sha),
            "message": message,
            "author": author_name,
            "date": date_str,
            "additions": data.get("stats", {}).get("additions", 0),
            "deletions": data.get("stats", {}).get("deletions", 0),
            "files": processed_files,
            "parent_sha": data.get("parents", [{}])[0].get("sha") if data.get("parents") else None,
        }
        _set_in_cache(cache_key, detail)
        return detail


async def get_commit_ci(
    owner: str,
    repo: str,
    sha: str,
    token: Optional[str] = None,
) -> Dict[str, Any]:
    """
    GET /repos/{owner}/{repo}/commits/{sha}/check-runs -> list of check runs.
    Summarizes to overall state: 'passing' | 'failing' | 'pending' | 'none'.
    """
    async with httpx.AsyncClient() as client:
        resp = await _request_github(
            client,
            "GET",
            f"/repos/{owner}/{repo}/commits/{sha}/check-runs",
            token=token,
        )
        if resp.status_code != 200:
            return {"ci_state": "none", "check_runs": [], "summary": ""}

        data = resp.json()
        raw_runs = data.get("check_runs", []) or []

        if not raw_runs:
            # Fallback check status API
            status_resp = await _request_github(
                client,
                "GET",
                f"/repos/{owner}/{repo}/commits/{sha}/status",
                token=token,
            )
            if status_resp.status_code == 200:
                status_data = status_resp.json()
                combined_state = status_data.get("state", "none")
                if combined_state == "success":
                    return {"ci_state": "passing", "check_runs": [], "summary": "All combined statuses passed."}
                if combined_state in ("failure", "error"):
                    return {"ci_state": "failing", "check_runs": [], "summary": "Commit status reported failure."}
                if combined_state == "pending":
                    return {"ci_state": "pending", "check_runs": [], "summary": "Commit status pending."}
            return {"ci_state": "none", "check_runs": [], "summary": ""}

        check_runs = []
        has_failure = False
        has_pending = False
        summary_lines = []

        for cr in raw_runs:
            status = cr.get("status", "completed")
            conclusion = cr.get("conclusion")
            name = cr.get("name", "check")
            output = cr.get("output", {}) or {}
            title = output.get("title") or ""
            text_summary = output.get("summary") or ""

            if conclusion in ("failure", "timed_out", "action_required", "cancelled"):
                has_failure = True
                summary_lines.append(f"Check '{name}' failed: {title or conclusion}. {text_summary[:200]}")
            elif status != "completed" or conclusion is None:
                has_pending = True

            check_runs.append({
                "name": name,
                "status": status,
                "conclusion": conclusion,
                "html_url": cr.get("html_url", ""),
                "title": title,
                "summary": text_summary[:400],
            })

        if has_failure:
            ci_state = "failing"
        elif has_pending:
            ci_state = "pending"
        else:
            ci_state = "passing"

        return {
            "ci_state": ci_state,
            "check_runs": check_runs,
            "summary": " | ".join(summary_lines) if summary_lines else "All checks passed.",
        }


async def get_failed_log_excerpt(
    owner: str,
    repo: str,
    sha: str,
    token: Optional[str] = None,
) -> str:
    """
    GET /repos/{owner}/{repo}/actions/runs?head_sha={sha}
    For first failed run, GET /repos/{owner}/{repo}/actions/runs/{run_id}/jobs,
    find the failed job and failed step, then GET /repos/{owner}/{repo}/actions/jobs/{job_id}/logs.
    Returns only the LAST ~60 lines (truncated to 4000 chars).
    If logs unavailable (401/403/404), returns failed step name and annotations instead and continues gracefully.
    """
    try:
        async with httpx.AsyncClient() as client:
            runs_resp = await _request_github(
                client,
                "GET",
                f"/repos/{owner}/{repo}/actions/runs",
                token=token,
                params={"head_sha": sha},
            )
            if runs_resp.status_code != 200:
                return ""
            runs_data = runs_resp.json()
            workflow_runs = runs_data.get("workflow_runs", []) or []

            failed_run = next(
                (r for r in workflow_runs if r.get("conclusion") in ("failure", "timed_out")),
                None,
            )
            if not failed_run:
                return ""

            run_id = failed_run.get("id")
            jobs_resp = await _request_github(
                client,
                "GET",
                f"/repos/{owner}/{repo}/actions/runs/{run_id}/jobs",
                token=token,
            )
            if jobs_resp.status_code != 200:
                return f"Failed run '{failed_run.get('name', 'CI')}' concluded with failure."

            jobs_data = jobs_resp.json()
            jobs = jobs_data.get("jobs", []) or []
            failed_job = next(
                (j for j in jobs if j.get("conclusion") in ("failure", "timed_out")),
                None,
            )
            if not failed_job:
                return f"Workflow run {run_id} failed."

            job_id = failed_job.get("id")
            steps = failed_job.get("steps", []) or []
            failed_step = next(
                (s for s in steps if s.get("conclusion") in ("failure", "timed_out")),
                None,
            )
            step_info = f"Job '{failed_job.get('name')}' step '{failed_step.get('name') if failed_step else 'unknown'}' failed."

            # Attempt to fetch logs
            try:
                log_resp = await _request_github(
                    client,
                    "GET",
                    f"/repos/{owner}/{repo}/actions/jobs/{job_id}/logs",
                    token=token,
                    follow_redirects=True,
                )
                if log_resp.status_code == 200 and log_resp.text:
                    lines = log_resp.text.strip().splitlines()
                    last_lines = lines[-60:] if len(lines) > 60 else lines
                    excerpt = "\n".join(last_lines)
                    if len(excerpt) > 4000:
                        excerpt = excerpt[-4000:]
                    return f"{step_info}\n\nLog excerpt (last lines):\n{excerpt}"
            except Exception:
                pass

            return step_info
    except Exception:
        return ""


async def get_file_content(
    owner: str,
    repo: str,
    path: str,
    ref: str,
    token: Optional[str] = None,
) -> str:
    """
    GET /repos/{owner}/{repo}/contents/{path}?ref={ref}, base64 decode.
    Refuses files over 40 KB.
    Cached in-memory for 5 minutes.
    """
    cache_key = (owner, repo, ref, path, "content")
    cached = _get_from_cache(cache_key)
    if cached is not None:
        return cached

    async with httpx.AsyncClient() as client:
        resp = await _request_github(
            client,
            "GET",
            f"/repos/{owner}/{repo}/contents/{path}",
            token=token,
            params={"ref": ref},
        )
        if resp.status_code != 200:
            raise RuntimeError(f"Could not load file '{path}' at ref '{ref[:7]}' (HTTP {resp.status_code}).")

        data = resp.json()
        size = data.get("size", 0)
        if size > 40960:
            raise ValueError(f"File '{path}' is {size} bytes, exceeding the 40 KB analysis limit.")

        content_b64 = data.get("content", "")
        encoding = data.get("encoding", "base64")
        if encoding == "base64" and content_b64:
            decoded_bytes = base64.b64decode(content_b64)
            content_str = decoded_bytes.decode("utf-8", errors="replace")
        else:
            content_str = content_b64 or ""

        _set_in_cache(cache_key, content_str)
        return content_str
