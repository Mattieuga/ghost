import AppKit
import Darwin
import Foundation

struct Stage: Codable {
    let milliseconds: Double
    let residentBytes: UInt64
}

struct BenchmarkResult: Codable {
    let backend: String
    let file: String
    let bytes: UInt64
    let utf16Units: Int
    let textKit2: Bool
    let stages: [String: Stage]
    let searchFound: Bool
}

func residentBytes() -> UInt64 {
    var info = mach_task_basic_info()
    var count = mach_msg_type_number_t(MemoryLayout<mach_task_basic_info>.size / MemoryLayout<integer_t>.size)
    let status = withUnsafeMutablePointer(to: &info) { pointer in
        pointer.withMemoryRebound(to: integer_t.self, capacity: Int(count)) { rebound in
            task_info(mach_task_self_, task_flavor_t(MACH_TASK_BASIC_INFO), rebound, &count)
        }
    }
    return status == KERN_SUCCESS ? UInt64(info.resident_size) : 0
}

func elapsedMilliseconds(since start: UInt64) -> Double {
    Double(DispatchTime.now().uptimeNanoseconds - start) / 1_000_000
}

@MainActor
func runBenchmark(path: String, needle: String) throws -> BenchmarkResult {
    var stages: [String: Stage] = [:]
    let url = URL(fileURLWithPath: path)
    let bytes = try FileManager.default.attributesOfItem(atPath: path)[.size] as? NSNumber
    let byteCount = bytes?.uint64Value ?? 0

    var start = DispatchTime.now().uptimeNanoseconds
    var mappedData: Data? = try Data(contentsOf: url, options: [.mappedIfSafe])
    stages["map"] = Stage(milliseconds: elapsedMilliseconds(since: start), residentBytes: residentBytes())

    start = DispatchTime.now().uptimeNanoseconds
    var source: String? = String(decoding: mappedData!, as: UTF8.self)
    mappedData = nil
    stages["decode"] = Stage(milliseconds: elapsedMilliseconds(since: start), residentBytes: residentBytes())
    let utf16Units = source!.utf16.count

    let viewport = NSRect(x: 0, y: 0, width: 1200, height: 800)
    let window = NSWindow(contentRect: viewport, styleMask: [.borderless], backing: .buffered, defer: false)
    let scrollView = NSScrollView(frame: viewport)
    scrollView.hasVerticalScroller = true
    scrollView.hasHorizontalScroller = true
    scrollView.autohidesScrollers = true
    let textView = NSTextView(usingTextLayoutManager: true)
    textView.frame = scrollView.contentView.bounds
    textView.minSize = NSSize(width: 0, height: viewport.height)
    textView.maxSize = NSSize(
        width: CGFloat.greatestFiniteMagnitude,
        height: CGFloat.greatestFiniteMagnitude
    )
    textView.isVerticallyResizable = true
    textView.isHorizontallyResizable = true
    textView.autoresizingMask = [.width]
    textView.isRichText = false
    textView.importsGraphics = false
    textView.isAutomaticQuoteSubstitutionEnabled = false
    textView.isAutomaticDashSubstitutionEnabled = false
    textView.isAutomaticTextReplacementEnabled = false
    textView.isAutomaticSpellingCorrectionEnabled = false
    textView.font = NSFont.monospacedSystemFont(ofSize: 13, weight: .regular)
    textView.textContainerInset = NSSize(width: 12, height: 10)
    textView.textContainer?.widthTracksTextView = false
    textView.textContainer?.containerSize = NSSize(
        width: CGFloat.greatestFiniteMagnitude,
        height: CGFloat.greatestFiniteMagnitude
    )
    scrollView.documentView = textView
    window.contentView = scrollView

    start = DispatchTime.now().uptimeNanoseconds
    textView.string = source!
    source = nil
    stages["attach"] = Stage(milliseconds: elapsedMilliseconds(since: start), residentBytes: residentBytes())

    start = DispatchTime.now().uptimeNanoseconds
    window.layoutIfNeeded()
    window.displayIfNeeded()
    stages["firstLayout"] = Stage(milliseconds: elapsedMilliseconds(since: start), residentBytes: residentBytes())

    start = DispatchTime.now().uptimeNanoseconds
    if utf16Units > 0 {
        textView.scrollRangeToVisible(NSRange(location: utf16Units - 1, length: 0))
        window.displayIfNeeded()
    }
    stages["navigateEnd"] = Stage(milliseconds: elapsedMilliseconds(since: start), residentBytes: residentBytes())

    start = DispatchTime.now().uptimeNanoseconds
    let editLocation = min(utf16Units, utf16Units / 2)
    textView.textStorage?.replaceCharacters(in: NSRange(location: editLocation, length: 0), with: "x")
    window.displayIfNeeded()
    stages["edit"] = Stage(milliseconds: elapsedMilliseconds(since: start), residentBytes: residentBytes())

    start = DispatchTime.now().uptimeNanoseconds
    let found = (textView.string as NSString).range(of: needle, options: [.caseInsensitive]).location != NSNotFound
    stages["search"] = Stage(milliseconds: elapsedMilliseconds(since: start), residentBytes: residentBytes())

    start = DispatchTime.now().uptimeNanoseconds
    let saveTraversalBytes = textView.string.utf8.count
    precondition(saveTraversalBytes > 0 || byteCount == 0)
    stages["saveTraversal"] = Stage(milliseconds: elapsedMilliseconds(since: start), residentBytes: residentBytes())

    return BenchmarkResult(
        backend: "textkit2",
        file: path,
        bytes: byteCount,
        utf16Units: utf16Units,
        textKit2: textView.textLayoutManager != nil,
        stages: stages,
        searchFound: found
    )
}

@main
struct TextKitBenchmark {
    @MainActor
    static func main() throws {
        guard CommandLine.arguments.count >= 2 else {
            FileHandle.standardError.write(Data("usage: textkit-benchmark FILE [NEEDLE]\n".utf8))
            exit(2)
        }
        _ = NSApplication.shared
        let result = try autoreleasepool {
            try runBenchmark(
                path: CommandLine.arguments[1],
                needle: CommandLine.arguments.count > 2 ? CommandLine.arguments[2] : "the"
            )
        }
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        FileHandle.standardOutput.write(try encoder.encode(result))
        FileHandle.standardOutput.write(Data("\n".utf8))
    }
}
