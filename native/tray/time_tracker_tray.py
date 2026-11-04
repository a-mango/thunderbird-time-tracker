#!/usr/bin/python3
"""Time Tracker tray helper (Linux): a StatusNotifierItem with a menu, driven by the add-on.

Thunderbird starts this program through native messaging (runtime.connectNative) and keeps the
connection open while it runs. The add-on sends the timer status; the helper shows it as a tray
icon (waybar, swaybar, KDE, GNOME with the AppIndicator extension) and sends clicks and menu
choices back. When Thunderbird closes the connection (stdin EOF), the helper exits and the icon
goes away.

Protocol (native messaging framing: 4-byte native-endian length + UTF-8 JSON):
  add-on -> helper  {"type": "status", "running": bool, "title": str,
                     "tooltip": {"title": str, "text": str},
                     "menu": [{"id": str, "label": str, "enabled": bool} | {"type": "separator"}]}
  helper -> add-on  {"type": "ready", "version": int}
                    {"type": "command", "command": "activate" | <menu item id>}

Needs only Python 3 and PyGObject (Gio/GLib), installed by default on Fedora Workstation.
All labels come from the add-on (its _locales), so the helper has no strings of its own.
"""

import json
import os
import struct
import sys

import gi

gi.require_version("Gio", "2.0")
gi.require_version("GLib", "2.0")
from gi.repository import Gio, GLib  # noqa: E402

PROTOCOL_VERSION = 1
MAX_MESSAGE = 1024 * 1024  # Thunderbird's limit towards a host is 4 GB; ours is far smaller.
ITEM_PATH = "/StatusNotifierItem"
MENU_PATH = "/MenuBar"
WATCHER_NAME = "org.kde.StatusNotifierWatcher"
WATCHER_PATH = "/StatusNotifierWatcher"
ICON_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "icons")
ICON_IDLE = "time-tracker-idle"
ICON_RUNNING = "time-tracker-running"

ITEM_XML = """
<node>
  <interface name="org.kde.StatusNotifierItem">
    <property name="Category" type="s" access="read"/>
    <property name="Id" type="s" access="read"/>
    <property name="Title" type="s" access="read"/>
    <property name="Status" type="s" access="read"/>
    <property name="IconName" type="s" access="read"/>
    <property name="IconThemePath" type="s" access="read"/>
    <property name="ToolTip" type="(sa(iiay)ss)" access="read"/>
    <property name="ItemIsMenu" type="b" access="read"/>
    <property name="Menu" type="o" access="read"/>
    <method name="Activate"><arg type="i" direction="in"/><arg type="i" direction="in"/></method>
    <method name="SecondaryActivate">
      <arg type="i" direction="in"/><arg type="i" direction="in"/>
    </method>
    <method name="ContextMenu"><arg type="i" direction="in"/><arg type="i" direction="in"/></method>
    <method name="Scroll"><arg type="i" direction="in"/><arg type="s" direction="in"/></method>
    <signal name="NewTitle"/>
    <signal name="NewIcon"/>
    <signal name="NewToolTip"/>
    <signal name="NewStatus"><arg type="s"/></signal>
  </interface>
</node>
"""

MENU_XML = """
<node>
  <interface name="com.canonical.dbusmenu">
    <property name="Version" type="u" access="read"/>
    <property name="TextDirection" type="s" access="read"/>
    <property name="Status" type="s" access="read"/>
    <property name="IconThemePath" type="as" access="read"/>
    <method name="GetLayout">
      <arg type="i" direction="in"/><arg type="i" direction="in"/><arg type="as" direction="in"/>
      <arg type="u" direction="out"/><arg type="(ia{sv}av)" direction="out"/>
    </method>
    <method name="GetGroupProperties">
      <arg type="ai" direction="in"/><arg type="as" direction="in"/>
      <arg type="a(ia{sv})" direction="out"/>
    </method>
    <method name="GetProperty">
      <arg type="i" direction="in"/><arg type="s" direction="in"/><arg type="v" direction="out"/>
    </method>
    <method name="Event">
      <arg type="i" direction="in"/><arg type="s" direction="in"/>
      <arg type="v" direction="in"/><arg type="u" direction="in"/>
    </method>
    <method name="EventGroup">
      <arg type="a(isvu)" direction="in"/><arg type="ai" direction="out"/>
    </method>
    <method name="AboutToShow"><arg type="i" direction="in"/><arg type="b" direction="out"/></method>
    <method name="AboutToShowGroup">
      <arg type="ai" direction="in"/><arg type="ai" direction="out"/><arg type="ai" direction="out"/>
    </method>
    <signal name="LayoutUpdated"><arg type="u"/><arg type="i"/></signal>
    <signal name="ItemsPropertiesUpdated">
      <arg type="a(ia{sv})"/><arg type="a(ias)"/>
    </signal>
  </interface>
</node>
"""


