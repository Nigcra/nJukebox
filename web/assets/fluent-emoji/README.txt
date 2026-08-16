Fluent Emoji Color - bundled subset
===================================

Why this exists
---------------

The interface uses emoji characters as icons - 73 distinct code points across
jukebox.html, the js/ modules and both locale files. Emoji are text, so they are
drawn by whatever emoji font the operating system provides: Segoe UI Emoji on
Windows, in a different cut per Windows version, and Noto Color Emoji on Linux.
The icons therefore looked different on every machine.

These files pin the design to Microsoft's Fluent Emoji, which is the artwork
Windows 11 uses, so the icons look the same everywhere. See LICENSE.txt.

Nothing is fetched at runtime. style.css references these files with relative
paths and the web server already serves assets/ recursively.


What is here
------------

The upstream webfont is split into 47 chunks, each covering a block of code
points through a unicode-range in its @font-face rule. Only the 25 chunks the
interface actually needs are bundled; the other 22 would be dead weight. The
@font-face rules live at the top of style.css, directly after the Roboto ones.

Format is COLRv1, which Chrome, Edge and Firefox support. The rules carry
tech(color-COLRv1), so a browser without that support skips the source and falls
back to the system emoji font rather than rendering empty boxes. Upstream also
ships an OT-SVG variant for Safari; it is not bundled because it costs another
1.25 MB and neither Windows nor Linux runs Safari.


Adding an emoji later
---------------------

If a new emoji does not show in the Fluent design, its code point sits in a
chunk that is not bundled. To add it:

1. Download fluentmoji-dist.zip from the release linked in LICENSE.txt.
2. In dist/color/FluentEmojiColor.css, find the @font-face block whose
   unicode-range contains the code point, and note its chunk number.
3. Copy dist/color/colrv1/chunk-NNN.woff2 into this directory.
4. Copy that block into style.css next to the others, rewriting the src to
   url(assets/fluent-emoji/chunk-NNN.woff2) format(woff2) tech(color-COLRv1)
   and dropping the otsvg source. Keep format() as the bare keyword, the way
   upstream ships it - the quoted form is valid next to tech() by the spec but
   is not what was tested.


Known gap: flags
----------------

The language switcher uses regional indicator pairs (U+1F1E9 U+1F1EA for DE,
U+1F1FA U+1F1F8 for US). Microsoft ships no flag emoji at all, so these are not
in this font and cannot be. Windows renders them as the bare letter pairs "DE"
and "US", Linux draws actual flags - that one difference remains.

Four further code points are not covered and do not need to be: U+2190, U+2192,
U+2713, U+2715 and U+2717 are arrows and check marks with text presentation by
default. They are drawn by Roboto as ordinary glyphs and already look the same
everywhere.
