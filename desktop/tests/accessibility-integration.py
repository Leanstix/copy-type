"""Live GTK test. Requires a desktop session and /usr/bin/python3 GI bindings."""
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import tempfile

if '--fixture' in sys.argv:
    import gi
    gi.require_version('Gtk', '4.0')
    from gi.repository import Gtk, Gio
    app = Gtk.Application(application_id='org.copytype.AccessibilityTest', flags=Gio.ApplicationFlags.NON_UNIQUE)
    def activate(application):
        window = Gtk.ApplicationWindow(application=application, title='CopyType desktop input test')
        view = Gtk.TextView()
        view.set_editable(True)
        view.get_buffer().set_text('prefixOLDsuffix')
        view.get_buffer().select_range(view.get_buffer().get_iter_at_offset(6), view.get_buffer().get_iter_at_offset(9))
        def changed(buffer):
            Path(sys.argv[2]).write_text(buffer.get_text(buffer.get_start_iter(), buffer.get_end_iter(), True))
        view.get_buffer().connect('changed', changed)
        window.set_child(view)
        window.set_default_size(480, 220)
        window.present()
        other = Gtk.ApplicationWindow(application=application, title='CopyType unrelated foreground test')
        other.set_child(Gtk.Button(label='Typing must stay in the other window'))
        other.set_default_size(400, 120)
        other.present()
    app.connect('activate', activate)
    app.run([])
else:
    result_file = Path(tempfile.mkstemp(prefix='copytype-native-field-')[1])
    fixture = subprocess.Popen(['/usr/bin/python3', __file__, '--fixture', str(result_file)], env={**os.environ, 'GTK_A11Y': 'atspi'})
    helper = subprocess.Popen(['/usr/bin/python3', str(Path(__file__).parents[1] / 'accessibility.py'), '-1', str(fixture.pid)], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
    request_id = 0
    def request(op, **args):
        global request_id
        request_id += 1
        helper.stdin.write(json.dumps({'id': str(request_id), 'op': op, **args}) + '\n')
        helper.stdin.flush()
        response = json.loads(helper.stdout.readline())
        assert response['ok'], response
        return response['result']
    try:
        targets = []
        for _ in range(15):
            time.sleep(1)
            targets = request('list')
            if targets:
                break
        assert len(targets) == 1, targets
        target = targets[0]['id']
        request('prepare', target=target, session='integration')
        for char in '{\n\t🙂é\n}':
            request('append', target=target, session='integration', char=char)
        assert request('complete', target=target, session='integration')
        assert result_file.read_text() == 'prefix{\n\t🙂é\n}suffix', result_file.read_text()
        request('cancel', target=target, session='integration')
        print('PASS: native GTK field selection, exact text replacement, Unicode and background editing')
    finally:
        helper.terminate()
        fixture.terminate()
        helper.wait(timeout=5)
        fixture.wait(timeout=5)
        result_file.unlink(missing_ok=True)
