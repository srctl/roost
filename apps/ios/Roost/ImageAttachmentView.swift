import CryptoKit
import ImageIO
import SwiftUI

extension Attachment {
    var isImage: Bool { mimeType.lowercased().hasPrefix("image/") }
}

// Authenticated images stay in memory. The cache is scoped to the device token
// as well as the server, agent, and file, and never uses a public image URL.
@MainActor final class ImageThumbnailStore {
    static let shared = ImageThumbnailStore()
    private let cache = NSCache<NSString, UIImage>()
    private var requests: [String: Task<UIImage, Error>] = [:]
    private var generation = 0
    private var activeDownloads = 0
    private var waiting: [CheckedContinuation<Void, Never>] = []
    private let download: (Attachment, String, RoostAPI) async throws -> Data

    init(
        download: @escaping (Attachment, String, RoostAPI) async throws -> Data = {
            attachment, agentId, api in
            try await api.request(
                "files",
                query: [
                    URLQueryItem(name: "agentId", value: agentId),
                    URLQueryItem(name: "id", value: attachment.id),
                ])
        }
    ) {
        self.download = download
        cache.countLimit = 60
        cache.totalCostLimit = 32 * 1024 * 1024
    }

    func clear() {
        generation += 1
        cache.removeAllObjects()
        for request in requests.values { request.cancel() }
        requests.removeAll()
    }

    func load(_ attachment: Attachment, agentId: String, api: RoostAPI) async throws -> UIImage {
        guard attachment.isImage, attachment.size <= 20 * 1024 * 1024 else {
            throw APIError(message: "This image is too large to preview.")
        }
        let identity =
            api.connection.server.absoluteString + "|" + api.connection.token
            + "|" + agentId + "|" + attachment.id
        let key = SHA256.hash(data: Data(identity.utf8)).map { String(format: "%02x", $0) }.joined()
        if let image = cache.object(forKey: key as NSString) { return image }
        if let request = requests[key] { return try await request.value }
        let generation = generation
        let request = Task {
            await acquireDownload()
            defer { releaseDownload() }
            try Task.checkCancellation()
            let bytes = try await download(attachment, agentId, api)
            try Task.checkCancellation()
            guard generation == self.generation else { throw CancellationError() }
            let image =
                try await Task.detached(priority: .utility) {
                    try Self.decode(bytes)
                }
                .value
            try Task.checkCancellation()
            guard generation == self.generation else { throw CancellationError() }
            cache.setObject(
                image, forKey: key as NSString,
                cost: Int(image.size.width * image.size.height * image.scale * image.scale * 4))
            return image
        }
        requests[key] = request
        defer { if generation == self.generation { requests[key] = nil } }
        return try await request.value
    }

    private func acquireDownload() async {
        if activeDownloads < 3 {
            activeDownloads += 1
        } else {
            await withCheckedContinuation { waiting.append($0) }
        }
    }

    private func releaseDownload() {
        if waiting.isEmpty { activeDownloads -= 1 } else { waiting.removeFirst().resume() }
    }

    nonisolated static func decode(_ data: Data) throws -> UIImage {
        guard data.count <= 20 * 1024 * 1024,
            let source = CGImageSourceCreateWithData(
                data as CFData,
                [
                    kCGImageSourceShouldCache: false
                ] as CFDictionary),
            let thumbnail = CGImageSourceCreateThumbnailAtIndex(
                source, 0,
                [
                    kCGImageSourceCreateThumbnailFromImageAlways: true,
                    kCGImageSourceCreateThumbnailWithTransform: true,
                    kCGImageSourceThumbnailMaxPixelSize: 1_000,
                    kCGImageSourceShouldCacheImmediately: true,
                ] as CFDictionary)
        else { throw APIError(message: "This image could not be previewed.") }
        return UIImage(cgImage: thumbnail)
    }
}

struct ImageAttachmentView: View {
    @Environment(\.palette) private var palette
    let attachment: Attachment
    let agentId: String
    let api: RoostAPI
    var thumbnail = false
    var onStateChanged: ((String) -> Void)? = nil
    @State private var image: UIImage?
    @State private var failed = false

    private var aspectRatio: CGFloat {
        guard let image else { return 4 / 3 }
        return image.size.width / max(1, image.size.height)
    }

    var body: some View {
        Group {
            if let image {
                Image(uiImage: image)
                    .resizable()
                    .aspectRatio(contentMode: thumbnail ? .fill : .fit)
                    .accessibilityIdentifier("imagePreview-" + attachment.id)
            } else {
                VStack(spacing: 8) {
                    if failed {
                        Image(systemName: "photo.badge.exclamationmark")
                        if !thumbnail { Text("Tap to open image").font(.caption) }
                    } else {
                        ProgressView()
                        if !thumbnail { Text("Loading image…").font(.caption) }
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .foregroundStyle(palette.muted)
            }
        }
        .aspectRatio(thumbnail ? 1 : aspectRatio, contentMode: .fit)
        .frame(width: thumbnail ? 76 : nil, height: thumbnail ? 76 : nil)
        .frame(maxWidth: thumbnail ? 76 : .infinity, maxHeight: thumbnail ? 76 : 280)
        .background(palette.surface)
        .clipShape(RoundedRectangle(cornerRadius: thumbnail ? 12 : 10))
        .accessibilityLabel(attachment.name)
        .accessibilityValue(
            image != nil ? "Image preview" : failed ? "Preview unavailable" : "Loading image"
        )
        .task(id: attachment.id) {
            do {
                image = try await ImageThumbnailStore.shared.load(
                    attachment, agentId: agentId, api: api)
                failed = false
                onStateChanged?("Image preview")
            } catch is CancellationError {
            } catch {
                failed = true
                onStateChanged?("Preview unavailable")
            }
        }
    }
}
