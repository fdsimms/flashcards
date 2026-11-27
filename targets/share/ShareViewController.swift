import UIKit

// "Franki" in another app's share sheet. Text selected anywhere, or a Safari page's article
// (GetPageText.js), is shown on a small card with its choices: read it in Read & Listen (Your own
// text), add it as words (Quick add), or for a few words, look them up (Look up). The choice and the text go to the App Group
// (SharedInbox.swift), and the app picks them up when it's next opened (src/ui/useShareInbox.ts):
// a share extension can't open its app, so the card says to open Franki.
//
// Nothing else happens here: no fetching, no Claude, no deck. The collection, the note queue and
// Read & Listen's passphrase all live in the app, and a share extension is memory-capped hard.
class ShareViewController: UIViewController {
  /// What was shared, as the card shows it.
  private struct Shared {
    let text: String
    let title: String?
    let url: String?
  }

  // How long the saved card stays before the sheet closes itself.
  private static let dismissDelay: TimeInterval = 1.2
  // A share this short is offered as words first; anything longer is offered to read first.
  private static let wordsMaxCharacters = 40
  private static let wordsMaxCount = 3

  private static let propertyListType = "com.apple.property-list"
  private static let textType = "public.plain-text"
  private static let urlType = "public.url"

  // Franki's accent (src/ui/theme.ts, `accent`), light and dark.
  private static let accent = UIColor { traits in
    traits.userInterfaceStyle == .dark
      ? UIColor(red: 0xD4 / 255, green: 0xB4 / 255, blue: 0x6A / 255, alpha: 1)
      : UIColor(red: 0x87 / 255, green: 0x6A / 255, blue: 0x1E / 255, alpha: 1)
  }
  private static let onAccent = UIColor { traits in
    traits.userInterfaceStyle == .dark
      ? UIColor(red: 0x1B / 255, green: 0x14 / 255, blue: 0x07 / 255, alpha: 1)
      : UIColor.white
  }

