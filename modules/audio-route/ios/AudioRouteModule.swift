import AVFoundation
import ExpoModulesCore

/// expo-audio doesn't say where sound is going. Bluetooth headphones let their link sleep after a few
/// seconds of quiet and lose the first half second or so of the next sound while it wakes, which is
/// all of a one-word recording, so the app wakes the link first when this says the route is Bluetooth
/// (src/ui/useOutputWake.ts). Reading the route asks for no permission.
public class AudioRouteModule: Module {
  public func definition() -> ModuleDefinition {
    Name("AudioRoute")

    Function("isBluetoothOutput") { () -> Bool in
      let bluetooth: [AVAudioSession.Port] = [.bluetoothA2DP, .bluetoothLE, .bluetoothHFP]
      return AVAudioSession.sharedInstance().currentRoute.outputs.contains { bluetooth.contains($0.portType) }
    }
  }
}
