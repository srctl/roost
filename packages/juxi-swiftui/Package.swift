// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "JuxiSwiftUI",
    platforms: [.iOS(.v16), .macOS(.v13)],
    products: [
        .library(name: "JuxiSwiftUI", targets: ["JuxiSwiftUI"])
    ],
    targets: [
        .target(name: "JuxiSwiftUI")
    ]
)