def read_exact(stream, count):
    """Exactly `count` bytes (an unbuffered read may return fewer), or None at EOF."""
    data = b""
    while len(data) < count:
        chunk = stream.read(count - len(data))
        if not chunk:
            return None
        data += chunk
    return data


def read_message(stream):
    """One native message from a binary stream, or None at EOF."""
    header = read_exact(stream, 4)
    if header is None:
        return None
    (length,) = struct.unpack("=I", header)
    if length > MAX_MESSAGE:
        raise ValueError(f"message too large: {length}")
    body = read_exact(stream, length)
    if body is None:
        return None
    return json.loads(body.decode("utf-8"))


def encode_message(message):
    """A native message (length prefix + JSON) as bytes."""
    body = json.dumps(message, ensure_ascii=False).encode("utf-8")
    return struct.pack("=I", len(body)) + body


def clean_status(message):
    """Validates a status message from the add-on; returns the fields the tray uses."""
    tooltip = message.get("tooltip") or {}
    menu = []
    for item in message.get("menu") or []:
        if not isinstance(item, dict):
            continue
        if item.get("type") == "separator":
            menu.append({"type": "separator"})
        elif isinstance(item.get("id"), str) and isinstance(item.get("label"), str):
            menu.append(
                {
                    "id": item["id"][:64],
                    "label": item["label"][:200],
                    "enabled": item.get("enabled", True) is not False,
                }
            )
    return {
        "running": message.get("running") is True,
        "title": str(message.get("title") or "")[:200],
        "tooltip_title": str(tooltip.get("title") or "")[:200],
        "tooltip_text": str(tooltip.get("text") or "")[:500],
        "menu": menu[:20],
    }


