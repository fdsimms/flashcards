import ActivityKit
import ExpoModulesCore

// Starts, updates and ends the listening Live Activity, and passes its buttons' taps to JS
// (src/ui/listeningActivity.ts). Every call into ActivityKit is guarded by #available(iOS 17.0, *),
// the version LiveActivityIntent needs, so on an older iPhone `isAvailable` is false and nothing starts.
public class ListeningActivityModule: Module {
  private var observer: NSObjectProtocol?
  private var current: Any?

  public func definition() -> ModuleDefinition {
    Name("ListeningActivity")

    Events("onAction")

    OnStartObserving {
      self.observer = NotificationCenter.default.addObserver(forName: .frankiListeningAction, object: nil, queue: .main) { [weak self] note in
        self?.sendEvent("onAction", ["action": note.userInfo?["action"] as? String ?? ""])
      }
    }

    OnStopObserving {
      if let observer = self.observer { NotificationCenter.default.removeObserver(observer) }
      self.observer = nil
    }

    // Whether Live Activities can be shown: the iPhone is new enough and the person hasn't turned them off for Franki.
    Function("isAvailable") { () -> Bool in
      if #available(iOS 17.0, *) { return ActivityAuthorizationInfo().areActivitiesEnabled }
      return false
    }

    Function("start") { (title: String, kind: String, skipsBySeconds: Bool, playing: Bool, detail: String, position: Double, duration: Double) -> Bool in
      guard #available(iOS 17.0, *), ActivityAuthorizationInfo().areActivitiesEnabled else { return false }
      self.endAll()
      let attributes = ListeningActivityAttributes(title: title, kind: kind, skipsBySeconds: skipsBySeconds)
      let state = ListeningActivityAttributes.ContentState(playing: playing, detail: detail, position: position, duration: duration, updatedAt: Date())
      do {
        self.current = try Activity.request(attributes: attributes, content: ActivityContent(state: state, staleDate: nil), pushType: nil)
        return true
      } catch {
        return false
      }
    }

    Function("update") { (playing: Bool, detail: String, position: Double, duration: Double) in
      guard #available(iOS 17.0, *), let activity = self.current as? Activity<ListeningActivityAttributes> else { return }
      let state = ListeningActivityAttributes.ContentState(playing: playing, detail: detail, position: position, duration: duration, updatedAt: Date())
      Task { await activity.update(ActivityContent(state: state, staleDate: nil)) }
    }

    Function("end") {
      self.endAll()
    }
  }

  // Ends this launch's activity and any left by an earlier one (a crash, a force quit).
  private func endAll() {
    guard #available(iOS 17.0, *) else { return }
    current = nil
    for activity in Activity<ListeningActivityAttributes>.activities {
      Task { await activity.end(nil, dismissalPolicy: .immediate) }
    }
  }
}
