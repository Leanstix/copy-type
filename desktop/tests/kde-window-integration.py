"""Validate only a disposable CopyType instance's KWin window properties."""
import json
import os
from pathlib import Path
import signal
import subprocess
import tempfile
import time

from gi.repository import Gio, GLib

root = Path(__file__).parents[1]
directory = Path(tempfile.mkdtemp(prefix='copytype-kde-window-test-'))
loop = GLib.MainLoop()
bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
results = []
interface = Gio.DBusNodeInfo.new_for_xml('<node><interface name="org.copytype.WindowTest"><method name="Report"><arg name="result" type="s" direction="in"/></method></interface></node>').interfaces[0]
def report(_connection, _sender, _path, _interface, _method, parameters, invocation):
    results.append(json.loads(parameters.unpack()[0]))
    invocation.return_value(None)
    loop.quit()
bus.register_object('/org/copytype/WindowTest', interface, report, None, None)
owner = Gio.bus_own_name_on_connection(bus, 'org.copytype.WindowTest', Gio.BusNameOwnerFlags.NONE, None, None)
env = {key: value for key, value in os.environ.items() if key != 'ELECTRON_RUN_AS_NODE'}
env['COPYTYPE_RUNTIME_DIR'] = str(directory / 'runtime')
log = open(directory / 'app.log', 'w')
launcher = subprocess.Popen(['bash', str(root / 'start-kde-private.sh'), '--user-data-dir=' + str(directory / 'profile')], env=env, start_new_session=True, stdout=log, stderr=log)
script_name = 'copytype-window-integration-' + str(os.getpid())
try:
    for _ in range(160):
        while GLib.MainContext.default().pending():
            GLib.MainContext.default().iteration(False)
        if launcher.poll() is not None:
            raise RuntimeError((directory / 'app.log').read_text())
        registry = directory / 'runtime' / 'desktop.json'
        if registry.exists():
            info = json.loads(registry.read_text())
            pid = int(Path(info['socket']).stem.split('-')[-1])
            break
        time.sleep(.1)
    else:
        raise RuntimeError('CopyType startup timed out')
    time.sleep(2)
    script = directory / 'inspect.js'
    def inspect():
        results.clear()
        subprocess.run(['qdbus6','org.kde.KWin','/Scripting','org.kde.kwin.Scripting.unloadScript',script_name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        script.write_text('''const result = [];
for (const window of workspace.windowList()) {
 if (window.pid === PID) result.push({excluded:window.excludeFromCapture,taskbar:window.skipTaskbar,switcher:window.skipSwitcher,pager:window.skipPager,visible:!window.hidden&&!window.minimized});
}
callDBus('org.copytype.WindowTest','/org/copytype/WindowTest','org.copytype.WindowTest','Report',JSON.stringify(result));
'''.replace('PID', str(pid)))
        script_id = subprocess.check_output(['qdbus6','org.kde.KWin','/Scripting','org.kde.kwin.Scripting.loadScript',str(script),script_name], text=True).strip()
        subprocess.run(['qdbus6','org.kde.KWin','/Scripting/Script'+script_id,'org.kde.kwin.Script.run'], check=True)
        timer = GLib.timeout_add_seconds(10, lambda: (loop.quit(), False)[1])
        loop.run()
        GLib.source_remove(timer)
        assert results, (directory / 'app.log').read_text()
        return results[0]
    initial = inspect()
    assert initial and all(all(window.values()) for window in initial), (initial, (directory / 'app.log').read_text())
    keys = bus.call_sync('org.kde.kglobalaccel','/kglobalaccel','org.kde.KGlobalAccel','shortcut',GLib.Variant('(as)',(['kwin','CopyTypeToggle','',''],)),None,Gio.DBusCallFlags.NONE,5000,None).unpack()[0]
    assert 0x0C000020 in keys, keys
    # Invoke the desktop's real action, including KWin -> D-Bus -> app dispatch.
    # This does not synthesize a physical key press into the user's foreground app.
    for _ in range(2):
        subprocess.run(['qdbus6','org.kde.kglobalaccel','/component/kwin','org.kde.kglobalaccel.Component.invokeShortcut','CopyTypeToggle'],check=True)
        time.sleep(.6)
        hidden = inspect()
        assert not hidden or not any(window['visible'] for window in hidden), hidden
        subprocess.run(['qdbus6','org.kde.kglobalaccel','/component/kwin','org.kde.kglobalaccel.Component.invokeShortcut','CopyTypeToggle'],check=True)
        time.sleep(.6)
        restored = inspect()
        assert restored and all(all(window.values()) for window in restored), restored
    subprocess.run(['qdbus6','org.kde.kglobalaccel','/component/kwin','org.kde.kglobalaccel.Component.invokeShortcut','CopyTypeToggle'],check=True)
    time.sleep(.6)
    recovered = subprocess.run(['bash',str(root/'start-kde-private.sh'),'--user-data-dir='+str(directory/'profile')],env=env,capture_output=True,text=True,timeout=20)
    assert recovered.returncode == 0, recovered.stderr
    time.sleep(.6)
    shown = inspect()
    assert shown and all(all(window.values()) for window in shown), shown
    subprocess.run(['qdbus6','org.kde.kglobalaccel','/component/kwin','org.kde.kglobalaccel.Component.invokeShortcut','CopyTypeToggle'],check=True)
    time.sleep(.6)
    hidden = inspect()
    assert not hidden or not any(window['visible'] for window in hidden), hidden
    print('PASS: KDE Ctrl+Alt+Space assigned; hide/restore repeated; relaunch recovered the hidden instance and preserved its shortcut; capture/taskbar/switcher exclusion retained')
finally:
    subprocess.run(['qdbus6','org.kde.KWin','/Scripting','org.kde.kwin.Scripting.unloadScript',script_name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    if launcher.poll() is None:
        os.killpg(launcher.pid, signal.SIGTERM)
        launcher.wait(timeout=10)
    Gio.bus_unown_name(owner)
    log.close()