class Tray:
    """The StatusNotifierItem and its dbusmenu on the session bus."""

    def __init__(self, bus, send):
        self.bus = bus
        self.send = send
        self.status = clean_status({})
        self.revision = 1
        self.service = f"org.kde.StatusNotifierItem-{os.getpid()}-1"
        item_info = Gio.DBusNodeInfo.new_for_xml(ITEM_XML).interfaces[0]
        menu_info = Gio.DBusNodeInfo.new_for_xml(MENU_XML).interfaces[0]
        bus.register_object_with_closures2(ITEM_PATH, item_info, self._item_call, self._item_get, None)
        bus.register_object_with_closures2(MENU_PATH, menu_info, self._menu_call, self._menu_get, None)
        Gio.bus_own_name_on_connection(bus, self.service, Gio.BusNameOwnerFlags.NONE, None, None)
        # Register now, and again whenever a watcher (the bar) (re)starts.
        Gio.bus_watch_name_on_connection(
            bus, WATCHER_NAME, Gio.BusNameWatcherFlags.NONE, self._register, None
        )

    # ---- StatusNotifierItem ----
    def _register(self, *_args):
        self.bus.call(
            WATCHER_NAME,
            WATCHER_PATH,
            WATCHER_NAME,
            "RegisterStatusNotifierItem",
            GLib.Variant("(s)", (self.service,)),
            None,
            Gio.DBusCallFlags.NONE,
            -1,
            None,
            None,
        )

    def _item_get(self, _conn, _sender, _path, _iface, name):
        s = self.status
        values = {
            "Category": GLib.Variant("s", "ApplicationStatus"),
            "Id": GLib.Variant("s", "thunderbird-time-tracker"),
            "Title": GLib.Variant("s", s["title"]),
            "Status": GLib.Variant("s", "Active"),
            "IconName": GLib.Variant("s", ICON_RUNNING if s["running"] else ICON_IDLE),
            "IconThemePath": GLib.Variant("s", ICON_DIR),
            "ToolTip": GLib.Variant(
                "(sa(iiay)ss)",
                (
                    ICON_RUNNING if s["running"] else ICON_IDLE,
                    [],
                    s["tooltip_title"],
                    s["tooltip_text"],
                ),
            ),
            "ItemIsMenu": GLib.Variant("b", False),
            "Menu": GLib.Variant("o", MENU_PATH),
        }
        return values.get(name)

    def _item_call(self, _conn, _sender, _path, _iface, method, _params, invocation):
        if method == "Activate":
            self.send({"type": "command", "command": "activate"})
        invocation.return_value(None)

    def _emit(self, path, iface, signal, params=None):
        self.bus.emit_signal(None, path, iface, signal, params)

    # ---- dbusmenu ----
    def _menu_items(self):
        """(id, properties) per menu entry; ids start at 1 (0 is the root)."""
        items = []
        for index, item in enumerate(self.status["menu"], start=1):
            if item.get("type") == "separator":
                props = {"type": GLib.Variant("s", "separator")}
            else:
                props = {
                    "label": GLib.Variant("s", item["label"]),
                    "enabled": GLib.Variant("b", item["enabled"]),
                }
            items.append((index, props))
        return items

    def _layout(self):
        children = [
            GLib.Variant("(ia{sv}av)", (item_id, props, [])) for item_id, props in self._menu_items()
        ]
        root = (0, {"children-display": GLib.Variant("s", "submenu")}, children)
        return GLib.Variant("(u(ia{sv}av))", (self.revision, root))

    def _menu_get(self, _conn, _sender, _path, _iface, name):
        values = {
            "Version": GLib.Variant("u", 3),
            "TextDirection": GLib.Variant("s", "ltr"),
            "Status": GLib.Variant("s", "normal"),
            "IconThemePath": GLib.Variant("as", []),
        }
        return values.get(name)

    def _menu_call(self, _conn, _sender, _path, _iface, method, params, invocation):
        if method == "GetLayout":
            invocation.return_value(self._layout())
        elif method == "GetGroupProperties":
            wanted = set(params.unpack()[0])
            props = [(i, p) for i, p in self._menu_items() if not wanted or i in wanted]
            invocation.return_value(GLib.Variant("(a(ia{sv}))", (props,)))
        elif method == "GetProperty":
            item_id, name = params.unpack()
            props = dict(self._menu_items()).get(item_id, {})
            invocation.return_value(GLib.Variant("(v)", (props.get(name, GLib.Variant("s", "")),)))
        elif method == "Event":
            item_id, event_id, _data, _time = params.unpack()
            self._clicked(item_id, event_id)
            invocation.return_value(None)
        elif method == "EventGroup":
            for item_id, event_id, _data, _time in params.unpack()[0]:
                self._clicked(item_id, event_id)
            invocation.return_value(GLib.Variant("(ai)", ([],)))
        elif method == "AboutToShow":
            invocation.return_value(GLib.Variant("(b)", (False,)))
        elif method == "AboutToShowGroup":
            invocation.return_value(GLib.Variant("(aiai)", ([], [])))
        else:
            invocation.return_value(None)

    def _clicked(self, item_id, event_id):
        if event_id != "clicked":
            return
        menu = self.status["menu"]
        if 1 <= item_id <= len(menu) and menu[item_id - 1].get("id"):
            self.send({"type": "command", "command": menu[item_id - 1]["id"]})

    # ---- Updates from the add-on ----
    def update(self, message):
        previous = self.status
        self.status = clean_status(message)
        iface = "org.kde.StatusNotifierItem"
        if previous["running"] != self.status["running"]:
            self._emit(ITEM_PATH, iface, "NewIcon")
        if previous["title"] != self.status["title"]:
            self._emit(ITEM_PATH, iface, "NewTitle")
        self._emit(ITEM_PATH, iface, "NewToolTip")
        if previous["menu"] != self.status["menu"]:
            self.revision += 1
            self._emit(
                MENU_PATH,
                "com.canonical.dbusmenu",
                "LayoutUpdated",
                GLib.Variant("(ui)", (self.revision, 0)),
            )


def main():
    loop = GLib.MainLoop()
    # Unbuffered: a buffered reader could hold a second message the main loop never hears of.
    stdin = os.fdopen(sys.stdin.fileno(), "rb", buffering=0, closefd=False)
    stdout = sys.stdout.buffer

    def send(message):
        stdout.write(encode_message(message))
        stdout.flush()

    bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
    tray = Tray(bus, send)

    def on_input(_channel, condition):
        if condition & (GLib.IOCondition.HUP | GLib.IOCondition.ERR) and not (
            condition & GLib.IOCondition.IN
        ):
            loop.quit()
            return False
        try:
            message = read_message(stdin)
        except (ValueError, json.JSONDecodeError):
            loop.quit()
            return False
        if message is None:
            loop.quit()
            return False
        if isinstance(message, dict) and message.get("type") == "status":
            tray.update(message)
        return True

    channel = GLib.IOChannel.unix_new(stdin.fileno())
    GLib.io_add_watch(
        channel,
        GLib.PRIORITY_DEFAULT,
        GLib.IOCondition.IN | GLib.IOCondition.HUP | GLib.IOCondition.ERR,
        on_input,
    )
    send({"type": "ready", "version": PROTOCOL_VERSION})
    loop.run()


if __name__ == "__main__":
    main()
