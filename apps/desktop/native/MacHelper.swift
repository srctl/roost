import AppKit
import ApplicationServices
import ScreenCaptureKit

enum HelperError: Error { case invalidInput, permissionRequired, captureFailed }

let keyCodes: [String: CGKeyCode] = [
    "a": 0, "s": 1, "d": 2, "f": 3, "h": 4, "g": 5, "z": 6, "x": 7, "c": 8, "v": 9,
    "b": 11, "q": 12, "w": 13, "e": 14, "r": 15, "y": 16, "t": 17, "1": 18, "2": 19,
    "3": 20, "4": 21, "6": 22, "5": 23, "9": 25, "7": 26, "8": 28, "0": 29, "o": 31,
    "u": 32, "i": 34, "p": 35, "return": 36, "enter": 36, "l": 37, "j": 38, "k": 40,
    "n": 45, "m": 46, "tab": 48, "space": 49, "backspace": 51, "delete": 51, "escape": 53,
    "esc": 53, "home": 115, "pageup": 116, "end": 119, "pagedown": 121,
    "left": 123, "right": 124, "down": 125, "up": 126,
]

func shortcut(_ key: String) throws -> (CGKeyCode, CGEventFlags) {
    let parts = key.lowercased().split(separator: "+").map(String.init)
    guard let last = parts.last, let code = keyCodes[last], parts.count <= 5 else { throw HelperError.invalidInput }
    var flags: CGEventFlags = []
    for modifier in parts.dropLast() {
        switch modifier {
        case "cmd", "command", "super", "meta": flags.insert(.maskCommand)
        case "ctrl", "control": flags.insert(.maskControl)
        case "alt", "option": flags.insert(.maskAlternate)
        case "shift": flags.insert(.maskShift)
        default: throw HelperError.invalidInput
        }
    }
    return (code, flags)
}

func output(_ value: [String: Any]) throws {
    FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject: value))
}

func capture() async throws {
    let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
    guard let display = content.displays.first(where: { $0.displayID == CGMainDisplayID() }) else { throw HelperError.captureFailed }
    let bounds = CGDisplayBounds(display.displayID)
    let scale = min(1.0, 1600.0 / bounds.width, 1200.0 / bounds.height)
    let configuration = SCStreamConfiguration()
    configuration.width = Int(bounds.width * scale)
    configuration.height = Int(bounds.height * scale)
    configuration.showsCursor = true
    let filter = SCContentFilter(display: display, excludingWindows: [])
    let image = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: configuration)
    let bitmap = NSBitmapImageRep(cgImage: image)
    guard let jpeg = bitmap.representation(using: .jpeg, properties: [.compressionFactor: 0.7]) else { throw HelperError.captureFailed }
    try output([
        "dataURL": "data:image/jpeg;base64," + jpeg.base64EncodedString(),
        "width": image.width, "height": image.height,
        "bounds": ["x": bounds.origin.x, "y": bounds.origin.y, "width": bounds.width, "height": bounds.height],
    ])
}

func input(_ value: [String: Any], action: String) throws {
    guard AXIsProcessTrusted() else { throw HelperError.permissionRequired }
    if action == "click" || action == "move" {
        guard let x = value["x"] as? Double, let y = value["y"] as? Double, x.isFinite, y.isFinite else { throw HelperError.invalidInput }
        let point = CGPoint(x: x, y: y)
        guard CGDisplayBounds(CGMainDisplayID()).contains(point) else { throw HelperError.invalidInput }
        guard let move = CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: point, mouseButton: .left) else { throw HelperError.invalidInput }
        move.post(tap: .cghidEventTap)
        if action == "click" {
            let right = value["button"] as? String == "right"
            let count = value["clicks"] as? Int ?? 1
            guard (1...2).contains(count) else { throw HelperError.invalidInput }
            for number in 1...count {
                guard let down = CGEvent(mouseEventSource: nil, mouseType: right ? .rightMouseDown : .leftMouseDown, mouseCursorPosition: point, mouseButton: right ? .right : .left),
                      let up = CGEvent(mouseEventSource: nil, mouseType: right ? .rightMouseUp : .leftMouseUp, mouseCursorPosition: point, mouseButton: right ? .right : .left) else { throw HelperError.invalidInput }
                down.setIntegerValueField(.mouseEventClickState, value: Int64(number))
                up.setIntegerValueField(.mouseEventClickState, value: Int64(number))
                down.post(tap: .cghidEventTap); up.post(tap: .cghidEventTap)
                usleep(60000)
            }
        }
    } else if action == "scroll" {
        guard let amount = value["amount"] as? Int, (1...10).contains(amount), let direction = value["direction"] as? String, ["up", "down"].contains(direction) else { throw HelperError.invalidInput }
        guard let event = CGEvent(scrollWheelEvent2Source: nil, units: .line, wheelCount: 1, wheel1: Int32(amount * (direction == "up" ? 1 : -1)), wheel2: 0, wheel3: 0) else { throw HelperError.invalidInput }
        event.post(tap: .cghidEventTap)
    } else if action == "key" {
        guard let key = value["key"] as? String else { throw HelperError.invalidInput }
        let (code, flags) = try shortcut(key)
        for pressed in [true, false] {
            guard let event = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: pressed) else { throw HelperError.invalidInput }
            event.flags = flags
            event.post(tap: .cghidEventTap)
        }
    } else if action == "type" {
        guard let text = value["text"] as? String, text.utf16.count <= 10000 else { throw HelperError.invalidInput }
        // Small Unicode batches preserve non-ASCII text without changing the
        // user's clipboard or relying on their keyboard layout.
        let characters = Array(text.utf16)
        for start in stride(from: 0, to: characters.count, by: 20) {
            let batch = Array(characters[start..<min(start + 20, characters.count)])
            guard let event = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: true) else { throw HelperError.invalidInput }
            batch.withUnsafeBufferPointer { event.keyboardSetUnicodeString(stringLength: batch.count, unicodeString: $0.baseAddress!) }
            event.post(tap: .cghidEventTap)
            event.type = .keyUp
            event.post(tap: .cghidEventTap)
        }
    } else { throw HelperError.invalidInput }
}

@main struct MacHelper {
    static func main() async {
        do {
            if CommandLine.arguments.contains("--self-test") {
                guard try shortcut("cmd+shift+l").0 == 37, try shortcut("Return").0 == 36 else { throw HelperError.invalidInput }
                try output(["ok": true]); return
            }
            let data = FileHandle.standardInput.readDataToEndOfFile()
            guard data.count <= 40000, let value = try JSONSerialization.jsonObject(with: data) as? [String: Any], let action = value["action"] as? String else { throw HelperError.invalidInput }
            if action == "screenshot" { try await capture() }
            else { try input(value, action: action); try await Task.sleep(for: .milliseconds(150)); try output(["ok": true]) }
        } catch {
            // Avoid logging private text or raw screen contents on failure.
            FileHandle.standardError.write(Data("Mac access failed. Check permissions and action arguments.\n".utf8))
            exit(1)
        }
    }
}
