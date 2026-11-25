# Whole-screen sharing with CopyType on GNOME

This experiment targets Mutter 50.1, the compositor version used by Ubuntu 26.04.1 with GNOME Shell 50.1. It keeps CopyType on the local display and omits its window from the PipeWire **Screen** stream that Mutter produces through `RecordMonitor`. CopyType's Wayland app ID is `org.copytype.CopyType`.

## How the capture path works

1. Mutter matches the configured app ID against each Wayland window and marks the corresponding Clutter actor. Clutter uses the same actor when it paints live window clones.
2. The monitor stream bypasses the scanout and framebuffer-copy shortcuts while the filter is configured. Those paths already contain the local image. The capture renderer paints the full monitor into a separate buffer with a capture-specific paint flag. Clutter skips the flagged actors before painting their content or effects. Cached images from window resize animations and the screenshot preview carry the same exclusion when GNOME draws them back onto the stage.
3. The capture pass drops the local occlusion clips so windows under CopyType can be drawn. The occlusion calculation keeps those underlying windows eligible for repaint when their content changes. The local display still paints CopyType and clips the windows behind it normally.

Read the two buffer paths in the [upstream monitor renderer](https://gitlab.gnome.org/GNOME/mutter/-/blob/50.1/src/backends/meta-screen-cast-monitor-stream-src.c) alongside the [patch](mutter-50.1-monitor-privacy.patch).

## Build and run the isolated test

Use a machine with GNOME Shell 50.1, the Mutter development dependencies, Meson, Ninja, GObject Introspection, and `xcvt`. For the test, install Electron through the regular CopyType launcher and configure its Linux sandbox. The test uses Bubblewrap, Python GI, GTK 4, Pillow, GStreamer with the PipeWire and PNG plugins, PipeWire, and WirePlumber.

Run from the repository root. These commands build a library in a separate directory and load it only in a disposable headless GNOME session.

```bash
patch_file="$PWD/desktop/gnome/mutter-50.1-monitor-privacy.patch"
lab="$(mktemp -d /tmp/copytype-mutter.XXXXXXXX)"
curl --fail --location https://download.gnome.org/sources/mutter/50/mutter-50.1.tar.xz \
  --output "$lab/mutter-50.1.tar.xz"
tar -xf "$lab/mutter-50.1.tar.xz" -C "$lab"
patch -d "$lab/mutter-50.1" -p1 < "$patch_file"
meson setup "$lab/build" "$lab/mutter-50.1" \
  --prefix="$lab/install" --buildtype=release \
  -Dtests=disabled -Dmutter_tests=false -Dclutter_tests=false -Dcogl_tests=false \
  -Dintrospection=true -Dinstalled_tests=false -Ddocs=false -Ddevkit=disabled \
  -Dprofiler=false -Dbash_completion=false
ninja -C "$lab/build" src/Meta-18.typelib clutter/clutter/Clutter-18.typelib \
  cogl/cogl/Cogl-18.typelib mtk/mtk/Mtk-18.typelib
/usr/bin/python3 desktop/gnome/test-monitor-privacy.py "$lab/build" "$lab/frames"
```

The test opens a synthetic GTK window behind the actual CopyType window. While the same stream is running, it makes CopyType fullscreen and changes the GTK background from green to cyan. It saves an entire-monitor frame and a control frame captured through Mutter's area API for each color. The expected result is the changing GTK background in the monitor frames and visible CopyType content in the area frames. The test also opens GNOME's screenshot preview while the monitor stream is running.

The isolated GNOME Shell 50.1 run passed with the patched library. The monitor stream showed both background colors while the local control showed CopyType. [Local control frame](../validation/gnome-2026-11-20/local-control.png) · [Whole-monitor frame](../validation/gnome-2026-11-20/whole-monitor.png)

GNOME Shell has a compiled-in Mutter library search path for introspection. The test uses Bubblewrap to present the patched libraries and their matching typelibs at that path inside the test Shell's mount namespace. This prevents Shell from loading a second, stock Cogl library when GJS first uses its types. [GNOME Shell's introspection initialization](https://github.com/GNOME/gnome-shell/blob/50.1/src/main.c#L202-L217)

## Use in a GNOME login session

The GNOME Shell process that owns the display must load the patched Mutter libraries and start with `COPYTYPE_MUTTER_EXCLUDED_APP_ID=org.copytype.CopyType`. On Ubuntu, `install-test-session.sh` registers **Ubuntu (CopyType Test)** as a separate GDM login option. It takes a prepared directory containing the four rebuilt Mutter libraries and typelibs, with build-time library paths removed, and a `versions` file from `dpkg-query -W -f='${Package} ${Version}\n' gnome-shell libmutter-18-0`. Build against the installed Ubuntu Mutter source version so Ubuntu's compositor patches and packaged file paths are included.

Compile the GNOME Shell runtime helper into the same prepared directory. It redirects GNOME Shell's Mutter introspection paths and clears the temporary loader environment before Shell spawns applications. VS Code and other apps then start with their usual OS sandbox.

```bash
stock_mutter_dir="/usr/lib/$(dpkg-architecture -qDEB_HOST_MULTIARCH)/mutter-18"
cc -O2 -fPIC -shared "-DSTOCK_MUTTER_DIR=\"$stock_mutter_dir\"" \
  -o "$runtime/shell-runtime.so" desktop/gnome/shell-runtime.c -ldl
```

Use `install-test-session.sh --update "$runtime"` with administrator privileges to update an existing test login whose Mutter libraries match the prepared runtime. To exercise the updated method in a headless session, create the `.so.0` links to the corresponding `.so.0.0.0` files in the prepared directory and run `test-monitor-privacy.py "$runtime" "$output" --login-runtime`. This also checks whether Ubuntu GNOME opens the installed VS Code through a desktop entry.

After registration, save your work and log out. Select your account in GDM, open the gear menu, and choose **Ubuntu (CopyType Test)**. In that session, `bash desktop/start-gnome-private.sh` checks Mutter's `ExcludedAppId` D-Bus property before opening CopyType. The launcher uses the [GNOME custom show/hide shortcut](../README.md#share-a-single-window-on-ubuntu-gnome) if configured. In your sharing app, select **Your entire screen** and check the participant's view with test content first.

Choose **Ubuntu** from the same gear menu to return to the regular login. To remove the test option after signing into **Ubuntu**, run `sudo bash desktop/gnome/install-test-session.sh --remove` from the repository root. If GNOME Shell or Mutter is upgraded, rebuild the test runtime for the installed versions before selecting the test option again.

The patch covers Mutter's `RecordMonitor` streams. Area and window captures, saved screenshots, and capture outside Mutter's monitor pipeline can still show CopyType. A host GNOME session captures a nested compositor as a regular window. The second paint pass also adds GPU work while sharing. Text written into a shared destination is part of that destination's captured content.
