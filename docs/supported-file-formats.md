# Supported file formats

Ghost uses a file's extension to select an editor or viewer, then applies
content detection where an extension is unknown or ambiguous. Text formats are
editable. Binary formats use dedicated read-only viewers or can be opened in
their default macOS application.

For audio and video, a recognized container is not a guarantee that every codec
inside it can be played. Ghost delegates decoding to the Mac's WebKit and media
frameworks so playback support can vary with macOS, hardware, codec profile,
and how the file was encoded.

## At a glance

| Content | Extensions or filenames | Ghost behavior |
| --- | --- | --- |
| Markdown | `.md`, `.markdown`, `.mkd`, `.mdown`, `.mkdn`, `.mdwn` | Rich editor; source mode when exact markup must be preserved |
| MDX | `.mdx` | Source-code editor |
| Tabular text | `.csv`, `.tsv` | Editable table and source modes |
| SVG | `.svg` | Live image preview and editable XML source |
| Raster images | `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.bmp`, `.ico`, `.icns`, `.heic`, `.heif`, `.tiff`, `.tif` | Read-only image preview |
| PDF | `.pdf` | Native PDFKit continuous read-only viewer with selection, Find, and zoom |
| Fonts | `.ttf`, `.otf`, `.woff`, `.woff2` | Read-only specimen with editable sample text and preview size |
| Audio | See [Audio](#audio) | Custom player backed by WebKit |
| Video | See [Video](#video) | Custom player backed by WebKit, with fullscreen when available |
| Archives | See [Archives](#archives) | Read-only searchable browser with explicit macOS-backed extraction |
| Source code and configuration | See [Code and text](#code-and-text) | Editable CodeMirror source editor |
| Unknown UTF-8 text | Any other extension that passes Ghost's text probe | Editable plain-text source editor |
| Other binary files | Any format without a viewer | File information and **Open Externally** |

## Markdown and structured text

YAML frontmatter at the beginning of a Markdown file is kept outside Tiptap and
preserved when the document is saved. Markdown containing MDX, comments, custom
HTML, or markup Ghost cannot reproduce safely opens in the source editor instead
of being silently normalized. Ghost-owned resizable images and table metadata
remain available in the rich editor.

CSV and TSV files can switch between an editable table and their delimited text
source. SVG files pair a live preview with an editable XML source view.

## Code and text

Ghost bundles CodeMirror language support for common web, native, scripting,
data, configuration, database, documentation, and build formats. Representative
languages include:

- Apple development: Swift, Objective-C, Objective-C++, Metal, property lists,
  entitlements, storyboards, Xcode projects/configuration, and
  `Package.resolved`.
- Web development: HTML, CSS, Sass, SCSS, Less, Stylus, JavaScript, JSX,
  TypeScript, TSX, Vue, Svelte, Astro, PHP, Pug, Liquid, Jinja, Handlebars, and
  common template formats.
- Native and application development: C, C++, CUDA, C#, D, Dart, Go, Java,
  Kotlin, Rust, Scala, Haxe, Crystal, Fortran, Pascal, and WebAssembly.
- Scripting and functional languages: Python, Ruby, Shell, Fish, Zsh, Perl,
  PowerShell, Lua, Tcl, R, Julia, Haskell, OCaml, F#, Erlang, Elixir, Clojure,
  Scheme, Common Lisp, and Racket.
- Data and configuration: JSON and common JSON variants, YAML, TOML, XML,
  INI/properties, GraphQL, Protocol Buffers, Terraform/HCL, Nix, Dhall, KDL,
  CUE, Rego, Prisma, Thrift, Avro, and Jsonnet.
- Databases and query languages: SQL, PostgreSQL, MySQL/MariaDB, MS SQL,
  SQLite, PLSQL, CQL, Cypher, SPARQL, and Solr.
- Documentation, build, and operations: reStructuredText, AsciiDoc, Org,
  LaTeX, Dockerfiles, Makefiles, CMake, Bazel, Meson, Gradle, Nginx, HTTP request
  files, diffs/patches, and shader source.

Ghost also explicitly treats the following as editable plain text when no
special syntax package exists:

```text
txt text log env cfg conf lock rtf rc
gitignore gitattributes gitmodules gitconfig gitkeep mailmap editorconfig
dockerignore htaccess htpasswd npmrc nvmrc browserslistrc eslintignore
prettierignore stylelintrc prettierrc eslintrc babelrc
fish nu zig zon nim nims nimble ex exs sol move cairo gleam roc odin jai mojo
vala vapi awk sed ada adb ads apex trigger as ahk ahkl applescript bat cmd
raku rakumod rakutest prolog qml graphql gql prisma thrift avro tf tfvars hcl
nix dhall kdl cue rego nomad bicep jsonnet libsonnet rst adoc asciidoc org
creole mk mak just xcconfig pbxproj strings glsl hlsl vert frag geom tesc tese comp
```

Extensionless and special filenames include `.env` variants, `Dockerfile`,
`Makefile`, `Justfile`, `Procfile`, `Caddyfile`, `CMakeLists.txt`, `Gemfile`,
`Rakefile`, `Jenkinsfile`, `PKGBUILD`, `Brewfile`, `Podfile`, `Fastfile`,
`Vagrantfile`, `WORKSPACE`, and Bazel/Meson build files.

Unknown files receive a bounded UTF-8 text probe. If the contents are valid,
text-like UTF-8, Ghost applies the same source-size policy as known text rather
than first loading the complete file. Invalid UTF-8 and control-heavy binary
data are never treated as editable text.

The ambiguous `.ts` and `.mts` extensions are content-probed: textual files
open as TypeScript, while binary MPEG transport streams open in the video
viewer.

## Images

| Extensions | Notes |
| --- | --- |
| `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.bmp` | Standard WebKit/macOS image decoding |
| `.ico` | Windows icon preview |
| `.icns` | ImageIO renders an orientation-aware bounded icon thumbnail |
| `.heic`, `.heif` | Availability depends on the installed macOS image codecs |
| `.tiff`, `.tif` | TIFF preview |
| `.svg` | Separate live preview plus editable source viewer |

Images display their intrinsic dimensions and file size when available.

## PDF and fonts

PDFs are rendered by macOS PDFKit as a continuous multi-page document loaded
directly from its file URL. The viewer supports native scrolling, trackpad
zoom, selection/copy, page navigation, and Find without transferring the whole
PDF through JavaScript. PDFs remain read-only; encrypted documents currently
offer **Open Externally** for unlocking.

TTF, OTF, WOFF, and WOFF2 fonts open in a specimen viewer. The sample text and
preview size are adjustable, while the font file itself remains read-only.

## Resource and large-file policy

Ghost chooses capabilities from encoded size and format-specific working-set
cost before loading a body. These are the current safety budgets, not claims
that a valid file becomes invalid at the boundary.

| Resource | Boundary | Behavior |
| --- | --- | --- |
| Source text | At most 20 MiB, 300,000 lines, and 200 KiB per line | Fully featured editable CodeMirror |
| Large source text | Through 128 MiB, 5,000,000 lines, and 8 MiB per line | Editable CodeMirror; syntax, folding, wrapping, bracket helpers, and eager match counts disabled |
| Extreme source text | Above 128 MiB, 5,000,000 lines, or 8 MiB for one line | Read-only 512 KiB windows with optimized native Find, active-match highlighting, and Open Externally |
| Rich Markdown | Through 4 MiB and 100,000 lines | Rich Tiptap editor; larger documents open as exact editable source |
| CSV/TSV table | Through 8 MiB and 100,000 rows | Virtualized table/source UI; larger files open as editable source |
| Rendered SVG | Through 5 MiB | Rendered/source split; larger SVGs open as source only |
| Ordinary image | At most 40 million decoded pixels and estimated 128 MiB RGBA | Direct scoped file URL |
| Oversized image or ICNS | Above the image budget | ImageIO thumbnail, maximum 3,072 pixels on the longest edge and 32 MiB encoded output |
| Font | Through 64 MiB encoded | Scoped file URL specimen; larger fonts fail safely |
| Audio/video | No Ghost encoded-byte ceiling | Range-capable scoped URL; actual codec/platform limits still apply |
| PDF | No Ghost encoded-byte ceiling | PDFKit file URL with a native visible-page working set |
| Quick Open preview | 64 KiB | Prefix only; an ellipsis marks truncation |
| Copy Text As | Through 20 MiB | Complete explicit copy; larger requests are rejected with guidance |

CodeMirror saves use bounded chunks and atomic replacement, including for
renames and CRLF/Unicode documents. The extreme viewer never autosaves a
partial window. Clipboard/browser image insertion is capped at 64 MiB because
the browser supplies a complete `File`; the file picker and filesystem drops
copy larger image files natively, after which the decoded-pixel policy applies.

## Audio

Ghost recognizes these audio extensions:

```text
mp3 m4a m4b aac wav wave bwf aif aiff aifc caf flac ogg oga opus
au snd ac3 eac3 ec3
```

MP3, AAC/M4A, WAV, AIFF, CAF, FLAC, and AU are the most broadly compatible on
modern Macs. Ogg/Vorbis/Opus and AC-3/E-AC-3 support depends more strongly on
the installed macOS and the exact container/codec combination. A decoder
failure produces an explanation and **Open Externally** rather than changing
the file.

## Video

Ghost recognizes these video extensions:

```text
mp4 m4v mov qt webm ogv mpeg mpg mpe m1v m2v ts m2ts mts 3gp 3g2
mkv avi wmv asf flv f4v
```

### Reliable baseline

- `.mp4`, `.m4v`, and `.mov` containing H.264 video and AAC audio.
- `.webm` containing VP8 or VP9 video with Vorbis or Opus audio on modern
  macOS releases.

Apple recommends H.264-encoded MP4 for broadly compatible static video.
WebKit has supported the WebM container with VP8/VP9 on macOS since Safari
14.1.

### Hardware, OS, or encoding dependent

- HEVC/H.265 in MP4 or MOV.
- AV1 in MP4 or WebM; WebKit requires supported hardware for many AV1 paths.
- MPEG program/transport streams (`.mpeg`, `.mpg`, `.mpe`, `.m1v`, `.m2v`,
  `.ts`, `.m2ts`, `.mts`).
- `.3gp`, `.3g2`, `.f4v`, and Ogg/Theora `.ogv`.

Support is determined by the streams inside the container, not the extension
alone. For example, one H.264/AAC MP4 can play while an HEVC MP4 test vector is
rejected by the same Mac.

### Recognized for graceful fallback

`.mkv`, `.avi`, `.wmv`, `.asf`, and `.flv` are routed to the video viewer so
Ghost can present a useful codec/format error and **Open Externally**. They are
not currently reliable WebKit playback formats. Broad, consistent playback for
these containers would require Ghost to bundle and maintain a separate media
decoder such as FFmpeg or libmpv.

References:

- [Apple: Delivering Video Content for Safari](https://developer.apple.com/documentation/webkit/delivering-video-content-for-safari)
- [WebKit: WebM support in Safari 14.1](https://webkit.org/blog/11648/new-webkit-features-in-safari-14-1/)
- [WebKit: AV1 and media containers in Safari 17](https://webkit.org/blog/14445/webkit-features-in-safari-17-0/)
- [WebKit: additional media codecs in Safari 17.4](https://webkit.org/blog/15063/webkit-features-in-safari-17-4/)

## Archives

Ghost recognizes these archive extensions:

```text
zip tar tar.gz tgz tar.bz2 tbz tbz2 tar.xz txz tar.zst tzst cpio cpgz 7z rar gz bz2
```

The archive browser shows a searchable folder hierarchy, entry sizes and
timestamps, and compressed and uncompressed totals without extracting the
archive. ZIP, TAR, and the common compressed TAR variants are the reliable
baseline. CPIO, 7-Zip, RAR, and Zstandard support depends on the libarchive
version included with the installed macOS release; unsupported, corrupt, or
encrypted archives show an error and **Open Externally**.

Select a regular file and press **Space** or **Return**, double-click it, or use
**Preview** to open a read-only preview beside the archive tree. This works
through the same macOS archive reader for every archive family above whenever
that macOS version can read the container. Ghost reuses its source, image, PDF,
font, audio, and video viewers; directories, links, duplicate paths, nested
archives, encrypted entries, and unidentified binary payloads are not opened.

Preview decompression goes only to Ghost's session cache, never beside the
archive. Declared entries above the absolute 256 MiB ceiling are rejected
before extraction starts, and the Preview control is disabled for those known
oversized entries. For smaller entries, Ghost sniffs at most 16 KiB and
then rejects a declared size above the detected text/document/media budget.
Expanded text is limited to 10 MiB,
images/PDF/fonts to 100 MiB, and audio/video to 256 MiB, with a 30-second
operation limit and 512 MiB cache budget. Partial and abandoned previews are
removed automatically, and the session cache is cleared when Ghost quits or
next launches after a crash.

**Extract…** asks for a parent folder, creates a new collision-free directory
named after the archive, extracts with macOS's `/usr/bin/tar`, and reveals the
result in Finder. Ghost never extracts merely because an archive was opened.
The system extractor's absolute-path, parent-traversal, and symlink protections
remain enabled, existing destination folders are not overwritten, and full
archived ownership or special permission bits are not restored.

Raw `.gz` and `.bz2` compression streams appear as one-file archives and use
the same bounded preview cache plus macOS's built-in gzip and bzip2 tools for
explicit extraction. Ghost preserves
the original filename stored in a gzip header when present; bzip2 does not store
a filename, so Ghost removes the `.bz2` suffix. Raw `.xz` and `.zst` streams do
not yet have a dedicated viewer because macOS does not ship standalone decoders
for them. Their TAR-wrapped forms remain platform-dependent as described above.

## Not currently previewed

Office documents (`.doc`, `.docx`, `.xls`, `.xlsx`, `.ppt`, `.pptx`, `.odt`,
`.ods`, `.odp`), disk images, executables, and other binary formats do
not have built-in viewers. Ghost leaves them untouched and offers **Open
Externally**. RTF is editable as raw text source; it is not rendered as a rich
text document.
