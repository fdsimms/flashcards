import AVFoundation
import ExpoModulesCore

/// The pitch line in Record yourself (src/core/pitch.ts) measures pitch in TypeScript from plain
/// samples, and nothing in JavaScript can decode the take (AAC in .m4a) or a card's recording (MP3).
/// This decodes one file on the phone to mono Float32 at the rate asked for, at most `maxSeconds` of
/// it. It reads only the file it's given and sends nothing anywhere: a take never leaves the phone.
public class AudioSamplesModule: Module {
  public func definition() -> ModuleDefinition {
    Name("AudioSamples")

    AsyncFunction("decode") { (uri: String, sampleRate: Double, maxSeconds: Double) throws -> [Float] in
      guard let url = URL(string: uri), url.isFileURL else { throw NotAFileException(uri) }
      let file = try AVAudioFile(forReading: url)
      let source = file.processingFormat
      let wanted = min(Double(file.length), maxSeconds * source.sampleRate)
      guard wanted >= 1 else { return [] }
      let frames = AVAudioFrameCount(wanted)
      guard
        let target = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: sampleRate, channels: 1, interleaved: false),
        let converter = AVAudioConverter(from: source, to: target),
        let input = AVAudioPCMBuffer(pcmFormat: source, frameCapacity: frames),
        let output = AVAudioPCMBuffer(
          pcmFormat: target,
          frameCapacity: AVAudioFrameCount(Double(frames) * sampleRate / source.sampleRate) + 1024
        )
      else { throw CannotDecodeException(uri) }
      // A stereo file is folded to one channel rather than its first taken.
      converter.downmix = true
      try file.read(into: input, frameCount: frames)

      var given = false
      var failure: NSError?
      let status = converter.convert(to: output, error: &failure) { _, inputStatus in
        if given {
          inputStatus.pointee = .endOfStream
          return nil
        }
        given = true
        inputStatus.pointee = .haveData
        return input
      }
      if status == .error { throw CannotDecodeException(failure?.localizedDescription ?? uri) }
      guard let channel = output.floatChannelData?[0] else { return [] }
      return Array(UnsafeBufferPointer(start: channel, count: Int(output.frameLength)))
    }
  }
}

internal final class NotAFileException: GenericException<String> {
  override var reason: String { "Not a file on the phone: \(param)" }
}

internal final class CannotDecodeException: GenericException<String> {
  override var reason: String { "Couldn't read the audio: \(param)" }
}
