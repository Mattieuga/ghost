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
| PDF | `.pdf` | Multi-page read-only viewer with trackpad pinch zoom |
| Fonts | `.ttf`, `.otf`, `.woff`, `.woff2` | Read-only specimen with editable sample text and preview size |
| Audio | See [Audio](#audio) | Custom player backed by WebKit |
| Video | See [Video](#video) | Custom player backed by WebKit, with fullscreen when available |
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
text-like UTF-8, Ghost opens the complete file in the source editor. Invalid
UTF-8 and control-heavy binary data are never treated as editable text.

The ambiguous `.ts` and `.mts` extensions are content-probed: textual files
open as TypeScript, while binary MPEG transport streams open in the video
viewer.

## Images

| Extensions | Notes |
| --- | --- |
| `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.bmp` | Standard WebKit/macOS image decoding |
| `.ico` | Windows icon preview |
| `.icns` | Ghost extracts and renders the largest available icon representation |
| `.heic`, `.heif` | Availability depends on the installed macOS image codecs |
| `.tiff`, `.tif` | TIFF preview |
| `.svg` | Separate live preview plus editable source viewer |

Images display their intrinsic dimensions and file size when available.

## PDF and fonts

PDFs are rendered with PDF.js as a continuous multi-page document. The viewer
supports ordinary scrolling and two-finger pinch zoom, but does not edit or
rewrite PDFs.

TTF, OTF, WOFF, and WOFF2 fonts open in a specimen viewer. The sample text and
preview size are adjustable, while the font file itself remains read-only.

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

## Not currently previewed

Office documents (`.doc`, `.docx`, `.xls`, `.xlsx`, `.ppt`, `.pptx`, `.odt`,
`.ods`, `.odp`), archives, disk images, executables, and other binary formats do
not have built-in viewers. Ghost leaves them untouched and offers **Open
Externally**. RTF is editable as raw text source; it is not rendered as a rich
text document.
