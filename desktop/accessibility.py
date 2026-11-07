"""Editable desktop fields, selected explicitly through CopyType's target list."""
import json
import sys
import time
import uuid

import gi
gi.require_version('Atspi', '2.0')
from gi.repository import Atspi

Atspi.set_timeout(400, 1000)
targets = {}
active = None
excluded_pid = int(sys.argv[1]) if len(sys.argv) > 1 else -1
only_pid = int(sys.argv[2]) if len(sys.argv) > 2 else None

def editable(node):
    node.clear_cache()
    states = node.get_state_set()
    return (states.contains(Atspi.StateType.EDITABLE)
            and not states.contains(Atspi.StateType.DEFUNCT)
            and node.get_role() != Atspi.Role.PASSWORD_TEXT
            and node.get_editable_text_iface() is not None
            and node.get_text_iface() is not None)

def discover():
    global targets
    targets = {}
    result = []
    desktop = Atspi.get_desktop(0)
    remaining = 2000
    deadline = time.monotonic() + 6
    def visit(node, label, depth):
        nonlocal remaining
        if remaining <= 0 or depth > 12 or len(result) >= 80 or time.monotonic() > deadline:
            return
        remaining -= 1
        try:
            if editable(node):
                token = str(uuid.uuid4())
                targets[token] = node
                name = node.get_name() or node.get_role_name() or 'Text field'
                result.append({'id': token, 'label': (label + ' · ' + name)[:300]})
            for index in range(min(node.get_child_count(), 100)):
                child = node.get_child_at_index(index)
                if child is not None:
                    visit(child, label, depth + 1)
        except Exception:
            return
    for index in range(desktop.get_child_count()):
        app = desktop.get_child_at_index(index)
        try:
            if app.get_process_id() == excluded_pid or (only_pid is not None and app.get_process_id() != only_pid):
                continue
            for child_index in range(min(app.get_child_count(), 100)):
                window = app.get_child_at_index(child_index)
                visit(window, (app.get_name() or 'Application') + ' · ' + (window.get_name() or 'Window'), 0)
        except Exception:
            continue
    return result

def text_of(node):
    if not editable(node):
        raise RuntimeError('The selected field is no longer editable.')
    return Atspi.Text.get_text(node, 0, -1)

def handle(request):
    global active
    op = request['op']
    if op == 'list':
        if active:
            raise RuntimeError('Finish or cancel typing before refreshing fields.')
        return discover()
    if op == 'prepare':
        node = targets.get(request.get('target'))
        if node is None:
            raise RuntimeError('Refresh desktop fields and choose the destination again.')
        initial = text_of(node)
        if Atspi.Text.get_n_selections(node):
            selection = Atspi.Text.get_selection(node, 0)
            start, end = sorted((selection.start_offset, selection.end_offset))
        else:
            start = end = Atspi.Text.get_caret_offset(node)
        if not 0 <= start <= end <= len(initial):
            raise RuntimeError('The field did not expose a valid text cursor.')
        active = {'id': request['session'], 'node': node, 'expected': initial, 'start': start, 'end': end, 'first': True}
        return True
    if active is None or active['id'] != request.get('session'):
        raise RuntimeError('No matching desktop typing task.')
    if op == 'cancel':
        active = None
        return True
    node = active['node']
    if text_of(node) != active['expected']:
        raise RuntimeError('Destination changed outside CopyType. Typing stopped; existing text was kept.')
    if op == 'complete':
        return True
    if op != 'append':
        raise RuntimeError('Unknown desktop typing operation.')
    char = request.get('char')
    if not isinstance(char, str) or not char or len(char) > 2 or '\0' in char:
        raise RuntimeError('Invalid text input.')
    start = active['start']
    end = active['end'] if active['first'] else start
    interface = node.get_editable_text_iface()
    if end > start and not interface.delete_text(start, end):
        raise RuntimeError('The destination rejected the selected-range replacement.')
    if not interface.insert_text(start, char, len(char.encode('utf-8'))):
        raise RuntimeError('The destination rejected text input.')
    active['expected'] = active['expected'][:start] + char + active['expected'][end:]
    active['start'] = start + len(char)
    active['first'] = False
    Atspi.Text.set_caret_offset(node, active['start'])
    if text_of(node) != active['expected']:
        raise RuntimeError('This application altered the inserted text. Typing stopped.')
    return True

for line in sys.stdin:
    request = {}
    try:
        if len(line) > 1024 * 1024:
            raise RuntimeError('Request too large.')
        request = json.loads(line)
        reply = {'id': request.get('id'), 'ok': True, 'result': handle(request)}
    except Exception as error:
        reply = {'id': request.get('id'), 'ok': False, 'error': str(error)}
    print(json.dumps(reply), flush=True)
