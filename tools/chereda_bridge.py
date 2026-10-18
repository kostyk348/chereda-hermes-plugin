#!/usr/bin/env python3
"""Мост Череда ↔ воркеры.

Череда хранит «чей ход», но сама никого не будит — поэтому лента петель была
пустой: агентов никто не спрашивал. Этот скрипт закрывает разрыв в обе стороны:

* петля, где ход у делающего и дела ещё нет в очереди → заводится карточка
  воркеру (assignee = делающий), в теле — дело, описание и требование дать
  строку `ДОКАЗАТЕЛЬСТВО: <команда>`;
* карточка закрыта, а петля ещё не принята → отчёт воркера уходит в **ленту
  петли**, а найденное доказательство проигрывается через `череда сделать`
  (то есть рукопожатие остаётся настоящим: команда запускается, отпечаток
  пишется).

Ничего не выдумывает: если доказательства в отчёте нет, так и говорит в ленте.
Запуск: `chereda_bridge.py` (разово) или `--dry` (только показать решения).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
from pathlib import Path

CHEREDA = Path(
    "/home/lain/.hermes/profiles/libraressa/workspace/chereda/target/debug/chereda"
)
CARD = re.compile(r"\bt_[0-9a-f]{8}\b")
PROOF = re.compile(r"ДОКАЗАТЕЛЬСТВО:\s*(.+)")
INSTRUCTION = (
    "\n\n---\n"
    "Это петля Череда `#{loop}`. Когда закончишь, приведи в отчёте отдельной "
    "строкой:\n\n    ДОКАЗАТЕЛЬСТВО: <команда, которую можно запустить и которая "
    "подтвердит результат>\n\n"
    "Отчёт попадёт в ленту петли, а команда будет запущена и записана с "
    "отпечатком вывода. Без строки доказательства петля не закроется.\n"
)


def state_path(ledger: Path) -> Path:
    return ledger / ".bridge-state.json"


def load_state(ledger: Path) -> dict:
    path = state_path(ledger)
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}


def save_state(ledger: Path, state: dict) -> None:
    try:
        state_path(ledger).write_text(json.dumps(state, ensure_ascii=False, indent=1), encoding="utf-8")
    except OSError:
        pass


def fingerprint(text: str) -> str:
    return hashlib.sha1(text.encode("utf-8")).hexdigest()[:16]


def run(cmd: list[str], timeout: int = 120) -> tuple[int, str, str]:
    done = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    return done.returncode, done.stdout, done.stderr


def chereda(ledger: Path, *args: str, timeout: int = 120) -> tuple[int, str, str]:
    return run([str(CHEREDA), *args, "--ledger", str(ledger)], timeout)


def loops(ledger: Path) -> list[dict]:
    code, out, err = chereda(ledger, "петли", "--json")
    if code != 0:
        raise SystemExit(f"череда петли: {err.strip() or code}")
    return json.loads(out).get("loops", [])


def kanban(task_id: str) -> dict | None:
    code, out, err = run(["hermes", "kanban", "show", task_id, "--json"], timeout=90)
    if code != 0:
        return None
    try:
        return json.loads(out)
    except json.JSONDecodeError:
        return None


def report_of(card: dict) -> str:
    """Последняя попытка и последний отчёт — то, что воркер сказал о работе."""
    chunks: list[str] = []
    runs = card.get("runs") or []
    if runs:
        last = runs[-1]
        text = (last.get("summary") or last.get("error") or "").strip()
        if text:
            chunks.append(text)
    comments = card.get("comments") or []
    for comment in comments[-2:]:
        body = (comment.get("body") or "").strip()
        if body:
            chunks.append(body)
    return "\n\n".join(chunks)


def proof_of(*texts: str) -> str | None:
    for text in texts:
        found = PROOF.search(text or "")
        if found:
            line = found.group(1).strip().strip("`").strip()
            if line:
                return line
    return None


def act(ledger: Path, *args: str, dry: bool) -> None:
    printable = " ".join(args)
    if dry:
        print(f"  [сухо] череда {printable}")
        return
    code, out, err = chereda(ledger, *args)
    text = (out.strip() or err.strip()).splitlines()[0] if (out.strip() or err.strip()) else ""
    mark = "✓" if code == 0 else "✗"
    print(f"  {mark} череда {printable}\n      → {text}")


def create_card(loop: dict, dry: bool) -> str | None:
    body = (loop.get("about") or "").strip()
    body += INSTRUCTION.format(loop=loop["id"])
    args = [
        "hermes",
        "kanban",
        "create",
        loop["cause"][:120],
        "--body",
        body,
        "--assignee",
        loop["performer"],
        "--idempotency-key",
        f"chereda-loop-{loop['id']}",
        "--created-by",
        "chereda-bridge",
        "--json",
    ]
    if dry:
        print(f"  [сухо] завести карточку делающему {loop['performer']}: {loop['cause'][:60]}")
        return None
    code, out, err = run(args, timeout=120)
    if code != 0:
        print(f"  ✗ не завелась карточка: {err.strip()[:160]}")
        return None
    try:
        created = json.loads(out)
    except json.JSONDecodeError:
        print(f"  ✗ странный ответ канбана: {out[:120]}")
        return None
    task_id = created.get("task_id") or created.get("id") or ""
    print(f"  ✓ карточка {task_id} заведена делающему {loop['performer']}")
    return task_id


def main() -> int:
    parser = argparse.ArgumentParser(description="Мост Череда ↔ воркеры")
    parser.add_argument("--ledger", default=os.environ.get("CHEREDA_LEDGER", "~/.chereda"))
    parser.add_argument("--dry", action="store_true", help="только показать решения")
    args = parser.parse_args()
    ledger = Path(args.ledger).expanduser()

    state = load_state(ledger)
    items = loops(ledger)
    opened = [l for l in items if l.get("turn") != "none"]
    print(f"петель открытых: {len(opened)} ({ledger})")

    for loop in opened:
        print(f"#{loop['id']} {loop['cause'][:64]}")
        found = CARD.search(loop.get("cause") or "")
        card = kanban(found.group(0)) if found else None

        if card:
            task = card.get("task") or {}
            status = (task.get("status") or card.get("status") or "").strip()
            if status == "done" and loop.get("state") not in ("принято", "снято"):
                report = report_of(card)
                proof = proof_of(report)
                mark = fingerprint(f"{report}\n{proof or ''}")
                seen = state.get(str(loop["id"]))
                if seen == mark:
                    print(f"  карточка {found.group(0)} уже возвращена в ленту — второй раз не говорю")
                    continue
                print(f"  карточка {found.group(0)} закрыта → отчёт в ленту")
                if report:
                    act(ledger, "сказать", "--id", str(loop["id"]), "--who", loop["performer"],
                        "--text", report, dry=args.dry)
                else:
                    act(ledger, "сказать", "--id", str(loop["id"]), "--who", loop["performer"],
                        "--text", "карточка закрыта, но отчёта в ней нет", dry=args.dry)
                if proof:
                    act(ledger, "сделать", "--id", str(loop["id"]), "--who", loop["performer"],
                        "--proof", proof, dry=args.dry)
                else:
                    act(ledger, "сказать", "--id", str(loop["id"]), "--who", loop["performer"],
                        "--text", "доказательства в отчёте нет — ход оставляю за делающим",
                        dry=args.dry)
                if not args.dry:
                    state[str(loop["id"])] = mark
                    save_state(ledger, state)
            else:
                print(f"  карточка {found.group(0)} в работе ({status}) — жду")
            continue

        if loop.get("turn") == "performer" and loop.get("state") in ("просит", "возражение"):
            task_id = create_card(loop, args.dry)
            act(ledger, "обещать", "--id", str(loop["id"]), "--who", loop["performer"],
                "--for", "3600", dry=args.dry)
            act(ledger, "сказать", "--id", str(loop["id"]), "--who", loop["performer"],
                "--text", f"взялась за дело, карточка {task_id or '(заводится)'}", dry=args.dry)
        else:
            print(f"  ход {loop.get('turn')}, состояние {loop.get('state')} — мосту делать нечего")

    return 0


if __name__ == "__main__":
    sys.exit(main())
