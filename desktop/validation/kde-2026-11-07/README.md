# KDE capture-exclusion validation — 7 November 2026

Result: **passed on KWin 6.6.6's native output screencast path**, including the actual CopyType Mini Browser launched by `desktop/start-kde-private.sh` with Electron sandboxing enabled.

The test ran in a nested Wayland compositor with an isolated D-Bus session and temporary configuration, cache, application profile, and application-permission declaration. The host session remained Ubuntu GNOME 50.1. No existing desktop contents were recorded: the nested output contained a synthetic green background and CopyType using a fresh temporary browser profile.

## Evidence

- [Locally rendered desktop while exclusion is enabled](local-while-excluded.png): CopyType is visible over the green background. Obtained through KWin 6.6's separate workspace screenshot API, which does not apply its screencast filter.
- [Captured output without exclusion](capture-without-exclusion.png): CopyType appears normally.
- [Captured output with exclusion](capture-with-exclusion.png): the background underneath appears, without a black replacement rectangle.
- [Frame measurements](result.json): counts of green, red, and near-black pixels in each 1000×700 output frame. These are automated checks, supplemented by visual inspection of the PNGs.

## Procedure

1. Start a private nested `kwin_wayland` instance with output size 1000×700, its own D-Bus session, and a named socket `copytype-kde-test`. Disable lock-screen and global-shortcut integration in this test instance only.
2. Open a synthetic GTK green background in a separate process from the capture client.
3. Launch the actual desktop app through `desktop/start-kde-private.sh`. The launcher installs its temporary PID-specific KWin watcher before allowing Electron to start.
4. Connect the test client to KWin's `zkde_screencast_unstable_v1.stream_output` interface, with the capture permission declared for a dedicated test executable in the nested session's temporary application registry. Read the resulting PipeWire node with GStreamer `pipewiresrc`, convert to RGB, and save frames.
5. Capture the automatically excluded initial state, explicitly disable exclusion for a baseline, enable exclusion and capture both the stream and workspace screenshot, then disable exclusion again to verify reversibility.
6. Close CopyType and terminate the nested compositor. Keep the host GNOME session running.

The launcher's watcher was observed applying to the actual app process:

```text
js: CopyType capture exclusion applied to PID 80672
js: COPYTYPE launcher-excluded=true pid=80672
```

Green-background pixels: automatic exclusion **661125**, exclusion disabled **276040**, exclusion enabled **661149**, exclusion disabled again **276040**. The enabled-exclusion frame had **zero near-black pixels**. A separate synthetic red-window test also passed: **79543** red pixels before exclusion, **0** during exclusion, and **79543** after restoring capture.

## Limits and system changes

This verifies KWin's output screencast renderer and the launcher, rather than an end-to-end Zoom, Meet, or OBS session. It does not verify direct GPU/KMS capture, all screenshot methods, overview thumbnails, or every app popup. A GNOME capture of the outer nested window still sees the locally rendered CopyType window.

Installed Plasma workspace, KWin Wayland, the KDE desktop portal, Plasma desktop, and the Plasma Wayland login-session package from Ubuntu repositories, all at the available 6.6.6 release where applicable. The two package transactions added 311 packages and removed none; APT estimated approximately 605 MB of installed disk space. GNOME and the existing login manager were retained. The new login option is **Plasma (Wayland)**; the current session was not switched.

Desktop unit tests, JavaScript syntax checks, and both Linux launcher syntax checks passed. The KDE launcher was also checked to reject the current GNOME session.
