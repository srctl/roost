import UIKit
import XCTest

@testable import Roost

final class ImageCacheTests: XCTestCase {
    @MainActor private final class Downloads {
        var count = 0
        var pending: [Int: CheckedContinuation<Data, Error>] = [:]
        var arrivals: [Int: CheckedContinuation<Void, Never>] = [:]

        func next() async throws -> Data {
            count += 1
            let index = count
            return try await withCheckedThrowingContinuation { continuation in
                pending[index] = continuation
                arrivals.removeValue(forKey: index)?.resume()
            }
        }

        func waitFor(_ index: Int) async {
            if count >= index { return }
            await withCheckedContinuation { arrivals[index] = $0 }
        }

        func finish(_ index: Int, bytes: Data) {
            pending.removeValue(forKey: index)?.resume(returning: bytes)
        }
    }

    @MainActor func testOldRequestCannotRemoveOrRepopulateNewSessionCache() async throws {
        let downloads = Downloads()
        let store = ImageThumbnailStore(download: { _, _, _ in try await downloads.next() })
        let api = RoostAPI(
            connection: Connection(
                server: URL(string: "https://roost.example")!, token: "fixture"))
        let attachment = Attachment(
            id: "image", name: "Image.png", mimeType: "image/png", size: 100)
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        let bytes = UIGraphicsImageRenderer(size: CGSize(width: 2, height: 2), format: format)
            .pngData { context in
                UIColor.green.setFill()
                context.fill(CGRect(x: 0, y: 0, width: 2, height: 2))
            }
        let original = Task { try await store.load(attachment, agentId: "agent", api: api) }
        await downloads.waitFor(1)
        store.clear()
        let replacement = Task { try await store.load(attachment, agentId: "agent", api: api) }
        await downloads.waitFor(2)
        downloads.finish(1, bytes: bytes)
        do {
            _ = try await original.value
            XCTFail("The retired download must remain cancelled")
            throw APIError(message: "Retired download was not cancelled")
        } catch is CancellationError {}

        // The retired task's cleanup must not remove the replacement task.
        // Clearing again must cancel that replacement even with identical IDs.
        store.clear()
        downloads.finish(2, bytes: bytes)
        do {
            _ = try await replacement.value
            XCTFail("A replacement download must not repopulate a cleared cache")
            throw APIError(message: "Cleared cache was repopulated")
        } catch is CancellationError {}

        let fresh = Task { try await store.load(attachment, agentId: "agent", api: api) }
        await downloads.waitFor(3)
        downloads.finish(3, bytes: bytes)
        let image = try await fresh.value
        XCTAssertEqual(image.size, CGSize(width: 2, height: 2))
        _ = try await store.load(attachment, agentId: "agent", api: api)
        XCTAssertEqual(downloads.count, 3, "Only the current session image should be cached")
    }
}
