# Third-party notices

nJukeboxGO is licensed under the GNU General Public License v3.0, see
[LICENSE](LICENSE). This file lists the third-party material distributed with it
and the licenses that material carries. None of these licenses require the
project to be GPL; the GPL is this project's own choice.

## Bundled assets

These files ship in the repository and are served to the browser.

| Asset | Origin | License |
|---|---|---|
| `assets/roboto.woff2` | [Roboto](https://fonts.google.com/specimen/Roboto), Google | Apache License 2.0 |
| `assets/fluent-emoji/chunk-*.woff2` | [microsoft/fluentui-emoji](https://github.com/microsoft/fluentui-emoji) artwork, built into a COLRv1 webfont by [MARTYR-X-LTD/fluentmoji](https://github.com/MARTYR-X-LTD/fluentmoji) v1.0.0 | MIT (both) |

The full MIT texts for the emoji font are reproduced in
[`assets/fluent-emoji/LICENSE.txt`](assets/fluent-emoji/LICENSE.txt), together
with a note on why the font is bundled at all. Apache License 2.0 is available
at <https://www.apache.org/licenses/LICENSE-2.0>.

Both fonts are bundled deliberately so that nothing is fetched from the internet
at runtime and the interface looks the same on every machine.

## Go modules linked into the binary

Determined with `go list -deps ./cmd/njukebox`. The module graph in `go.mod`
is larger than this list because the SQLite driver pulls in build-time tooling;
those modules are not part of the binary and are not distributed.

| Module | License |
|---|---|
| `github.com/dhowden/tag` | BSD-2-Clause |
| `github.com/dustin/go-humanize` | MIT |
| `github.com/fsnotify/fsnotify` | BSD-3-Clause |
| `github.com/go-ole/go-ole` | MIT |
| `github.com/mattn/go-isatty` | MIT |
| `github.com/moutend/go-wca` | MIT |
| `github.com/ncruces/go-strftime` | MIT |
| `github.com/remyoudompheng/bigfft` | BSD-3-Clause |
| `github.com/tcolgate/mp3` | MIT |
| `golang.org/x/sys` | BSD-3-Clause |
| `modernc.org/libc` | BSD-2-Clause |
| `modernc.org/mathutil` | BSD-2-Clause |
| `modernc.org/memory` | BSD-2-Clause |
| `modernc.org/sqlite` | BSD-3-Clause |

Every one of them is permissive. The GPL obligation that earlier versions
inherited came from FFmpeg through `ffmpeg-static`; FFmpeg is gone, and no
current dependency replaces that obligation.

## Not distributed

`github.com/hashicorp/golang-lru/v2` (MPL-2.0) appears in the module graph as a
build-time dependency of the SQLite toolchain. It is not linked into the binary
and not shipped.
