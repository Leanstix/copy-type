# KDE show/hide shortcut repair — 7 November 2026

The original live test verified Electron's shortcut registration return value, not delivery of the KDE global action. The user subsequently reported that Ctrl+Alt+Space neither hid nor restored the app. The old toggle also did not explicitly restore a minimized window.

Private mode now registers **CopyTypeToggle** and **CopyTypeCancel** through KWin's `registerShortcut`, routing their actions over a PID-specific D-Bus service to the Electron main process. The receiver only accepts dispatch from KWin's bus owner. The bindings are created after acquiring the app's single-instance lock, checked against KGlobalAccel's actual assigned key sequences, and unloaded on exit. Electron shortcut registration is not used for private mode.

The live test used a disposable private CopyType instance on KDE Wayland:

- Verified Ctrl+Alt+Space's Qt key sequence in KGlobalAccel.
- Verified both required key assignments before opening the window.
- Invoked KDE's real **CopyTypeToggle** action through KGlobalAccel, exercising KWin → D-Bus receiver → Electron window behavior.
- Observed the native window disappear from the visible workspace, then return after the next activation. Repeated this cycle twice.
- Verified screencast exclusion and taskbar/switcher/pager exclusion remained enabled after restoring the window.
- Relaunched the same disposable profile while hidden, verified that its existing window returned, and confirmed that its native shortcut continued to work afterwards.

This action-level check does not synthesize physical keypresses into the user's foreground application. Regression tests separately cover a visible window, a hidden window, and a minimized window. The desktop unit suite and syntax checks passed; the existing root-owned sandbox fixture test remained skipped.
