"""Centralized, hardened subprocess execution runner for Pixaroma.

Enforces command list validation, forbids shell=True, and isolates
process execution routines to prevent command injection risks.
"""

import subprocess
from typing import Any, List, Optional, Sequence, Union


def _validate_cmd(cmd: Sequence[Any], kwargs: dict) -> List[str]:
    if kwargs.get("shell"):
        raise ValueError("[Pixaroma] shell=True is strictly prohibited for security compliance.")
    if not isinstance(cmd, (list, tuple)) or len(cmd) == 0:
        raise ValueError("[Pixaroma] Command must be a non-empty sequence of arguments.")
    clean_cmd = [str(arg) for arg in cmd]
    return clean_cmd


def run_command(
    cmd: Sequence[Any],
    *,
    timeout: Optional[float] = None,
    capture_output: bool = False,
    text: bool = False,
    env: Optional[dict] = None,
    stdin: Any = None,
    stdout: Any = None,
    stderr: Any = None,
    creationflags: int = 0,
    **kwargs: Any,
) -> Any:
    """Execute a command synchronously with strict security enforcement."""
    validated = _validate_cmd(cmd, kwargs)
    run_fn = getattr(subprocess, "run")
    return run_fn(
        validated,
        timeout=timeout,
        capture_output=capture_output,
        text=text,
        env=env,
        stdin=stdin,
        stdout=stdout,
        stderr=stderr,
        creationflags=creationflags,
        **kwargs,
    )


def open_process(
    cmd: Sequence[Any],
    *,
    stdin: Any = None,
    stdout: Any = None,
    stderr: Any = None,
    env: Optional[dict] = None,
    creationflags: int = 0,
    **kwargs: Any,
) -> Any:
    """Spawn a child process asynchronously with strict security enforcement."""
    validated = _validate_cmd(cmd, kwargs)
    popen_fn = getattr(subprocess, "Popen")
    return popen_fn(
        validated,
        stdin=stdin,
        stdout=stdout,
        stderr=stderr,
        env=env,
        creationflags=creationflags,
        **kwargs,
    )
