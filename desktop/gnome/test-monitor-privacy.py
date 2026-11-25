#!/usr/bin/env python3
"""Compare Mutter monitor and area capture with CopyType visible in an isolated GNOME session."""

import argparse
from contextlib import ExitStack, contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import io
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import sysconfig
import tempfile
import threading
import time

import gi
gi.require_version('Gst', '1.0')
from gi.repository import Gio, GLib, Gst
from PIL import Image


DESKTOP = Path(__file__).resolve().parents[1]
APP_ID = 'org.copytype.CopyType'
BUS_NAME = 'org.gnome.Mutter.ScreenCast'
BUS_PATH = '/org/gnome/Mutter/ScreenCast'
SCREEN_SIZE = (1366, 850)
PRIVATE_COLOR = (255, 0, 255)
EXTENSION_ID = 'capture-test@copytype.local'
EXTENSION = '''
import Gio from 'gi://Gio';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export default class CaptureTest extends Extension {
    enable() {
        const xml = `<node><interface name="org.copytype.Test">
            <method name="Windows"><arg type="s" direction="out"/></method>
            <method name="MakeCopyTypeFullscreen"/>
            <method name="LaunchEditor"><arg type="s" direction="in"/></method>
            <method name="ShowScreenshotPreview"/>
            <method name="ScreenshotPreviewVisible"><arg type="b" direction="out"/></method>
            </interface></node>`;
        this.service = Gio.DBusExportedObject.wrapJSObject(xml, {
            Windows() {
                Main.overview.hide();
                return JSON.stringify(global.get_window_actors().map(actor => ({
                    title: actor.meta_window.title,
                    appId: actor.meta_window.get_wm_class(),
                    pid: actor.meta_window.get_pid(),
                    visible: actor.is_mapped() && !actor.meta_window.minimized,
                    focused: actor.meta_window.has_focus(),
                    fullscreen: actor.meta_window.is_fullscreen(),
                })));
            },
            MakeCopyTypeFullscreen() {
                const actor = global.get_window_actors().find(actor =>
                    actor.meta_window.get_wm_class() === 'org.copytype.CopyType');
                actor.meta_window.make_fullscreen();
            },
            LaunchEditor(filename) {
                Main.screenshotUI.close(true);
                const app = Gio.DesktopAppInfo.new_from_filename(filename);
                if (!app.launch([], global.create_app_launch_context(0, -1)))
                    throw new Error('GNOME Shell failed to launch the test editor');
            },
            ShowScreenshotPreview() {
                Main.screenshotUI.open().catch(logError);
            },
            ScreenshotPreviewVisible() {
                return Main.screenshotUI.visible;
            },
        });
        this.service.export(Gio.DBus.session, '/org/copytype/Test');
    }
    disable() {
        this.service.unexport();
        this.service = null;
    }
}
'''


def run_fixture(color_file):
    gi.require_version('Gtk', '4.0')
    from gi.repository import Gdk, Gtk

    def activate(app):
        css = Gtk.CssProvider()
        Gtk.StyleContext.add_provider_for_display(
            Gdk.Display.get_default(), css, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION)
        last_color = None

        def update_color():
            nonlocal last_color
            color = color_file.read_text()
            if color != last_color:
                css.load_from_data(f'window {{ background: {color}; }}'.encode())
                last_color = color
            return GLib.SOURCE_CONTINUE

        update_color()
        GLib.timeout_add(100, update_color)
        window = Gtk.ApplicationWindow(application=app, title='CopyType Capture Fixture')
        window.maximize()
        window.present()

    app = Gtk.Application(application_id='org.copytype.CaptureFixture')
    app.connect('activate', activate)
    app.run(None)


def wait_for(check, description, timeout=25):
    context = GLib.MainContext.default()
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        while context.pending():
            context.iteration(False)
        try:
            result = check()
            if result:
                return result
        except GLib.Error:
            pass
        time.sleep(.1)
    raise RuntimeError(f'Timed out waiting for {description}')


def call(bus, destination, path, interface, method, arguments=None):
    return bus.call_sync(destination, path, interface, method, arguments, None,
                         Gio.DBusCallFlags.NONE, 2000, None).unpack()


