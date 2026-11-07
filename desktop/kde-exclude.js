/* Loaded temporarily by start-kde-private.sh in the user's KWin session. */
'use strict';
const copyTypePid = __COPYTYPE_PID__;
function protectCopyType(window) {
  if (window.pid !== copyTypePid) return;
  if (typeof window.excludeFromCapture !== 'boolean') {
    throw new Error('KWin does not support window capture exclusion.');
  }
  window.excludeFromCapture = true;
  print('CopyType capture exclusion applied to PID ' + copyTypePid);
}
workspace.windowAdded.connect(protectCopyType);
for (const window of workspace.windowList()) protectCopyType(window);
