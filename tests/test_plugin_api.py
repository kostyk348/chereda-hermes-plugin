"""Тесты бэкенда плагина Череда.

Гоняются без сети и без настоящего Череда: подкладываем поддельный бинарь,
который пишет свои аргументы в журнал. Так проверяется именно то, что легко
сломать незаметно — какие аргументы уходят в CLI, что делается с плохим JSON,
с ненулевым кодом, с таймаутом и с несуществующим бинарём.

Запуск: из корня плагина `python3 -m unittest discover -s tests -v`.
"""

from __future__ import annotations

import json
import os
import stat
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "dashboard"))

FAKE = """#!/bin/sh
printf '%s\\0' "$@" >> "$CHEREDA_ARGS_LOG"
case "$1" in
  петли) printf '%s\\n' '{"now":7,"loops":[]}' ; exit 0 ;;
  круг)  printf '%s\\n' '{"who":"forgessa","now":7,"loops":[]}' ; exit 0 ;;
  сор)   printf '%s\\n' 'это не json' ; exit 0 ;;
  упал)  printf '%s\\n' 'boom' >&2 ; exit 3 ;;
  сон)   sleep 3 ; exit 0 ;;
  *)     printf '%s\\n' "#ok $*" ; exit 0 ;;
esac
"""


def setUpModule() -> None:
    global TMP, BIN
    TMP = tempfile.mkdtemp(prefix="chereda-api-")
    BIN = Path(TMP) / "череда"
    BIN.write_text(FAKE, encoding="utf-8")
    BIN.chmod(BIN.stat().st_mode | stat.S_IEXEC)
    os.environ["CHEREDA_BIN"] = str(BIN)
    os.environ["CHEREDA_ARGS_LOG"] = str(Path(TMP) / "argv.log")
    os.environ["CHEREDA_LEDGER"] = str(Path(TMP) / "ledger")


def args_log() -> list[str]:
    """Аргументы последнего вызова: пишем их через NUL, чтобы перевод строки
    внутри текста не выглядел как два аргумента."""
    path = Path(os.environ["CHEREDA_ARGS_LOG"])
    if not path.exists():
        return []
    raw = path.read_text(encoding="utf-8")
    return [item for item in raw.split("\0") if item]


class VerbGate(unittest.TestCase):
    def setUp(self) -> None:
        import plugin_api

        self.api = plugin_api

    def test_accepts_every_real_verb(self) -> None:
        for verb in ("просить", "обещать", "отказать", "сделать", "принять", "возразить", "снять", "сказать", "описать", "проверить"):
            self.assertTrue(self.api.valid_verb(verb), verb)

    def test_rejects_injection_shaped_verbs(self) -> None:
        for bad in ("--ledger", "петли; rm -rf /", "просить --ledger /tmp", "", "  ", "a", "петли\n"):
            self.assertFalse(self.api.valid_verb(bad), repr(bad))

    def test_unknown_parameter_is_refused(self) -> None:
        with self.assertRaises(Exception) as ctx:
            self.api.act({"verb": "сказать", "params": {"id": 1, "who": "ты", "text": "ок", "ledger": "/etc"}})
        self.assertEqual(getattr(ctx.exception, "status_code", None), 400)

    def test_missing_binary_gives_503_with_instructions(self) -> None:
        os.environ["CHEREDA_BIN"] = str(Path(TMP) / "нет-такого")
        try:
            with self.assertRaises(Exception) as ctx:
                self.api.health()
            self.assertEqual(getattr(ctx.exception, "status_code", None), 503)
            self.assertIn("PATH", getattr(ctx.exception, "detail", ""))
        finally:
            os.environ["CHEREDA_BIN"] = str(BIN)


class ArgumentShape(unittest.TestCase):
    def setUp(self) -> None:
        import plugin_api

        self.api = plugin_api
        Path(os.environ["CHEREDA_ARGS_LOG"]).write_text("", encoding="utf-8")

    def test_dash_dash_is_always_used_for_flags(self) -> None:
        self.api.act({"verb": "обещать", "params": {"id": 3, "who": "forgessa", "for": 600}})
        sent = args_log()
        self.assertIn("--id", sent)
        self.assertIn("--who", sent)
        self.assertIn("--for", sent)
        self.assertIn("--ledger", sent, "среда передаётся всегда")

    def test_empty_values_are_dropped_not_sent_empty(self) -> None:
        self.api.act({"verb": "принять", "params": {"id": 1, "who": "ты", "reason": ""}})
        sent = args_log()
        self.assertNotIn("--reason", sent, "пустое значение не превращается во флаг")

    def test_text_with_newlines_stays_one_argument(self) -> None:
        payload = "первая строка\nвторая строка"
        self.api.act({"verb": "сказать", "params": {"id": 2, "who": "ты", "text": payload}})
        sent = args_log()
        self.assertIn(payload, sent, "перевод строки не рвёт аргумент на два")


class ResultHandling(unittest.TestCase):
    def setUp(self) -> None:
        import plugin_api

        self.api = plugin_api

    def test_non_zero_exit_is_returned_not_raised(self) -> None:
        out = self.api.act({"verb": "упал", "params": {}})
        self.assertEqual(out["code"], 3)
        self.assertIn("boom", out["stderr"])

    def test_broken_json_from_cli_is_a_500(self) -> None:
        with self.assertRaises(Exception) as ctx:
            self.api.loops_json("сор")
        self.assertEqual(getattr(ctx.exception, "status_code", None), 500)
        self.assertIn("не JSON", getattr(ctx.exception, "detail", ""))

    def test_timeout_is_a_504(self) -> None:
        with self.assertRaises(Exception) as ctx:
            self.api.call(["сон"], timeout=1)
        self.assertEqual(getattr(ctx.exception, "status_code", None), 504)

    def test_empty_ledger_is_still_valid_json(self) -> None:
        data = self.api.loops_json("петли")
        self.assertEqual(data["loops"], [])
        self.assertIn("now", data)


class Links(unittest.TestCase):
    def setUp(self) -> None:
        import plugin_api

        self.api = plugin_api

    def test_task_id_is_found_inside_a_sentence(self) -> None:
        self.assertEqual(self.api.linked_task_id("чинить (t_92381a7a) сегодня"), "t_92381a7a")

    def test_lookalikes_are_not_taken_for_ids(self) -> None:
        for text in ("t_123", "t_ZZZZZZZZ", "без id", ""):
            self.assertIsNone(self.api.linked_task_id(text), text)


class LedgerPath(unittest.TestCase):
    def test_env_sets_the_ledger(self) -> None:
        import plugin_api

        self.assertTrue(str(plugin_api.ledger()).endswith("ledger"))
        self.assertIn("chereda-api-", str(plugin_api.ledger()))


if __name__ == "__main__":
    unittest.main()