  private let card = UIView()
  private let stack = UIStackView()

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = UIColor.black.withAlphaComponent(0.4)
    setUpCard()
    readShare { [weak self] shared in
      guard let self else { return }
      if let shared, !shared.text.isEmpty {
        self.showChoices(shared)
      } else if shared?.url != nil {
        self.showMessage(
          title: "Select the text first",
          detail: "Franki can't read a page from its link. Select the text you want, then share it to Franki again.",
          button: "Close"
        )
      } else {
        self.showMessage(title: "There's no text to add", detail: "Select some text, then share it to Franki.", button: "Close")
      }
    }
  }

  // MARK: - Reading the share

  /// The share's text, title and address, from the first attachment that has some. `completion` is
  /// called once, on the main queue.
  private func readShare(completion: @escaping (Shared?) -> Void) {
    let providers = (extensionContext?.inputItems as? [NSExtensionItem] ?? []).flatMap { $0.attachments ?? [] }
    var linkOnly: Shared?

    func finish(_ shared: Shared?) {
      DispatchQueue.main.async { completion(shared) }
    }

    func next(_ index: Int) {
      guard index < providers.count else { return finish(linkOnly) }
      let provider = providers[index]
      if provider.hasItemConformingToTypeIdentifier(Self.propertyListType) {
        // A Safari page: GetPageText.js's result. The selection wins over the whole article.
        provider.loadItem(forTypeIdentifier: Self.propertyListType, options: nil) { item, _ in
          let results = (item as? NSDictionary)?[NSExtensionJavaScriptPreprocessingResultsKey] as? [String: Any]
          let selection = Self.trimmed(results?["selection"] as? String)
          let article = Self.trimmed(results?["text"] as? String)
          let text = selection.isEmpty ? article : selection
          let title = Self.trimmed(results?["title"] as? String)
          let url = results?["url"] as? String
          if !text.isEmpty {
            finish(Shared(text: text, title: title.isEmpty ? nil : title, url: url))
          } else {
            linkOnly = Shared(text: "", title: nil, url: url)
            next(index + 1)
          }
        }
        return
      }
      if provider.hasItemConformingToTypeIdentifier(Self.textType) {
        provider.loadItem(forTypeIdentifier: Self.textType, options: nil) { item, _ in
          let text = Self.trimmed(item as? String)
          // A link shared as text is a link, not something to read.
          if !text.isEmpty, URL(string: text)?.scheme?.hasPrefix("http") != true {
            finish(Shared(text: text, title: nil, url: nil))
          } else {
            if !text.isEmpty { linkOnly = Shared(text: "", title: nil, url: text) }
            next(index + 1)
          }
        }
        return
      }
      if provider.hasItemConformingToTypeIdentifier(Self.urlType) {
        provider.loadItem(forTypeIdentifier: Self.urlType, options: nil) { item, _ in
          if let url = item as? URL { linkOnly = Shared(text: "", title: nil, url: url.absoluteString) }
          next(index + 1)
        }
        return
      }
      next(index + 1)
    }

    next(0)
  }

  private static func trimmed(_ text: String?) -> String {
    (text ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
  }

  /// A few words rather than something to read: short, and at most a few words where words are
  /// spaced (Thai and Japanese aren't, so there only the length counts).
  private static func looksLikeWords(_ text: String) -> Bool {
    let words = text.split(whereSeparator: { $0.isWhitespace || $0 == "," || $0 == ";" })
    return text.count <= wordsMaxCharacters && words.count <= wordsMaxCount
  }

  // MARK: - The card

  private func setUpCard() {
    card.translatesAutoresizingMaskIntoConstraints = false
    card.backgroundColor = .systemBackground
    card.layer.cornerRadius = 18
    card.layer.cornerCurve = .continuous
    stack.axis = .vertical
    stack.spacing = 12
    stack.translatesAutoresizingMaskIntoConstraints = false
    card.addSubview(stack)
    view.addSubview(card)
    NSLayoutConstraint.activate([
      card.leadingAnchor.constraint(equalTo: view.layoutMarginsGuide.leadingAnchor),
      card.trailingAnchor.constraint(equalTo: view.layoutMarginsGuide.trailingAnchor),
      card.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -16),
      card.widthAnchor.constraint(lessThanOrEqualToConstant: 560),
      stack.topAnchor.constraint(equalTo: card.topAnchor, constant: 18),
      stack.bottomAnchor.constraint(equalTo: card.bottomAnchor, constant: -18),
      stack.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 18),
      stack.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -18),
    ])
  }

  private func clearCard() {
    for view in stack.arrangedSubviews {
      stack.removeArrangedSubview(view)
      view.removeFromSuperview()
    }
  }

  private func label(_ text: String, font: UIFont, color: UIColor = .label, lines: Int = 0, center: Bool = false) -> UILabel {
    let label = UILabel()
    label.text = text
    label.font = font
    label.adjustsFontForContentSizeCategory = true
    label.textColor = color
    label.numberOfLines = lines
    label.textAlignment = center ? .center : .natural
    return label
  }

  private func button(_ title: String, primary: Bool, action: @escaping () -> Void) -> UIButton {
    var config = primary ? UIButton.Configuration.filled() : UIButton.Configuration.gray()
    config.title = title
    config.cornerStyle = .large
    config.baseBackgroundColor = primary ? Self.accent : nil
    config.baseForegroundColor = primary ? Self.onAccent : .label
    config.contentInsets = NSDirectionalEdgeInsets(top: 13, leading: 12, bottom: 13, trailing: 12)
    let button = UIButton(configuration: config, primaryAction: UIAction { _ in action() })
    button.titleLabel?.font = .preferredFont(forTextStyle: .headline)
    return button
  }

  private func header() -> UIView {
    let cancel = UIButton(type: .system, primaryAction: UIAction(title: "Cancel") { [weak self] _ in self?.cancel() })
    cancel.tintColor = Self.accent
    let title = label("Franki", font: .preferredFont(forTextStyle: .headline), center: true)
    let spacer = UIView()
    let row = UIStackView(arrangedSubviews: [cancel, title, spacer])
    row.distribution = .fillEqually
    row.alignment = .center
    return row
  }

  private func showChoices(_ shared: Shared) {
    clearCard()
    stack.addArrangedSubview(header())

    let preview = label(shared.text, font: .preferredFont(forTextStyle: .body), lines: 5)
    let box = UIView()
    box.backgroundColor = .secondarySystemBackground
    box.layer.cornerRadius = 12
    box.layer.cornerCurve = .continuous
    preview.translatesAutoresizingMaskIntoConstraints = false
    box.addSubview(preview)
    NSLayoutConstraint.activate([
      preview.topAnchor.constraint(equalTo: box.topAnchor, constant: 10),
      preview.bottomAnchor.constraint(equalTo: box.bottomAnchor, constant: -10),
      preview.leadingAnchor.constraint(equalTo: box.leadingAnchor, constant: 12),
      preview.trailingAnchor.constraint(equalTo: box.trailingAnchor, constant: -12),
    ])
    stack.addArrangedSubview(box)

    let count = shared.text.count
    var about = "\(count.formatted()) \(count == 1 ? "character" : "characters")"
    if let url = shared.url, let host = URL(string: url)?.host { about += " from \(host)" }
    stack.addArrangedSubview(label(about, font: .preferredFont(forTextStyle: .footnote), color: .secondaryLabel))

    // A few words are offered to look up first (Look up in the app), then to add, then to read; a
    // passage to read first, then as words. Looking up every word of a passage isn't what Look up is for.
    let words = Self.looksLikeWords(shared.text)
    let read = button("Read it in Read & Listen", primary: !words) { [weak self] in self?.save(shared, kind: "read") }
    let add = button("Add as words", primary: false) { [weak self] in self?.save(shared, kind: "words") }
    if words {
      let look = button("Look it up", primary: true) { [weak self] in self?.save(shared, kind: "lookup") }
      for b in [look, add, read] { stack.addArrangedSubview(b) }
    } else {
      for b in [read, add] { stack.addArrangedSubview(b) }
    }
  }

  private func save(_ shared: Shared, kind: String) {
    let saved = SharedInbox.append(kind: kind, text: shared.text, title: shared.title, url: shared.url)
    clearCard()
    let mark = UIImageView(image: UIImage(systemName: saved ? "checkmark.circle.fill" : "xmark.circle.fill"))
    mark.tintColor = saved ? .systemGreen : .systemRed
    mark.contentMode = .scaleAspectFit
    mark.preferredSymbolConfiguration = UIImage.SymbolConfiguration(pointSize: 40)
    stack.addArrangedSubview(mark)
    stack.addArrangedSubview(label(saved ? "Saved to Franki" : "Couldn't save that", font: .preferredFont(forTextStyle: .headline), center: true))
    let detail = !saved
      ? "Franki couldn't keep the text. Try sharing it again."
      : kind == "read" ? "Open Franki to read it." : kind == "lookup" ? "Open Franki to look it up." : "Open Franki to add them."
    stack.addArrangedSubview(label(detail, font: .preferredFont(forTextStyle: .subheadline), color: .secondaryLabel, center: true))
    DispatchQueue.main.asyncAfter(deadline: .now() + Self.dismissDelay) { [weak self] in
      self?.extensionContext?.completeRequest(returningItems: nil)
    }
  }

  private func showMessage(title: String, detail: String, button text: String) {
    clearCard()
    stack.addArrangedSubview(label(title, font: .preferredFont(forTextStyle: .headline), center: true))
    stack.addArrangedSubview(label(detail, font: .preferredFont(forTextStyle: .subheadline), color: .secondaryLabel, center: true))
    stack.addArrangedSubview(button(text, primary: false) { [weak self] in self?.cancel() })
  }

  private func cancel() {
    extensionContext?.cancelRequest(withError: NSError(domain: NSCocoaErrorDomain, code: NSUserCancelledError))
  }
}
