"""Auto-responder: when a card gets a new message, the server invokes the user's
own agent CLI headlessly (claude -p / codex exec) to drain the inbox and reply.

This is the "real-time" in-card chat: the canvas can't push into a running agent
(MCP is client-initiated), so instead the server spawns a one-shot, non-interactive
agent run per burst of messages. It uses the user's logged-in CLI (their
subscription) — no API key. Debounced; never blocks the request; on failure it
leaves the messages unprocessed and drops a note so the manual path still works.

Tuning (env):
  LOOM_AGENT          auto (default) | claude | codex | off
  LOOM_AGENT_CMD      full command override; use {prompt} as the placeholder
  LOOM_AGENT_DEBOUNCE seconds to batch messages before spawning (default 2)
  LOOM_AGENT_TIMEOUT  max seconds per run (default 300)
"""

from __future__ import annotations

import os
import shlex
import shutil
import subprocess
import threading
from pathlib import Path
from typing import Any, Callable, Optional

REPO_ROOT = Path(__file__).resolve().parent.parent.parent  # loom-canvas/

PROMPT = (
    "You are auto-responding to new messages on the local Loom research canvas. "
    "Call the loom tool `get_inbox`. For each card it returns, call "
    "`get_card_thread(id)`, then act on the user's latest message: do the research "
    "or revision they ask for using your tools, or push back with evidence if they "
    "are challenging a point (don't just agree). Then call `reply_to_card(id, <concise "
    "reply>)`; if the card's deliverable changed, also call `set_node_result`. Repeat "
    "until `get_inbox` is empty, then stop. Act autonomously — do not ask me anything."
)


class AgentRunner:
    def __init__(self, store: Any, emit: Callable[[dict[str, Any]], None]) -> None:
        self.store = store
        self._emit = emit
        self._lock = threading.Lock()
        self._running = False
        self._rerun = False
        self._timer: Optional[threading.Timer] = None
        self.kind = self._detect()
        forced = os.environ.get("LOOM_AGENT", "auto").lower()
        self.enabled = forced not in ("off", "0", "false") and self.kind is not None
        self.last_error: Optional[str] = None
        self.debounce = float(os.environ.get("LOOM_AGENT_DEBOUNCE", "2.0"))

    # ---------- detection / status ----------
    @staticmethod
    def _detect() -> Optional[str]:
        forced = os.environ.get("LOOM_AGENT", "auto").lower()
        if forced in ("off", "0", "false"):
            return None
        if forced in ("claude", "codex"):
            return forced if shutil.which(forced) else None
        if shutil.which("claude"):
            return "claude"
        if shutil.which("codex"):
            return "codex"
        return None

    def status(self) -> dict[str, Any]:
        return {
            "available": self.kind is not None,
            "kind": self.kind,
            "enabled": self.enabled,
            "running": self._running,
            "last_error": self.last_error,
        }

    def _emit_status(self) -> None:
        self._emit({"type": "agent", **self.status()})

    def set_enabled(self, on: bool) -> dict[str, Any]:
        self.enabled = bool(on) and self.kind is not None
        self._emit_status()
        if self.enabled:
            self.notify()
        return self.status()

    # ---------- trigger ----------
    def notify(self) -> None:
        """Called when a user message lands on a card. Debounced spawn."""
        if not self.enabled or not self.kind:
            return
        with self._lock:
            if self._running:
                self._rerun = True
                return
            if self._timer:
                self._timer.cancel()
            self._timer = threading.Timer(self.debounce, self._spawn)
            self._timer.daemon = True
            self._timer.start()

    @staticmethod
    def _child_env(port: str) -> dict[str, str]:
        """Env for the spawned CLI. Strip vars that hijack a nested agent's auth —
        when the Loom server is started from inside a Claude Code / Codex session it
        inherits ANTHROPIC_BASE_URL (a gateway → 403) and CLAUDE_CODE_* markers, which
        would break the spawned `claude -p`. Stripping them makes the nested CLI use
        the user's own normal login. No-op when the server runs in a clean terminal."""
        strip_prefixes = ("CLAUDE_CODE", "CLAUDE_AGENT", "CODEX_")
        strip_exact = {
            "CLAUDECODE", "ANTHROPIC_BASE_URL", "OPENAI_BASE_URL",
            "AI_AGENT", "CLAUDE_EFFORT", "BAGGAGE",
        }
        env = {
            k: v
            for k, v in os.environ.items()
            if k not in strip_exact and not any(k.startswith(p) for p in strip_prefixes)
        }
        env["LOOM_SERVER_URL"] = f"http://127.0.0.1:{port}"
        return env

    def _build_cmd(self, prompt: str) -> list[str]:
        override = os.environ.get("LOOM_AGENT_CMD")
        if override:
            return [a.replace("{prompt}", prompt) for a in shlex.split(override)]
        if self.kind == "claude":
            return ["claude", "-p", prompt, "--permission-mode", "bypassPermissions"]
        return ["codex", "exec", "--full-auto", prompt]

    def _spawn(self) -> None:
        with self._lock:
            if self._running:
                self._rerun = True
                return
            try:
                if not self.store.inbox():
                    return
            except Exception:
                return
            self._running = True
            self._rerun = False
        self._emit_status()
        threading.Thread(target=self._run, daemon=True).start()

    def _run(self) -> None:
        try:
            cmd = self._build_cmd(PROMPT)
            exe = shutil.which(cmd[0]) or cmd[0]
            cmd[0] = exe
            port = os.environ.get("LOOM_PORT", "8765")
            env = self._child_env(port)
            proc = subprocess.run(
                cmd,
                cwd=str(REPO_ROOT),
                capture_output=True,
                text=True,
                stdin=subprocess.DEVNULL,  # don't let `claude -p` block waiting on stdin
                timeout=float(os.environ.get("LOOM_AGENT_TIMEOUT", "300")),
                env=env,
            )
            if proc.returncode != 0:
                self.last_error = (proc.stderr or proc.stdout or "agent exited nonzero").strip()[-600:]
                self._fallback_notice()
            else:
                self.last_error = None
        except FileNotFoundError:
            self.last_error = f"'{self.kind}' CLI not found on PATH"
            self._fallback_notice()
        except subprocess.TimeoutExpired:
            self.last_error = "agent run timed out"
            self._fallback_notice()
        except Exception as e:  # noqa: BLE001
            self.last_error = f"{type(e).__name__}: {e}"
            self._fallback_notice()
        finally:
            with self._lock:
                self._running = False
                rerun = self._rerun
                self._rerun = False
            self._emit_status()
            # Only continue if a NEW message arrived during this run (rerun). Do NOT
            # re-spawn just because the inbox is still non-empty — a run that can't
            # drain it (e.g. tools misconfigured) would otherwise loop forever and
            # burn quota. A run is expected to drain the whole inbox in one pass.
            if self.enabled and self.last_error is None and rerun:
                self.notify()

    def _fallback_notice(self) -> None:
        """On failure leave user messages unprocessed; tell them to go manual.

        Keep the card note short; the full error stays in status().last_error
        (shown in the Auto toggle's tooltip)."""
        short = (self.last_error or "unknown").strip().splitlines()[0][:140]
        try:
            for item in self.store.inbox():
                self.store.add_message(
                    item["node"],
                    "(自动回复这次没成功：" + short
                    + " —— 可在 Claude Code / Codex 里说“处理画布留言”手动处理。)",
                    role="assistant",
                )
        except Exception:
            pass
