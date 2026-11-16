import ExpoModulesCore
import UIKit

/// iOS has no call that says "show the Russian keyboard", but a text field is asked for its
/// `textInputMode` when it takes focus, and answering with one of the keyboards the person has
/// enabled opens that one. React Native's fields are UITextField and UITextView, so this answers
/// that question for them (and only them) while a language is set: `set` before the field takes
/// focus, or while it has it, which reloads the keyboard. A language the person hasn't enabled a
/// keyboard for changes nothing. `set(nil)` hands the choice back to iOS.
enum KeyboardLanguage {
  /// The language's primary subtag ("ru"), or nil for no preference.
  static var wanted: String?

  /// The enabled keyboard for `wanted`: the person's current one when it already is, else the first.
  static func mode(for responder: UIResponder, original: UITextInputMode?) -> UITextInputMode? {
    guard let wanted else { return original }
    func matches(_ mode: UITextInputMode) -> Bool {
      guard let tag = mode.primaryLanguage else { return false }
      return tag.split(separator: "-").first.map(String.init)?.lowercased() == wanted
    }
    if let original, matches(original) { return original }
    return UITextInputMode.activeInputModes.first(where: matches) ?? original
  }

  static var installed = false

  static func install() {
    guard !installed else { return }
    installed = true
    let original = #selector(getter: UIResponder.textInputMode)
    let replacement = #selector(UIResponder.franki_textInputMode)
    guard let a = class_getInstanceMethod(UIResponder.self, original),
          let b = class_getInstanceMethod(UIResponder.self, replacement) else { return }
    method_exchangeImplementations(a, b)
  }

  static func firstResponder(in view: UIView) -> UIResponder? {
    if view.isFirstResponder { return view }
    for sub in view.subviews { if let found = firstResponder(in: sub) { return found } }
    return nil
  }
}

extension UIResponder {
  /// After the exchange this is UIKit's own getter, and `textInputMode` is this.
  @objc func franki_textInputMode() -> UITextInputMode? {
    let original = self.franki_textInputMode()
    guard self is UITextField || self is UITextView else { return original }
    return KeyboardLanguage.mode(for: self, original: original)
  }
}

public class KeyboardLanguageModule: Module {
  public func definition() -> ModuleDefinition {
    Name("KeyboardLanguage")

    /// `language` is a primary subtag ("ru", "th"), or nil to stop asking for one.
    Function("set") { (language: String?) in
      KeyboardLanguage.install()
      KeyboardLanguage.wanted = language?.lowercased()
      // A field that already has focus asks again only when its keyboard is reloaded.
      guard language != nil else { return }
      for scene in UIApplication.shared.connectedScenes {
        guard let windowScene = scene as? UIWindowScene else { continue }
        for window in windowScene.windows {
          if let responder = KeyboardLanguage.firstResponder(in: window) as? UIView, responder is UITextField || responder is UITextView {
            responder.reloadInputViews()
            return
          }
        }
      }
    }.runOnQueue(.main)
  }
}
