"""Череда в интерфейсе Hermes: бэкенд плагина.

Монтируется в `/api/plugins/chereda/`. Ничего не хранит и ничего не решает сам:
каждый запрос — это вызов настоящего CLI `череда`, а правила (не в свой ход не
говорят, отказ только с причиной, предел трём обещаниям) остаются в одном месте,
в самом Череда. Интерфейс не должен уметь больше, чем командная строка.

Переменные окружения:

* `CHEREDA_BIN`    — путь к бинарю (по умолчанию ищется в PATH, затем в клоне);
* `CHEREDA_LEDGER` — каталог среды (по умолчанию `~/.chereda`).
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Body, HTTPException

router = APIRouter()

INSTALL_HINT = (
    "бинарь «череда» не найден в PATH. Поставь его из репозитория Череда: "
    "`cargo install --path .` (или укажи путь в CHEREDA_BIN)"
)

#: Какие ПАРАМЕТРЫ разрешено передавать глаголу. Список глаголов здесь больше не
#: хранится: его знает сам CLI и он же отказывает неизвестному — иначе каждая
#: новая команда требовала бы перезапуска шлюза, а два списка разъезжались бы.
PARAMS = {
    "id", "who", "text", "reason", "proof", "dir", "expect",
    "for", "case", "customer", "performer", "class", "about", "now",
}
VERB = re.compile(r"^[а-яёa-z]{3,20}$")


def binary() -> str | None:
    """Где бинарь Череда. В каталоге плагин не знает путей чужой машины."""
    explicit = os.environ.get("CHEREDA_BIN")
    if explicit:
        return explicit if Path(explicit).exists() else None
    return shutil.which("череда") or shutil.which("chereda")


def ledger() -> Path:
    return Path(os.environ.get("CHEREDA_LEDGER", "~/.chereda")).expanduser()


def call(args: list[str], timeout: int = 60) -> dict[str, Any]:
    """Один вызов Череда. Список аргументов, никакого shell."""
    found = binary()
    if not found:
        raise HTTPException(503, INSTALL_HINT)
    cmd = [found, *args, "--ledger", str(ledger())]
    try:
        done = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout,
            cwd=str(ledger().parent),
        )
    except FileNotFoundError:
        raise HTTPException(503, INSTALL_HINT)
    except subprocess.TimeoutExpired:
        raise HTTPException(504, "Череда не ответила за отведённое время")
    return {
        "code": done.returncode,
        "stdout": done.stdout,
        "stderr": done.stderr,
        "cmd": " ".join(cmd[:-2]),
    }


def loops_json(*args: str) -> dict[str, Any]:
    result = call([*args, "--json"])
    if result["code"] != 0:
        raise HTTPException(500, result["stderr"].strip() or "Череда вернула ошибку")
    try:
        return json.loads(result["stdout"])
    except json.JSONDecodeError as err:
        raise HTTPException(500, f"Череда вернула не JSON: {err}")


@router.get("/health")
def health() -> dict[str, Any]:
    """Отвечает ли Череда и какая у неё среда — нужно панели, чтобы не молчать."""
    result = call(["петли"], timeout=20)
    ok = result["code"] == 0
    return {
        "ok": ok,
        "binary": binary() or "",
        "ledger": str(ledger()),
        "detail": (result["stdout"] if ok else result["stderr"]).strip()[:400],
    }


# ── связь с канбаном ─────────────────────────────────────────────────────────
# В деле может стоять id карточки канбана (`t_92381a7a`). Тогда панель обязана
# показать и её: попытки, отчёты, последние строки — чтобы петля была не беднее
# карточки, к которой привык владелец.

import re as _re
import time as _time

_TASK_ID = _re.compile(r"\bt_[0-9a-f]{8}\b")
_LINK_CACHE: dict[str, tuple[float, dict]] = {}
_LINK_TTL = 60.0


def linked_task_id(cause: str) -> str | None:
    found = _TASK_ID.search(cause or "")
    return found.group(0) if found else None


def kanban_task(task_id: str) -> dict | None:
    """Сводка карточки канбана через `hermes kanban show --json` (60 с кеша)."""
    now = _time.time()
    hit = _LINK_CACHE.get(task_id)
    if hit and now - hit[0] < _LINK_TTL:
        return hit[1]
    hermes = shutil.which("hermes") or "hermes"
    try:
        done = subprocess.run(
            [hermes, "kanban", "show", task_id, "--json"],
            capture_output=True,
            text=True,
            timeout=45,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    if done.returncode != 0:
        return None
    try:
        raw = json.loads(done.stdout)
    except json.JSONDecodeError:
        return None
    task = raw.get("task") or {}
    runs = [
        {
            "status": r.get("status") or "",
            "outcome": r.get("outcome") or "",
            "summary": (r.get("summary") or r.get("error") or "").strip(),
            "started": r.get("started_at"),
            "ended": r.get("ended_at"),
        }
        for r in (raw.get("runs") or [])
    ]
    comments = [
        {
            "author": c.get("author") or "",
            "body": (c.get("body") or "").strip(),
            "at": c.get("created_at"),
        }
        for c in (raw.get("comments") or [])
    ]
    out = {
        "id": task_id,
        "title": task.get("title") or "",
        "status": task.get("status") or "",
        "assignee": task.get("assignee") or "",
        "priority": task.get("priority") or 0,
        "body": task.get("body") or "",
        "created": task.get("created_at"),
        "started": task.get("started_at"),
        "completed": task.get("completed_at"),
        "runs": runs[-4:],
        "comments": comments[-4:],
    }
    _LINK_CACHE[task_id] = (now, out)
    return out


def with_links(payload: dict) -> dict:
    for loop in payload.get("loops") or []:
        task_id = linked_task_id(loop.get("cause") or "")
        loop["linked"] = kanban_task(task_id) if task_id else None
    return payload


@router.get("/loops")
def loops() -> dict[str, Any]:
    """Открытые петли, а к петлям с id карточки — ещё и сводка этой карточки."""
    return with_links(loops_json("петли"))


@router.get("/circle/{who}")
def circle(who: str) -> dict[str, Any]:
    """Петли, где ход у `who`."""
    return with_links(loops_json("круг", "--who", who))


@router.post("/act")
def act(payload: dict = Body(...)) -> dict[str, Any]:
    """Сделать ход: глагол + параметры. Отвечает тем, что напечатал CLI."""
    verb = str(payload.get("verb") or "").strip()
    if not VERB.match(verb):
        raise HTTPException(400, f"глагол «{verb}» не похож на глагол Череда")
    args = [verb]
    for key, value in (payload.get("params") or {}).items():
        name = str(key)
        if name not in PARAMS:
            raise HTTPException(400, f"параметр «{name}» не разрешён")
        if value is None or value == "":
            continue
        args += [f"--{name}", str(value)]
    return call(args)
