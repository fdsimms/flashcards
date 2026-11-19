import AppIntents
import Foundation

extension Notification.Name {
    /// Posted in the app's process when a button on the Live Activity is tapped; ListeningActivityModule hands it to JS.
    static let frankiListeningAction = Notification.Name("FrankiListeningAction")
}

// The buttons on the listening Live Activity. A LiveActivityIntent runs in the app's process, in the
// background and without opening it, even when the button is drawn by the widget extension; that is why
// this file is compiled into the app as well as copied into the extension (the extension's copy only
// names the type for Button(intent:)). The app is kept running by its background audio, so the
// notification reaches the JS that owns the player. `action` is "previous", "toggle" or "next".
@available(iOS 17.0, *)
struct ListeningControlIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "Control listening"
    static var isDiscoverable: Bool = false

    @Parameter(title: "Action")
    var action: String

    init() {}

    init(action: String) {
        self.action = action
    }

    func perform() async throws -> some IntentResult {
        NotificationCenter.default.post(name: .frankiListeningAction, object: nil, userInfo: ["action": action])
        return .result()
    }
}
