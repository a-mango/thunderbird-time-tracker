"""Unit tests for the tray helper's message handling (no D-Bus needed).

Run: npm run test:tray (python3 -m unittest discover -s native/tray)
"""

import io
import struct
import unittest

from time_tracker_tray import clean_status, encode_message, read_message


class Framing(unittest.TestCase):
    def test_round_trip(self):
        message = {"type": "status", "tooltip": {"text": "1:05 · Checkout form validation"}}
        self.assertEqual(read_message(io.BytesIO(encode_message(message))), message)

    def test_two_messages_in_one_read(self):
        stream = io.BytesIO(encode_message({"n": 1}) + encode_message({"n": 2}))
        self.assertEqual(read_message(stream), {"n": 1})
        self.assertEqual(read_message(stream), {"n": 2})
        self.assertIsNone(read_message(stream))

    def test_eof_and_truncated_body(self):
        self.assertIsNone(read_message(io.BytesIO(b"")))
        self.assertIsNone(read_message(io.BytesIO(struct.pack("=I", 10) + b"{}")))

    def test_refuses_huge_messages(self):
        with self.assertRaises(ValueError):
            read_message(io.BytesIO(struct.pack("=I", 50 * 1024 * 1024)))


class Status(unittest.TestCase):
    def test_keeps_valid_fields_and_drops_the_rest(self):
        status = clean_status(
            {
                "running": True,
                "title": "Time Tracker",
                "tooltip": {"title": "Time Tracker", "text": "x" * 900},
                "menu": [
                    {"id": "toggle", "label": "Stop Timer"},
                    {"type": "separator"},
                    {"id": "tracker", "label": "Open", "enabled": False},
                    {"id": 5, "label": "bad id"},
                    "junk",
                ],
            }
        )
        self.assertTrue(status["running"])
        self.assertEqual(len(status["tooltip_text"]), 500)
        self.assertEqual(
            status["menu"],
            [
                {"id": "toggle", "label": "Stop Timer", "enabled": True},
                {"type": "separator"},
                {"id": "tracker", "label": "Open", "enabled": False},
            ],
        )

    def test_a_tooltip_that_is_not_an_object(self):
        self.assertEqual(clean_status({"tooltip": "text"})["tooltip_text"], "")

    def test_defaults_for_an_empty_message(self):
        self.assertEqual(
            clean_status({}),
            {"running": False, "title": "", "tooltip_title": "", "tooltip_text": "", "menu": []},
        )


if __name__ == "__main__":
    unittest.main()
