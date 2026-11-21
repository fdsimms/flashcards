import ExpoModulesCore
import UIKit

// The Home Screen quick actions: JS sets the items (src/ui/useHomeShortcuts.ts), and a tapped one
// is kept here until JS takes it with `takePending`. It's kept, not only sent as an event, because
// a tap that launches the app reaches the app delegate (forwarded by ExpoAppSceneDelegate from the
// scene's connection options) before JS is running to hear an event. expo-quick-actions was tried
// first and loses exactly that tap: it reads the launch options, which a scene-based app doesn't get.
enum HomeShortcuts {
  /// The tapped item's type and userInfo, until JS takes it. Read and written on the main thread.
  static var pending: [String: Any]?
}

extension Notification.Name {
  static let frankiHomeShortcut = Notification.Name("frankiHomeShortcut")
}

public class HomeShortcutsAppDelegate: ExpoAppDelegateSubscriber {
  public func application(_ application: UIApplication, performActionFor shortcutItem: UIApplicationShortcutItem, completionHandler: @escaping (Bool) -> Void) {
    var shortcut: [String: Any] = [:]
    for (key, value) in shortcutItem.userInfo ?? [:] { shortcut[key] = value }
    shortcut["type"] = shortcutItem.type
    DispatchQueue.main.async {
      HomeShortcuts.pending = shortcut
      NotificationCenter.default.post(name: .frankiHomeShortcut, object: nil)
    }
    completionHandler(true)
  }
}

public class HomeShortcutsModule: Module {
  private var observer: NSObjectProtocol?

  public func definition() -> ModuleDefinition {
    Name("HomeShortcuts")

    /// Sent when an item is tapped while JS is running; JS then calls `takePending`.
    Events("onShortcut")

    OnStartObserving {
      self.observer = NotificationCenter.default.addObserver(forName: .frankiHomeShortcut, object: nil, queue: .main) { [weak self] _ in
        self?.sendEvent("onShortcut", [:])
      }
    }

    OnStopObserving {
      if let observer = self.observer { NotificationCenter.default.removeObserver(observer) }
      self.observer = nil
    }

    /// The tapped item ({ type, ...userInfo }), once: a second call returns nil until the next tap.
    AsyncFunction("takePending") { () -> [String: Any]? in
      let shortcut = HomeShortcuts.pending
      HomeShortcuts.pending = nil
      return shortcut
    }.runOnQueue(.main)

    /// Replaces the items: each { type, title, subtitle?, symbol?, deck? }, at most four shown.
    AsyncFunction("setItems") { (items: [[String: String]]) in
      UIApplication.shared.shortcutItems = items.map { item in
        var info: [String: NSSecureCoding] = [:]
        if let deck = item["deck"] { info["deck"] = deck as NSString }
        return UIApplicationShortcutItem(
          type: item["type"] ?? "quick-add",
          localizedTitle: item["title"] ?? "",
          localizedSubtitle: item["subtitle"],
          icon: item["symbol"].map { UIApplicationShortcutIcon(systemImageName: $0) },
          userInfo: info
        )
      }
    }.runOnQueue(.main)
  }
}
