import AppIntents
import SwiftUI
import WidgetKit
import Foundation

struct SetRouting: AppIntent {
    static let title: LocalizedStringResource = "widget.update"
    static let openAppWhenRun = false
    @Parameter(title: "widget.setting") var action: String
    @Parameter(title: "widget.value") var value: String
    init() {}
    init(_ action: String, _ value: String) { self.action = action; self.value = value }
    func perform() async throws -> some IntentResult {
        let status = await Task.detached { exchange(action: action, value: value.isEmpty ? nil : value) }.value
        if let error = status.error {
            WidgetCenter.shared.reloadTimelines(ofKind: widgetKind)
            throw WidgetFailure(message: localized(error, language: status.language))
        }
        return .result()
    }
}

struct WidgetFailure: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

struct Entry: TimelineEntry {
    var date: Date
    var status: Status
}

struct Provider: TimelineProvider {
    func placeholder(in context: Context) -> Entry {
        Entry(date: .now, status: Status(error: "widget.unavailable"))
    }
    func getSnapshot(in context: Context, completion: @escaping (Entry) -> Void) {
        if context.isPreview {
            completion(Entry(date: .now, status: Status(mode: "rule", tun: true, proxy: false)))
        } else {
            getTimeline(in: context) { completion($0.entries[0]) }
        }
    }
    func getTimeline(in context: Context, completion: @escaping (Timeline<Entry>) -> Void) {
        DispatchQueue.global().async {
            let status = exchange()
            let now = Date()
            let unavailable = status.mode == nil || status.tun == nil || status.proxy == nil
            let refresh = now.addingTimeInterval(unavailable ? 60 : 900)
            completion(Timeline(entries: [Entry(date: now, status: status)], policy: .after(refresh)))
        }
    }
}

#if !PREVIEW_HOST
@main
#endif
struct RoutingWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: widgetKind, provider: Provider()) { RoutingView(entry: $0) }
            .configurationDisplayName("widget.name")
            .description("widget.description")
            .supportedFamilies([.systemSmall, .systemMedium])
    }
}
