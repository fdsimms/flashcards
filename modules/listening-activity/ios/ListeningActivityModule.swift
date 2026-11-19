import ActivityKit
import ExpoModulesCore
import MediaPlayer

// Starts, updates and ends the listening Live Activity, and passes its buttons' taps to JS
// (src/ui/listeningActivity.ts). It also owns the lock screen's next and previous track buttons
// while Up Next plays (`setTrackCommands`, src/ui/trackCommands.ts). Every call into ActivityKit is guarded by #available(iOS 17.0, *),
// the version LiveActivityIntent needs, so on an older iPhone `isAvailable` is false and nothing starts.
public class ListeningActivityModule: Module {
  private var observer: NSObjectProtocol?
  private var current: Any?
  private var trackTargets: [(MPRemoteCommand, Any)] = []

  public func definition() -> ModuleDefinition {
    Name("ListeningActivity")

    Events("onAction", "onTrack")

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

    Function("start") { (title: String, kind: String, skipsBySeconds: Bool, playing: Bool, detail: String, looping: Bool, position: Double, duration: Double) -> Bool in
      guard #available(iOS 17.0, *), ActivityAuthorizationInfo().areActivitiesEnabled else { return false }
      self.endAll()
      let attributes = ListeningActivityAttributes(title: title, kind: kind, skipsBySeconds: skipsBySeconds)
      let state = ListeningActivityAttributes.ContentState(playing: playing, detail: detail, looping: looping, position: position, duration: duration, updatedAt: Date())
      do {
        self.current = try Activity.request(attributes: attributes, content: ActivityContent(state: state, staleDate: nil), pushType: nil)
        return true
      } catch {
        return false
      }
    }

    Function("update") { (playing: Bool, detail: String, looping: Bool, position: Double, duration: Double) in
      guard #available(iOS 17.0, *), let activity = self.current as? Activity<ListeningActivityAttributes> else { return }
      let state = ListeningActivityAttributes.ContentState(playing: playing, detail: detail, looping: looping, position: position, duration: duration, updatedAt: Date())
      Task { await activity.update(ActivityContent(state: state, staleDate: nil)) }
    }

    Function("end") {
      self.endAll()
    }

    // Up Next's next and previous item on the lock screen, Control Center and headphones. expo-audio
    // registers these commands only for its playlist player and turns them off (with a target that
    // fails) every time a player is set active for the lock screen, so JS calls this after each of
    // those: the targets on both commands are replaced with ones that send onTrack, and enabled.
    // Queued on the main queue, as expo-audio queues its own changes, so this one lands after them.
    Function("setTrackCommands") { (enabled: Bool) in
      DispatchQueue.main.async {
        let center = MPRemoteCommandCenter.shared()
        for (command, target) in self.trackTargets { command.removeTarget(target) }
        self.trackTargets = []
        guard enabled else {
          center.nextTrackCommand.isEnabled = false
          center.previousTrackCommand.isEnabled = false
          return
        }
        let pairs: [(MPRemoteCommand, String)] = [(center.nextTrackCommand, "next"), (center.previousTrackCommand, "previous")]
        for (command, action) in pairs {
          // nil removes every target, expo-audio's failing one included.
          command.removeTarget(nil)
          let target = command.addTarget { [weak self] _ in
            self?.sendEvent("onTrack", ["action": action])
            return .success
          }
          self.trackTargets.append((command, target))
          command.isEnabled = true
        }
      }
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
