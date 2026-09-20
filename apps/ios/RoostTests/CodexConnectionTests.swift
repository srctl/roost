import XCTest

@testable import Roost

final class CodexConnectionTests: XCTestCase {
    func testCodexSignInAllowsOnlyExactOpenAIHTTPSOrigin() {
        for url in [
            "http://auth.openai.com/device", "https://auth.openai.com.evil.example/device",
            "https://evil.example/auth.openai.com", "https://user:password@auth.openai.com/device",
            "https://auth.openai.com:8443/device", "https://auth.openai.com./device",
            "file:///tmp/device", "javascript:alert(1)",
        ] {
            XCTAssertNil(login(url).signInURL, url)
        }
        XCTAssertNotNil(login("https://auth.openai.com/codex/device").signInURL)
        XCTAssertNotNil(login("https://auth.openai.com:443/codex/device").signInURL)
    }

    func testConnectedLoginDoesNotRequireOrRetainOneTimeCode() throws {
        let data = Data(#"{"configured":true,"login":{"status":"connected"}}"#.utf8)
        let state = try JSONDecoder().decode(CodexAccountState.self, from: data)
        XCTAssertTrue(state.configured)
        XCTAssertEqual(state.login.status, "connected")
        XCTAssertNil(state.login.userCode)
        XCTAssertNil(state.login.loginId)
        XCTAssertNil(state.login.signInURL)
    }

    private func login(_ url: String) -> CodexLoginState {
        CodexLoginState(
            status: "pending", loginId: "fixture", verificationUrl: url, userCode: "CODE",
            error: nil)
    }
}
