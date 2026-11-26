import Foundation

// The extension's half of the hand-off: what was shared is appended to a JSON list in the App Group
// container, and the app takes it on its next launch or return to the foreground
// (src/ui/useShareInbox.ts, src/core/shareInbox.ts, which reads the same shape). A share extension
// can't open its app, so this file is the whole hand-off.
//
// As in dundundun's SharedRecipeQueue: written atomically, no file coordination with the app, which
// copies the list to its own documents and deletes this file. The window for a lost write is a
// process killed between this read and write, on a file touched only when a person taps a button.
enum SharedInbox {
  // Must match APP_GROUP_ID in plugins/withAppGroup.js and the file name in src/core/shareInbox.ts.
  static let appGroupID = "group.com.fdsimms.franki"
  private static let fileName = "share_inbox.json"
  // Shares nobody has opened the app for: the oldest fall off, so the one just made always stays.
  private static let maxQueued = 20
  // The most of a text that's kept. The app refuses more than 30,000 characters to read, saying how
  // much there is, so this only stops a huge page from being held in this memory-capped process.
  static let maxText = 100_000

  struct Item: Codable {
    let id: String
    /// "read": to Read & Listen as your own text; "words": to Quick add.
    let kind: String
    let text: String
    let title: String?
    let url: String?
    /// Epoch milliseconds, as JavaScript counts them.
    let sharedAt: Double
  }

  private static var fileURL: URL? {
    FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroupID)?
      .appendingPathComponent(fileName)
  }

  /// Appends a share. Returns whether it's saved.
  static func append(kind: String, text: String, title: String?, url: String?) -> Bool {
    guard let fileURL else { return false }
    var items = existing(at: fileURL)
    items.append(Item(
      id: UUID().uuidString,
      kind: kind,
      text: String(text.prefix(maxText)),
      title: title,
      url: url,
      sharedAt: Date().timeIntervalSince1970 * 1000
    ))
    if items.count > maxQueued { items.removeFirst(items.count - maxQueued) }
    guard let data = try? JSONEncoder().encode(items) else { return false }
    do {
      try data.write(to: fileURL, options: .atomic)
      return true
    } catch {
      return false
    }
  }

  /// What's there already; a missing or unreadable file is an empty list, rather than refusing the
  /// share over a file this write replaces.
  private static func existing(at fileURL: URL) -> [Item] {
    guard let data = try? Data(contentsOf: fileURL) else { return [] }
    return (try? JSONDecoder().decode([Item].self, from: data)) ?? []
  }
}
