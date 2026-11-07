"""Route KWin's native global shortcuts to the Electron parent over private stdio."""
import json
from pathlib import Path
import signal
import sys
import tempfile
from gi.repository import Gio, GLib

pid = int(sys.argv[1])
bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
loop = GLib.MainLoop()
script_name = f'copytype-shortcuts-{pid}'
temporary = tempfile.TemporaryDirectory(prefix='copytype-shortcuts-')
script_loaded = False
kwin_owner = bus.call_sync('org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus', 'GetNameOwner', GLib.Variant('(s)', ('org.kde.KWin',)), None, Gio.DBusCallFlags.NONE, 5000, None).unpack()[0]

def emit(message):
    print(json.dumps(message), flush=True)

def dispatch(_connection, sender, _path, _interface, _method, parameters, invocation):
    if sender != kwin_owner:
        invocation.return_dbus_error('org.copytype.Desktop.AccessDenied', 'Only KWin can dispatch these shortcuts.')
        return
    action = parameters.unpack()[0]
    if action not in ('toggle', 'cancel'):
        invocation.return_dbus_error('org.copytype.Desktop.InvalidAction', 'Unknown shortcut.')
        return
    emit({'event': 'action', 'action': action})
    invocation.return_value(None)

interface = Gio.DBusNodeInfo.new_for_xml('<node><interface name="org.copytype.Desktop"><method name="Dispatch"><arg type="s" direction="in"/></method></interface></node>').interfaces[0]
bus.register_object('/org/copytype/Desktop', interface, dispatch, None, None)

def acquired(_connection, _name):
    global script_loaded
    try:
        script = Path(temporary.name) / 'shortcuts.js'
        script.write_text(Path(__file__).with_suffix('.js').read_text().replace('__COPYTYPE_PID__', str(pid)))
        script_id = bus.call_sync('org.kde.KWin', '/Scripting', 'org.kde.kwin.Scripting', 'loadScript', GLib.Variant('(ss)', (str(script), script_name)), None, Gio.DBusCallFlags.NONE, 5000, None).unpack()[0]
        if script_id < 0:
            raise RuntimeError('Could not load the KDE shortcut bindings.')
        script_loaded = True
        bus.call_sync('org.kde.KWin', f'/Scripting/Script{script_id}', 'org.kde.kwin.Script', 'run', None, None, Gio.DBusCallFlags.NONE, 5000, None)
        # Qt's modifiers and key constants, as returned by KGlobalAccel.
        for name, key in [('CopyTypeToggle', 0x0C000020), ('CopyTypeCancel', 0x0D000003)]:
            keys = bus.call_sync('org.kde.kglobalaccel', '/kglobalaccel', 'org.kde.KGlobalAccel', 'shortcut', GLib.Variant('(as)', (['kwin', name, '', ''],)), None, Gio.DBusCallFlags.NONE, 5000, None).unpack()[0]
            if key not in keys:
                raise RuntimeError(f'{name} has no matching KDE shortcut. Check CopyType shortcuts in System Settings → Keyboard → Shortcuts → KWin.')
        emit({'event': 'ready'})
    except Exception as error:
        emit({'event': 'error', 'message': str(error)})
        loop.quit()

def lost(_connection, _name):
    emit({'event': 'error', 'message': 'Could not acquire the CopyType shortcut service.'})
    loop.quit()

Gio.bus_own_name_on_connection(bus, f'org.copytype.Desktop.p{pid}', Gio.BusNameOwnerFlags.NONE, acquired, lost)
GLib.io_add_watch(sys.stdin, GLib.IO_HUP | GLib.IO_ERR, lambda *_: (loop.quit(), False)[1])
signal.signal(signal.SIGTERM, lambda *_: loop.quit())
try:
    loop.run()
finally:
    if script_loaded:
        try:
            bus.call_sync('org.kde.KWin', '/Scripting', 'org.kde.kwin.Scripting', 'unloadScript', GLib.Variant('(s)', (script_name,)), None, Gio.DBusCallFlags.NONE, 3000, None)
        except Exception:
            pass
    temporary.cleanup()
