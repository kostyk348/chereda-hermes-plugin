"""Статические проверки desktop-половины плагина Череда.

Файл `desktop/plugin.js` исполняется в рендерере, поэтому гонять его юнит-тестами
дорого. Зато три вещи ломаются молча и проверяются текстом:

1. словари ru и en разъехались (пустые подписи в интерфейсе);
2. `t()` ссылается на ключ, которого нет ни в одном словаре;
3. лента пишет от имени бота, а не того, кто её пишет (баг, который уже был:
   в обработчике «сказать» стоял `who = loop.performer`).

Запуск: `python3 -m unittest discover -s tests -v`.
"""

from __future__ import annotations

import re
import unittest
from pathlib import Path

PLUGIN = Path(__file__).resolve().parents[1] / "desktop" / "plugin.js"


def source() -> str:
    return PLUGIN.read_text(encoding="utf-8")


def locale_block(name: str) -> str:
    text = source()
    match = re.search(rf"const {name} = \{{(.*?)\n\}}", text, re.S)
    if not match:
        raise AssertionError(f"не нашла словарь {name}")

    return match.group(1)


def keys(block: str) -> set[str]:
    return set(re.findall(r"^\s{2}([A-Za-z][A-Za-z0-9]*):", block, re.M))


class Locales(unittest.TestCase):
    def test_both_dictionaries_have_the_same_keys(self) -> None:
        ru = keys(locale_block("RU"))
        en = keys(locale_block("EN"))
        self.assertTrue(ru, "русский словарь пуст")
        self.assertEqual(ru - en, set(), "ключи без перевода на английский")
        self.assertEqual(en - ru, set(), "ключи без русского текста")

    def test_every_t_call_points_at_a_real_key(self) -> None:
        known = keys(locale_block("RU")) | keys(locale_block("EN"))
        used = set(re.findall(r"\bt\('([A-Za-z][A-Za-z0-9]*)'\)", source()))
        missing = {key for key in used if key not in known}
        self.assertEqual(missing, set(), f"t() зовёт несуществующие ключи: {sorted(missing)}")

        # справка собирает подсказки динамически: `${t(`${key}Hint`)}`
        glossary = re.search(r"GLOSSARY = \[([^\]]+)\]", source())
        self.assertIsNotNone(glossary, "не нашла список глаголов для справки")
        for name in re.findall(r"'([a-zA-Z]+)'", glossary.group(1)):
            self.assertIn(f"{name}Hint", known, f"у глагола {name} нет подсказки в словарях")

    def test_no_locale_text_is_empty(self) -> None:
        for name in ("RU", "EN"):
            for line in locale_block(name).splitlines():
                if ":" not in line:
                    continue
                key, _, value = line.partition(":")
                value = value.strip().rstrip(",")
                if not value:
                    continue
                self.assertNotIn(value, ("''", '""'), f"{name}.{key.strip()} пустой")


class FeedAuthor(unittest.TestCase):
    def test_the_feed_speaks_as_the_selected_side(self) -> None:
        text = source()
        self.assertIn("params.who = speaker", text, "лента должна писать от выбранного участника")
        self.assertIn("const speaker = role === 'performer' ? loop.performer : loop.customer", text)
        self.assertNotRegex(
            text,
            r"verb === 'сказать'[\s\S]{0,200}params\.who = loop\.performer",
            "регресс: сообщение снова уйдёт от имени бота",
        )

    def test_identity_switch_exists_and_defaults_to_the_owner(self) -> None:
        text = source()
        self.assertIn("useState('customer')", text, "по умолчанию говорит владелец, а не бот")
        self.assertIn("setRole('performer')", text, "переключение на делающего должно быть")


class Surface(unittest.TestCase):
    def test_only_the_sdk_and_react_are_imported(self) -> None:
        imported = re.findall(r"from '([^']+)'", source())
        allowed = {"@hermes/plugin-sdk", "react", "react/jsx-runtime"}
        self.assertEqual(set(imported) - allowed, set(), "каталог запрещает другие импорты")

    def test_no_dynamic_code(self) -> None:
        text = source()
        for forbidden in ("eval(", "new Function", "import("):
            self.assertNotIn(forbidden, text, f"каталог запрещает {forbidden}")

    def test_enter_sends_from_the_feed_input(self) -> None:
        self.assertIn("e.key === 'Enter'", source(), "Enter должен отправлять сообщение")


if __name__ == "__main__":
    unittest.main()
