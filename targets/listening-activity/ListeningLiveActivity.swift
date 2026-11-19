import ActivityKit
import AppIntents
import SwiftUI
import WidgetKit

// The lock screen banner and Dynamic Island for an audio lesson or a Read & Listen text that is playing.
// Its buttons are ListeningControlIntent, which runs in the app without opening it. The progress bar
// runs on its own clock while playing (ProgressView(timerInterval:)), so the app only sends an update
// when playing starts or stops, a line changes, or the position jumps.

// The gold of the app's dark theme (accentInk in src/ui/theme.ts), which this extension can't import.
private let gold = Color(red: 212 / 255, green: 180 / 255, blue: 106 / 255)

@available(iOS 17.0, *)
private struct Artwork: View {
    var body: some View {
        RoundedRectangle(cornerRadius: 10, style: .continuous)
            .fill(gold.opacity(0.18))
            .frame(width: 44, height: 44)
            .overlay(Image(systemName: "headphones").font(.title3).foregroundStyle(gold))
    }
}

@available(iOS 17.0, *)
private struct Titles: View {
    let context: ActivityViewContext<ListeningActivityAttributes>
    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(context.attributes.title).font(.subheadline.weight(.semibold)).lineLimit(1)
            Text(subtitle).font(.footnote).foregroundStyle(.secondary).lineLimit(1)
        }
    }
    private var subtitle: String {
        let detail = context.state.detail
        return detail.isEmpty ? context.attributes.kind : "\(context.attributes.kind) · \(detail)"
    }
}

@available(iOS 17.0, *)
private struct Progress: View {
    let state: ListeningActivityAttributes.ContentState
    var body: some View {
        if state.duration > 0 {
            let position = min(max(state.position, 0), state.duration)
            if state.playing {
                let start = state.updatedAt.addingTimeInterval(-position)
                ProgressView(timerInterval: start...start.addingTimeInterval(state.duration), countsDown: false) {
                    EmptyView()
                } currentValueLabel: {
                    EmptyView()
                }
                .tint(gold)
            } else {
                ProgressView(value: position, total: state.duration).tint(gold)
            }
        }
    }
}

@available(iOS 17.0, *)
private struct Controls: View {
    let context: ActivityViewContext<ListeningActivityAttributes>
    var body: some View {
        HStack(spacing: 34) {
            Button(intent: ListeningControlIntent(action: "previous")) {
                Image(systemName: context.attributes.skipsBySeconds ? "gobackward.15" : "backward.fill").font(.title2)
            }
            Button(intent: ListeningControlIntent(action: "toggle")) {
                Image(systemName: context.state.playing ? "pause.fill" : "play.fill")
                    .font(.title3)
                    .foregroundStyle(.black)
                    .frame(width: 44, height: 44)
                    .background(gold, in: Circle())
            }
            Button(intent: ListeningControlIntent(action: "next")) {
                Image(systemName: context.attributes.skipsBySeconds ? "goforward.15" : "forward.fill").font(.title2)
            }
        }
        .buttonStyle(.plain)
    }
}

@available(iOS 17.0, *)
struct ListeningLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: ListeningActivityAttributes.self) { context in
            VStack(spacing: 12) {
                HStack(spacing: 12) {
                    Artwork()
                    Titles(context: context)
                    Spacer(minLength: 0)
                }
                Progress(state: context.state)
                Controls(context: context)
            }
            .padding(16)
            .activityBackgroundTint(Color(red: 0.11, green: 0.11, blue: 0.13))
            .activitySystemActionForegroundColor(.white)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) { Artwork() }
                DynamicIslandExpandedRegion(.center) { Titles(context: context) }
                DynamicIslandExpandedRegion(.bottom) {
                    VStack(spacing: 10) {
                        Progress(state: context.state)
                        Controls(context: context)
                    }
                }
            } compactLeading: {
                Image(systemName: "headphones").foregroundStyle(gold)
            } compactTrailing: {
                Image(systemName: context.state.playing ? "waveform" : "pause.fill").foregroundStyle(gold)
            } minimal: {
                Image(systemName: "headphones").foregroundStyle(gold)
            }
        }
    }
}
