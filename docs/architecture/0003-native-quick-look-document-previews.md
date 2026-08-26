# ADR 0003: Native Quick Look document previews

- Status: Accepted for prototype
- Date: 2026-08-25
- Related architecture: [`0001-extensible-file-viewers.md`](0001-extensible-file-viewers.md)
- Related large-file decision: [`0002-bounded-large-file-loading.md`](0002-bounded-large-file-loading.md)
- Implementation plan: [`../plans/2026-08-25-feat-native-quick-look-plan.md`](../plans/2026-08-25-feat-native-quick-look-plan.md)

## Context

Ghost has dedicated editors or viewers for text, Markdown, CSV, HTML, images,
PDF, fonts, audio, video, and archives. Office, iWork, rich text, and
OpenDocument files still fall through to Open Externally even though macOS can
preview many of them through Quick Look.

Building format-specific renderers would duplicate operating-system support,
introduce conversion fidelity problems, and often require loading complete
binary documents into JavaScript. Editing those formats safely is a separate,
substantially larger problem: a visually plausible renderer does not establish
lossless round-tripping.

Ghost already embeds one native PDFKit view over the Tauri webview. That proves
the required frame, focus, window, and cleanup integration, and gives Quick
Look a known native-view lifecycle to follow.

## Decision

Ghost will prototype an inline macOS `QLPreviewView` for explicitly recognized
document families:

- Microsoft Word: DOC, DOCX, DOCM, DOT, DOTX, and DOTM;
- Microsoft Excel: XLS, XLSX, XLSM, XLSB, XLT, XLTX, and XLTM;
- Microsoft PowerPoint: PPT, PPTX, PPTM, PPS, PPSX, PPSM, POT, POTX, and POTM;
- Apple iWork: Pages, Numbers, and Keynote;
- rich text: RTF;
- OpenDocument: ODT, ODS, and ODP.

These files receive a positive `quick-look` descriptor with `viewer-owned`
loading and read-only capabilities. Ghost passes only a canonical file URL to
Quick Look; it does not serialize the file across Tauri IPC, convert it, or
write it. Dedicated Ghost viewers continue to take precedence over Quick Look.

The native view is mounted over a React-owned rectangle, follows that rectangle
through resize and layout changes, accepts editor focus, refreshes when the file
changes, and is explicitly closed and released on navigation or window
destruction. The existing Open Externally action remains available.

Finder's `QLPreviewPanel` and the public embedded `QLPreviewView` do not expose
identical interaction behavior. On current macOS releases, the embedded mode
forces generated Office HTML to `-webkit-user-select: none`, while the panel
mode exposes native text selection and Copy. Ghost dynamically checks for Quick
Look's panel-mode selector and enables that mode before assigning the preview
item. If the selector is absent on a future or older macOS release, Ghost falls
back to the documented embedded mode rather than failing the preview. This is
an explicitly accepted private-API dependency for Ghost's direct distribution;
it would need removal or replacement before a Mac App Store submission.

The prototype routes only known document extensions. It does not yet replace
the generic unsupported-file fallback because installed Quick Look extensions
vary by machine and `QLPreviewView` does not provide a reliable synchronous
"will render" result before its asynchronous preview pipeline runs.

## Resource policy

Ghost imposes no encoded-byte ceiling on direct Quick Look documents. Like the
PDFKit path, Quick Look receives a file URL and owns its native working set;
the webview never holds a duplicate encoded document. This does not promise
that every document or third-party preview extension will render successfully.
Failure leaves the original untouched and Open Externally available.

## Alternatives considered

### JavaScript Office renderers

Rejected for the first implementation. Separate DOCX, spreadsheet, and
presentation libraries would produce inconsistent fidelity, increase bundle
and maintenance cost, and frequently require full-file IPC.

### Convert documents to PDF or HTML before previewing

Rejected because conversion is lossy, may require Office or LibreOffice, needs
temporary-file lifecycle and resource limits, and still does not enable safe
editing.

### Use the floating Quick Look panel

Rejected as the primary experience. A separate system panel is useful as an
action, but an inline preview preserves Ghost's sidebar navigation, accessory
windows, and single-window reading flow.

### Route every unsupported binary through Quick Look

Deferred. That may broaden coverage later, but the first prototype needs clear
classification, predictable testing, and an unchanged fallback for files that
Quick Look cannot render.

## Consequences

### Positive

- One native integration covers several high-value document families.
- Preview fidelity and format support track the installed macOS Quick Look
  stack.
- Binary documents remain byte-for-byte untouched.
- Large documents do not cross the JavaScript bridge.
- The viewer fits the existing positive classification architecture.

### Costs and limitations

- The feature is macOS-specific.
- Preview quality and supported variants can differ across macOS versions and
  installed Quick Look extensions.
- Quick Look's internal loading/error state is less observable than a custom
  renderer, so the prototype must be judged manually across representative
  documents.
- Selectable inline Office previews currently rely on a dynamically guarded
  private Quick Look mode. Apple may change or remove it; the failure mode is a
  visible but non-selectable public `QLPreviewView`, not file corruption.
- Editing, document structure, comments, spreadsheet formulas, and slide-level
  controls remain out of scope.
- RTFD is not part of the first prototype. Existing iWork document packages
  are accepted when macOS identifies them as file packages.

## Migration path

1. Prototype the explicit document descriptor and embedded native surface.
2. Run a representative Office, iWork, RTF, and OpenDocument compatibility
   matrix on supported macOS versions.
3. Productionize error handling, lifecycle behavior, accessibility, and any
   useful native actions exposed by the prototype.
4. Decide whether to expand Quick Look to more explicit extensions or to a
   user-invoked fallback for otherwise unsupported binaries.
5. Treat any editable document format as a new format-specific ADR with a
   demonstrated round-trip model.
