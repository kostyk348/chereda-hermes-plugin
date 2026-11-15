#!/usr/bin/env python3
"""Мост Череда ↔ воркеры.

Череда хранит «чей ход», но сама никого не будит — поэтому лента петель была
пустой: агентов никто не спрашивал. Этот скрипт закрывает разрыв в обе стороны:

* петля, где ход у делающего и дела ей ещё нет в очереди → заводится карточка
  воркеру (assignee = делающий), в теле — дело, описание и просьба привести
  строку `ДОКАЗАТЕЛЬСТВО: <команда>`;
* карточка закрыта, а петля ещё не принята → отчёт воркера уходит в **ленту
  петли**, а доказательство проигрывается через `череда сделать` — но только
  если команда есть в списке разрешённых.

# Почему доказательство не запускается само

Команду в отчёте пишет модель. Передать её в `sh -c` без согласия человека —
значит превратить текст модели в команду на хосте в обход согласований Hermes.
Поэтому:

* разрешённые команды лежат в `.bridge-allow.txt` рядом с реестром, по одной на
  строку, `#` — комментарий, в конце можно `*` (префикс — только для простой
  команды без `;`, `|`, `&`, `$`, обратных кавычек, `>` и `<`);
* файла нет → список пуст → **ни одна** команда модели не выполняется;
* неразрешённое доказательство не теряется: оно уходит в ленту петли как
  «ждёт разрешения», ход остаётся у делающего;
* человек разрешает командой `--approve "<команда>"` и следующий проход моста
  проигрывает доказательство по-настоящему.

Ничего не выдумывает: если доказательства в отчёте нет, так и говорит в ленте.
Запуск: `chereda_bridge.py` (разово) или `--dry` (только показать решения).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

CARD = re.compile(r"\bt_[0-9a-f]{8}\b")
PROOF = re.compile(r"ДОКАЗАТЕЛЬСТВО:\s*(.+)")
ALLOW_NAME = ".bridge-allow.txt"
INSTRUCTION = (
    "\n\n---\n"
    "Это петля Череда `#{loop}`. Когда закончишь, приведи в отчёте отдельной "
    "строкой:\n\n    ДОКАЗАТЕЛЬСТВО: <команда, которую можно запустить и которая "
    "подтвердит результат>\n\n"
    "Отчёт попадёт в ленту петли. Команда будет запущена и записана с "
    "отпечатком вывода только если владелец заранее разрешил её "
    "(`chereda_bridge.py --approve`); иначе она уйдёт в ленту как «ждёт "
    "разрешения» и ход останется у тебя.\n"
)


def binary() -> Path | None:
    """Где бинарь Череда: `CHEREDA_BIN`, иначе PATH.

    Путь не зашит: в каталоге плагин запускается на чужой машине, где нашего
    `target/debug` нет. Порядок тот же, что в `dashboard/plugin_api.py`.
    """
    explicit = os.environ.get("CHEREDA_BIN")
    if explicit:
        path = Path(explicit).expanduser()
        return path if path.exists() else None
    found = shutil.which("череда") or shutil.which("chereda")
    return Path(found) if found else None


def state_path(ledger: Path) -> Path:
    return ledger / ".bridge-state.json"


def allow_path(ledger: Path) -> Path:
    return ledger / ALLOW_NAME


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


def normalize_command(cmd: str) -> str:
    """Схлопнуть пробелы: «a  b» и «a b» — одна команда."""
    return " ".join((cmd or "").split())


def load_allow(ledger: Path) -> list[str]:
    try:
        raw = allow_path(ledger).read_text(encoding="utf-8")
    except OSError:
        return []
    entries: list[str] = []
    for line in raw.splitlines():
        line = line.strip()
        if line and not line.startswith("#"):
            entries.append(line)
    return entries


#: Что превращает строку в цепочку команд для `sh -c`.
SHELL_METACHARS = frozenset(";|&$`><\n\r")


def has_shell_meta(cmd: str) -> bool:
    return any(ch in SHELL_METACHARS for ch in cmd)


def is_allowed(cmd: str, allow: list[str]) -> bool:
    """Разрешена ли команда. Пустой список — не разрешено ничего.

    Префиксная запись (`python3 -m unittest *`) — это разрешение на семейство
    команд, поэтому она не должна давать дорогу цепочкам: строка с `;`, `|`,
    `&`, `$`, обратной кавычкой, `>`, `<` или переводом строки под префикс не
    подходит. Совпадение — по границе слова: `cargo test *` не разрешает
    `cargo testing`, а точная запись по-прежнему сравнивается целиком.
    """
    raw = cmd or ""
    target = normalize_command(raw)
    if not target:
        return False
    # normalize_command схлопывает пробелы — и перевод строки тоже, поэтому
    # опасные символы ищем на исходной строке, а не только на приведённой
    dangerous = has_shell_meta(raw) or has_shell_meta(target)
    for entry in allow:
        pattern = normalize_command(entry)
        if not pattern:
            continue
        if pattern.endswith("*"):
            prefix = pattern[:-1].rstrip()
            if not prefix or dangerous:
                continue
            if target == prefix or target.startswith(prefix + " "):
                return True
        elif pattern == target:
            return True
    return False


def approve(ledger: Path, cmd: str) -> bool:
    """Добавить команду в разрешённые. Возвращает True, если она новая."""
    cmd = normalize_command(cmd)
    if not cmd:
        return False
    allow = load_allow(ledger)
    if is_allowed(cmd, allow):
        return False
    path = allow_path(ledger)
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8") as handle:
            handle.write(cmd + "\n")
    except OSError as err:
        raise SystemExit(f"не записать {path}: {err}")
    return True


def fingerprint(text: str) -> str:
    return hashlib.sha1(text.encode("utf-8")).hexdigest()[:16]


def run(cmd: list[str], timeout: int = 120) -> tuple[int, str, str]:
    done = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    return done.returncode, done.stdout, done.stderr


def chereda(ledger: Path, *args: str, timeout: int = 120) -> tuple[int, str, str]:
    found = binary()
    if not found:
        raise SystemExit(
            "бинарь «череда» не найден: поставь его (`cargo install --path .`) "
            "или укажи путь в CHEREDA_BIN"
        )
    return run([str(found), *args, "--ledger", str(ledger)], timeout)


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


def handle_proof(ledger: Path, loop: dict, proof: str | None, allow: list[str], dry: bool) -> bool:
    """Решить судьбу доказательства из отчёта. True — команда запущена.

    Здесь и только здесь model-written текст мог бы стать командой на хосте,
    поэтому единственный путь к `череда сделать` — совпадение с разрешённым
    списком. Всё остальное уходит в ленту как заявка на разрешение.
    """
    performer = loop.get("performer") or "?"
    if proof and is_allowed(proof, allow):
        act(ledger, "сделать", "--id", str(loop["id"]), "--who", performer,
            "--proof", proof, dry=dry)
        return True
    if proof:
        print("  ⚠ доказательство модели не запускаю: команды нет в разрешённых")
        act(ledger, "сказать", "--id", str(loop["id"]), "--who", performer,
            "--text",
            "доказательство ждёт разрешения владельца: "
            f"`{proof}`. Разрешить: `chereda_bridge.py --approve \"{proof}\"`",
            dry=dry)
    else:
        act(ledger, "сказать", "--id", str(loop["id"]), "--who", performer,
            "--text", "доказательства в отчёте нет — ход оставляю за делающим",
            dry=dry)
    return False


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
    parser.add_argument(
        "--approve",
        action="append",
        default=[],
        metavar="КОМАНДА",
        help="разрешить доказательство (можно несколько раз); без этого ни одна "
        "команда из отчёта модели не выполняется",
    )
    parser.add_argument("--allow", action="store_true", help="показать разрешённые доказательства")
    args = parser.parse_args()
    ledger = Path(args.ledger).expanduser()

    for cmd in args.approve:
        added = approve(ledger, cmd)
        print(f"{'разрешено' if added else 'уже разрешено'}: {normalize_command(cmd)}")
    if args.allow:
        allow = load_allow(ledger)
        if not allow:
            print(f"разрешённых доказательств нет ({allow_path(ledger)})")
        for entry in allow:
            print(f"  {entry}")
        return 0

    allow = load_allow(ledger)
    state = load_state(ledger)
    items = loops(ledger)
    opened = [l for l in items if l.get("turn") != "none"]
    print(f"петель открытых: {len(opened)} ({ledger})")
    if not allow:
        print(
            "разрешённых доказательств нет: команды из отчётов будут уходить в ленту "
            f"как «ждёт разрешения» ({allow_path(ledger)})"
        )

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
                handle_proof(ledger, loop, proof, allow, args.dry)
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
