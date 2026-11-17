import ExpoModulesCore
import Speech

/// expo-speech-recognition's own `supportsOnDeviceRecognition` asks about the phone's default
/// language only. Answer by speaking needs it per language: one recognized only by Apple's servers
/// can't be heard offline, so its microphone is hidden then rather than failing after a tap.
/// Making a recognizer asks for no permission.
public class SpeechOnDeviceModule: Module {
  public func definition() -> ModuleDefinition {
    Name("SpeechOnDevice")

    /// `locale` is a recognizer locale as getSupportedLocales gives it ("th-TH").
    Function("supportsOnDevice") { (locale: String) -> Bool in
      return SFSpeechRecognizer(locale: Locale(identifier: locale))?.supportsOnDeviceRecognition ?? false
    }
  }
}
