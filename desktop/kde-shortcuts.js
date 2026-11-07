/* Loaded by the running app after it acquires its single-instance lock. */
'use strict';
const copyTypeService = 'org.copytype.Desktop.p' + __COPYTYPE_PID__;
function dispatchCopyType(action) {
  callDBus(copyTypeService, '/org/copytype/Desktop', 'org.copytype.Desktop', 'Dispatch', action);
}
if (!registerShortcut('CopyTypeToggle', 'CopyType: show or hide', 'Ctrl+Alt+Space', () => dispatchCopyType('toggle'))) {
  throw new Error('Could not register the CopyType show/hide shortcut.');
}
if (!registerShortcut('CopyTypeCancel', 'CopyType: cancel typing', 'Ctrl+Alt+Backspace', () => dispatchCopyType('cancel'))) {
  throw new Error('Could not register the CopyType cancel shortcut.');
}
