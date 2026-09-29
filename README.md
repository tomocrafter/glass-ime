# Glass IME Panel

A GNOME Shell extension that draws the fcitx5 candidate window and the input method switch indicator as frosted glass — a live blur of whatever is behind it, a flat translucent tint, a hairline border and a soft shadow.

- **Candidate window**: rounded glass panel whose height animates smoothly as the candidate list grows and shrinks while you type. The width snaps immediately so text never gets squeezed or ellipsized mid-animation.
- **Input method indicator**: a small `A` / `あ` badge under the cursor when you switch input methods (e.g. with the Zenkaku/Hankaku key).
- **Top bar status**: shows the current input mode and opens a menu to switch input methods or open the fcitx5 settings.

## How it works

fcitx5 ships a `kimpanel` addon that hands the whole input panel over to an external process on D-Bus. This extension owns `org.kde.impanel`, so fcitx5 stops drawing its own UI (classicui) and sends the candidates, cursor rectangle and aux text here instead.

GNOME Shell's background blur (`Shell.BlurMode.BACKGROUND`) cannot be clipped to rounded corners, so the extension clones the wallpaper and the windows behind the panel, blurs those clones with `Shell.BlurMode.ACTOR`, and cuts the result to a rounded rectangle with a small GLSL shader. The blur is live: it follows whatever changes underneath.

## Requirements

- GNOME Shell 46 (tested on Ubuntu 24.04, X11 session)
- fcitx5 with the kimpanel addon (included in `fcitx5-modules` on Debian/Ubuntu)

## Install

```sh
git clone https://github.com/tomocrafter/glass-ime.git
ln -s "$PWD/glass-ime" ~/.local/share/gnome-shell/extensions/glass-ime@tomo
```

Restart GNOME Shell (X11: <kbd>Alt</kbd>+<kbd>F2</kbd>, `r`; Wayland: log out and back in), then:

```sh
gnome-extensions enable glass-ime@tomo
```

User extensions must be allowed (`gsettings get org.gnome.shell disable-user-extensions` should be `false`).

fcitx5 switches to this panel automatically once the extension is running. Disable the extension to get classicui back.

> While kimpanel is active, fcitx5 also hides its own tray icon. The top bar status replaces it.

## Customize

All colors, sizes and spacing live in [`stylesheet.css`](stylesheet.css):

| Selector | What it controls |
| --- | --- |
| `.glass-ime-surface` | Glass tint and border |
| `.glass-ime-shadow` | Drop shadow |
| `.glass-ime-candidate.selected` | Selected candidate |
| `.glass-ime-indicator-text` | Size of the `A` / `あ` badge |

Blur strength, corner radius and saturation are constructor options of `GlassPanel` in [`impl.js`](impl.js).

## Development

`extension.js` is a small loader: on every enable it copies `impl.js` to a uniquely named file and imports that, working around GJS's module cache. Code changes therefore apply with

```sh
gnome-extensions disable glass-ime@tomo && gnome-extensions enable glass-ime@tomo
```

without restarting GNOME Shell. Only changes to `extension.js` itself need a restart.

## License

[GPL-2.0-or-later](LICENSE)