@contextmanager
def capture(bus):
    session, = call(bus, BUS_NAME, BUS_PATH, BUS_NAME, 'CreateSession', GLib.Variant('(a{sv})', ({},)))
    interface = BUS_NAME + '.Session'
    nodes = {}
    pipelines = {}
    subscription = bus.signal_subscribe(
        BUS_NAME, BUS_NAME + '.Stream', 'PipeWireStreamAdded', None, None,
        Gio.DBusSignalFlags.NONE,
        lambda _bus, _sender, path, _interface, _signal, args: nodes.update({path: args.unpack()[0]}))
    try:
        options = {'cursor-mode': GLib.Variant('u', 0)}
        monitor, = call(bus, BUS_NAME, session, interface, 'RecordMonitor',
                        GLib.Variant('(sa{sv})', ('Meta-0', options)))
        area, = call(bus, BUS_NAME, session, interface, 'RecordArea',
                     GLib.Variant('(iiiia{sv})', (0, 0, *SCREEN_SIZE, options)))
        call(bus, BUS_NAME, session, interface, 'Start')
        wait_for(lambda: monitor in nodes and area in nodes, 'both PipeWire nodes')
        for source, stream in [('monitor', monitor), ('area', area)]:
            pipeline = Gst.parse_launch(f'pipewiresrc path={nodes[stream]} ! videoconvert ! pngenc '
                                        '! appsink name=frames sync=false drop=true max-buffers=1')
            pipelines[source] = pipeline
            if pipeline.set_state(Gst.State.PLAYING) == Gst.StateChangeReturn.FAILURE:
                raise RuntimeError(f'Failed to start the {source} GStreamer pipeline')
        yield {source: pipeline.get_by_name('frames') for source, pipeline in pipelines.items()}
    finally:
        for pipeline in pipelines.values():
            pipeline.set_state(Gst.State.NULL)
        bus.signal_unsubscribe(subscription)
        call(bus, BUS_NAME, session, interface, 'Stop')


