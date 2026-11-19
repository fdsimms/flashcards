import ActivityKit
import Foundation

// The payload of the listening Live Activity (an audio lesson or a Read & Listen text playing).
// This exact file is compiled into the app (through ListeningActivity.podspec's glob) and copied
// into the widget extension by plugins/withListeningActivity.js. ActivityKit pairs the activity the
// app starts with the extension's ActivityConfiguration by this type's name and a Codable round trip
// of its properties, so the two copies must stay identical, and a mismatch shows only as an activity
// that starts and never appears. Never edit the copy under ios/FrankiListening/: prebuild overwrites it.
@available(iOS 16.2, *)
struct ListeningActivityAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        var playing: Bool
        /// "Line 4 of 12", or "" for a lesson.
        var detail: String
        /// Loop is on: the whole text or lesson starts again when it ends. Its button is drawn filled.
        var looping: Bool
        /// Seconds into the track as of `updatedAt`.
        var position: Double
        /// Seconds; 0 when it isn't known, which draws no progress bar.
        var duration: Double
        var updatedAt: Date
    }

    let title: String
    /// "Audio lesson" or "Read & Listen".
    let kind: String
    /// A lesson skips back and forward 15 seconds; a text goes to the previous and next line.
    let skipsBySeconds: Bool
}
