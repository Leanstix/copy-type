'use strict';
function mayWriteClipboard(webContents, permission, url, details, context) {
  if (permission !== 'clipboard-sanitized-write' || !webContents || webContents.isDestroyed() || details.isMainFrame !== true) return false;
  if (context.webContents !== webContents || !context.focused || !context.visible || !webContents.isFocused()) return false;
  try {
    const requesting = new URL(url), current = new URL(webContents.getURL());
    return ['http:', 'https:'].includes(current.protocol) && requesting.origin === current.origin;
  } catch { return false; }
}
function configurePermissions(session, getContext) {
  session.setPermissionCheckHandler((web, permission, origin, details) => mayWriteClipboard(web, permission, details.requestingUrl || origin, details, getContext()));
  session.setPermissionRequestHandler((web, permission, callback, details) => callback(mayWriteClipboard(web, permission, details.requestingUrl, details, getContext())));
}
module.exports = {mayWriteClipboard, configurePermissions};