def read_frame(sink, output, expected=None, private=False):
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        sample = sink.emit('try-pull-sample', Gst.SECOND)
        if sample is None:
            continue
        buffer = sample.get_buffer()
        png = buffer.extract_dup(0, buffer.get_size())
        with Image.open(io.BytesIO(png)) as image:
            if image.size != SCREEN_SIZE:
                raise AssertionError(image.size)
            rgb = image.convert('RGB')
            pixel = rgb.getpixel(tuple(size // 2 for size in SCREEN_SIZE))
            has_private_pixels = any(abs(r - b) < 16 and min(r, b) > g + 32
                                     for _, (r, g, b) in rgb.getcolors(image.width * image.height))
        if not private and has_private_pixels:
            output.write_bytes(png)
            raise AssertionError('The whole-monitor stream included pixels from the CopyType page')
        if (not private or has_private_pixels) and (expected is None or pixel == expected):
            output.write_bytes(png)
            return pixel
    raise RuntimeError(f'Timed out waiting for a frame for {output}')


def start_process(stack, command, log_dir, name, env=None):
    logfile = stack.enter_context((log_dir / f'{name}.log').open('w'))
    child = subprocess.Popen(command, stdout=logfile, stderr=subprocess.STDOUT, env=env,
                             start_new_session=True)

    def stop():
        if child.poll() is not None:
            return
        os.killpg(child.pid, signal.SIGTERM)
        try:
            child.wait(timeout=5)
        except subprocess.TimeoutExpired:
            os.killpg(child.pid, signal.SIGKILL)
            child.wait()

    stack.callback(stop)
    return child


def shell_command(build, scratch):
    system_libs = Path('/usr/lib') / sysconfig.get_config_var('MULTIARCH')
    command = ['bwrap', '--die-with-parent', '--ro-bind', '/', '/', '--dev-bind', '/dev', '/dev',
               '--bind', str(scratch), str(scratch)]
    for directory, name, namespace in [('src', 'libmutter-18', 'Meta'),
                                       ('clutter/clutter', 'libmutter-clutter-18', 'Clutter'),
                                       ('cogl/cogl', 'libmutter-cogl-18', 'Cogl'),
                                       ('mtk/mtk', 'libmutter-mtk-18', 'Mtk')]:
        original_dir = system_libs if namespace == 'Meta' else system_libs / 'mutter-18'
        original_library = (original_dir / f'{name}.so.0').resolve(strict=True)
        typelib = f'{namespace}-18.typelib'
        command += ['--ro-bind', str(build / directory / f'{name}.so.0.0.0'), str(original_library),
                    '--ro-bind', str(build / directory / typelib), str(system_libs / 'mutter-18' / typelib)]
    return command + ['--', 'gnome-shell', '--headless', '--no-x11',
                      '--virtual-monitor=1366x850', '--wayland-display=copytype-test']


class PrivateFixturePage(BaseHTTPRequestHandler):
    def do_GET(self):
        page = (b'<!doctype html><title>CopyType capture fixture</title>'
                b'<body style="background:#ff00ff;color:black;font:24px sans-serif">'
                b'CopyType private window</body>')
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.end_headers()
        self.wfile.write(page)

    def log_message(self, *_args):
        pass


def run_session(build, scratch, output, login_runtime):
    Gst.init(None)
    extension = Path(os.environ['XDG_DATA_HOME']) / 'gnome-shell/extensions' / EXTENSION_ID
    extension.mkdir(parents=True)
    (extension / 'metadata.json').write_text(json.dumps({
        'uuid': EXTENSION_ID, 'name': 'CopyType capture test',
        'description': 'Inspect disposable GNOME test windows', 'shell-version': ['50'],
    }))
    (extension / 'extension.js').write_text(EXTENSION)
    subprocess.run(['gsettings', 'set', 'org.gnome.shell', 'enabled-extensions',
                    f"['{EXTENSION_ID}']"], check=True)

    shell_env = {**os.environ, 'COPYTYPE_MUTTER_EXCLUDED_APP_ID': APP_ID}
    bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
    color_file = scratch / 'fixture-color'
    color_file.write_text('#00ff00')
    with ExitStack() as stack:
        server = stack.enter_context(ThreadingHTTPServer(('127.0.0.1', 0), PrivateFixturePage))
        threading.Thread(target=server.serve_forever, daemon=True).start()
        stack.callback(server.shutdown)
        start_process(stack, ['pipewire'], output, 'pipewire')
        wait_for(lambda: (scratch / 'run/pipewire-0').is_socket(), 'local PipeWire socket')
        start_process(stack, ['wireplumber'], output, 'wireplumber')
        if login_runtime:
            shell_env.update(LD_LIBRARY_PATH=str(build), LD_PRELOAD=str(build / 'shell-runtime.so'))
            command = ['gnome-shell', '--mode=ubuntu', '--headless', '--no-x11',
                       '--virtual-monitor=1366x850', '--wayland-display=copytype-test']
        else:
            command = shell_command(build, scratch)
        start_process(stack, command, output, 'gnome-shell', shell_env)
        wait_for(lambda: (scratch / 'run/copytype-test').is_socket(), 'local GNOME Wayland socket')
        start_process(stack, [sys.executable, __file__, '--fixture', str(color_file)], output, 'fixture')

        def probe(method):
            return call(bus, 'org.gnome.Shell', '/org/copytype/Test', 'org.copytype.Test', method)

        def get_windows():
            result, = probe('Windows')
            return json.loads(result)

        wait_for(lambda: any(w['title'] == 'CopyType Capture Fixture' and w['visible']
                             for w in get_windows()), 'visible GTK capture fixture')
        start_process(stack, ['bash', str(DESKTOP / 'start-gnome-private.sh'),
                              f'--user-data-dir={scratch / "profile"}'], output, 'copytype',
                      {**os.environ, 'COPYTYPE_START_URL': f'http://127.0.0.1:{server.server_port}/'})

        def copytype_is_visible(fullscreen=False, require_focus=False):
            return any(w['appId'] == APP_ID and w['visible'] and w['fullscreen'] == fullscreen and
                       (w['focused'] or not require_focus) for w in get_windows())

        wait_for(lambda: copytype_is_visible(require_focus=True),
                 'visible and focused CopyType window with the expected app ID')
        with capture(bus) as streams:
            for label, css_color, expected in [('green', '#00ff00', (0, 255, 0)),
                                               ('cyan', '#00ffff', (0, 255, 255))]:
                fullscreen = label == 'cyan'
                if fullscreen:
                    probe('MakeCopyTypeFullscreen')
                    wait_for(lambda: copytype_is_visible(fullscreen=True), 'fullscreen CopyType')
                color_file.write_text(css_color)
                destination = output / label
                destination.mkdir()
                monitor_center = read_frame(streams['monitor'], destination / 'monitor.png', expected)
                area_center = read_frame(streams['area'], destination / 'area.png', private=True)
                if area_center != PRIVATE_COLOR:
                    raise AssertionError(f'{label}: monitor={monitor_center}, area={area_center}, expected={expected}')
                print(f'{label}: monitor shows {monitor_center} underneath CopyType, area shows {area_center}',
                      flush=True)
            probe('ShowScreenshotPreview')
            wait_for(lambda: probe('ScreenshotPreviewVisible')[0], 'GNOME screenshot preview')
            time.sleep(.3)
            read_frame(streams['monitor'], output / 'screenshot-preview.png')

        if login_runtime:
            editor_file = scratch / 'copytype-vscode-fixture.txt'
            editor_file.write_text('CopyType sandbox regression test')
            portable = scratch / 'code-portable'
            portable.mkdir()
            desktop_file = scratch / 'code-fixture.desktop'
            desktop_file.write_text(
                '[Desktop Entry]\nType=Application\nName=VS Code test\n'
                f'Exec=/usr/bin/env VSCODE_PORTABLE={portable} /usr/share/code/code '
                f'--disable-extensions --new-window {editor_file}\n'
            )
            call(bus, 'org.gnome.Shell', '/org/copytype/Test', 'org.copytype.Test', 'LaunchEditor',
                 GLib.Variant('(s)', (str(desktop_file),)))
            editor = wait_for(lambda: next((w for w in get_windows()
                                            if editor_file.name in (w['title'] or '') and w['visible']), None),
                              'VS Code started from GNOME Shell')
            try:
                process = Path('/proc') / str(editor['pid'])
                assert (process / 'ns/user').readlink() == Path('/proc/self/ns/user').readlink()
                environment = (process / 'environ').read_bytes().split(b'\0')
                assert not any(item.startswith((b'LD_PRELOAD=', b'LD_LIBRARY_PATH=')) for item in environment)
                print('PASS: GNOME Shell opened VS Code with its normal sandbox', flush=True)
            finally:
                try:
                    os.kill(editor['pid'], signal.SIGTERM)
                except ProcessLookupError:
                    pass


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('build', type=Path, nargs='?')
    parser.add_argument('output', type=Path, nargs='?')
    parser.add_argument('--login-runtime', action='store_true',
                        help='test the prepared Ubuntu login runtime and launch the installed VS Code')
    parser.add_argument('--fixture', type=Path, help=argparse.SUPPRESS)
    parser.add_argument('--session', type=Path, help=argparse.SUPPRESS)
    args = parser.parse_args()
    if args.fixture:
        run_fixture(args.fixture)
        return
    if not args.build or not args.output:
        parser.error('specify the Mutter build directory and a new directory for the captured frames')
    if args.session:
        run_session(args.build, args.session, args.output, args.login_runtime)
        return
    required = (('libmutter-18.so.0', 'Meta-18.typelib', 'shell-runtime.so') if args.login_runtime
                else ('src/libmutter-18.so.0.0.0', 'src/Meta-18.typelib'))
    if not all((args.build / filename).is_file() for filename in required):
        parser.error('the Mutter 50.1 shared library and typelib must both be built')
    if args.login_runtime and not Path('/usr/share/code/code').is_file():
        parser.error('--login-runtime requires the installed VS Code executable at /usr/share/code/code')
    args.output.mkdir()
    with tempfile.TemporaryDirectory(prefix='copytype-capture-', ignore_cleanup_errors=True) as directory:
        scratch = Path(directory)
        for folder in ('run', 'data', 'config', 'cache'):
            (scratch / folder).mkdir(mode=0o700)
        env = {**os.environ, 'XDG_CURRENT_DESKTOP': 'GNOME', 'XDG_SESSION_TYPE': 'wayland',
               'XDG_RUNTIME_DIR': str(scratch / 'run'), 'XDG_DATA_HOME': str(scratch / 'data'),
               'XDG_CONFIG_HOME': str(scratch / 'config'), 'XDG_CACHE_HOME': str(scratch / 'cache'),
               'WAYLAND_DISPLAY': 'copytype-test', 'GSETTINGS_BACKEND': 'keyfile', 'GIO_USE_VFS': 'local',
               'COPYTYPE_RUNTIME_DIR': str(scratch / 'bridge')}
        for name in ('DISPLAY', 'WAYLAND_SOCKET', 'ELECTRON_RUN_AS_NODE'):
            env.pop(name, None)
        try:
            command = ['dbus-run-session', '--', sys.executable, __file__,
                       str(args.build.resolve()), str(args.output.resolve()), '--session', str(scratch)]
            if args.login_runtime:
                command.append('--login-runtime')
            subprocess.run(command, env=env, check=True)
        finally:
            documents = scratch / 'run/doc'
            if documents.is_mount():
                subprocess.run(['fusermount3', '-u', str(documents)], check=False)
    print(f'PASS: CopyType stays visible locally while the monitor stream shows the changing desktop underneath. Frames saved to {args.output}')


if __name__ == '__main__':
    main()
