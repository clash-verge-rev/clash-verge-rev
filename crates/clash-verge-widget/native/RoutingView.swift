import SwiftUI
import WidgetKit
import Foundation

struct RoutingView: View {
    let entry: Entry
    @Environment(\.widgetFamily) private var widgetFamily
    #if DEBUG
    var previewFamily: WidgetFamily? = nil
    private var family: WidgetFamily { previewFamily ?? widgetFamily }
    #else
    private var family: WidgetFamily { widgetFamily }
    #endif
    @Environment(\.widgetRenderingMode) private var systemRenderingMode
    #if DEBUG
    var previewRenderingMode: WidgetRenderingMode? = nil
    var previewMaterial = "automatic"
    var previewIncreaseContrast = false
    private var renderingMode: WidgetRenderingMode { previewRenderingMode ?? systemRenderingMode }
    #else
    private var renderingMode: WidgetRenderingMode { systemRenderingMode }
    #endif
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.accessibilityReduceMotion) private var systemReduceMotion
    @Environment(\.accessibilityReduceTransparency) private var systemReduceTransparency
    #if DEBUG
    var previewReduceMotion: Bool? = nil
    var previewReduceTransparency: Bool? = nil
    private var reduceMotion: Bool { previewReduceMotion ?? systemReduceMotion }
    private var reduceTransparency: Bool { previewReduceTransparency ?? systemReduceTransparency }
    #else
    private var reduceMotion: Bool { systemReduceMotion }
    private var reduceTransparency: Bool { systemReduceTransparency }
    #endif
    private func text(_ key: String) -> String { localized(key, language: entry.status.language) }
    private let modes = ["rule", "global", "direct"]
    private var ink: Color { renderingMode == .fullColor ? (colorScheme == .dark ? .white : .black) : .primary }
    @ViewBuilder private var selectionBackground: some View {
        #if DEBUG
        if previewMaterial == "thin" && renderingMode == .fullColor && !reduceTransparency {
            Capsule().fill(.thinMaterial)
                .overlay(Capsule().strokeBorder(ink.opacity(0.15), lineWidth: 1))
        } else {
            automaticSelectionBackground
        }
        #else
        automaticSelectionBackground
        #endif
    }
    @ViewBuilder private var automaticSelectionBackground: some View {
        if renderingMode != .fullColor {
            Capsule().strokeBorder(ink.opacity(0.65), lineWidth: 1)
        } else if reduceTransparency {
            Capsule().fill(ink)
        } else if #available(macOS 26.0, *) {
            Capsule().fill(.clear)
                .glassEffect(.regular, in: Capsule())
        } else {
            Capsule().fill(.thinMaterial)
                .overlay(Capsule().strokeBorder(ink.opacity(0.15), lineWidth: 1))
        }
    }
    private func modeInk(selected: Bool) -> Color {
        guard selected && reduceTransparency && renderingMode == .fullColor else { return ink }
        return colorScheme == .dark ? .black : .white
    }
    private var locale: Locale {
        Locale(identifier: entry.status.language.map { ["jp": "ja", "zh": "zh-Hans", "zhtw": "zh-Hant"][$0] ?? $0 } ?? Locale.current.identifier)
    }
    private var rtl: Bool { locale.language.characterDirection == .rightToLeft }

    func control(_ title: String, action: String, value: Bool?, icon: String) -> some View {
        let compact = family == .systemSmall
        return Button(intent: SetRouting(action, value == true ? "false" : "true")) {
            let label = HStack(spacing: 4) {
                if !compact { Image(systemName: icon).font(.caption2) }
                Text(title).font(.system(size: compact ? 11 : 12, weight: .medium))
                    .lineLimit(compact ? 2 : 1)
                    .frame(height: compact ? 28 : nil, alignment: .topLeading)
            }
            let toggle = ZStack(alignment: .leading) {
                Capsule().strokeBorder(ink.opacity(0.5), lineWidth: 1)
                    .background(ink.opacity(value == true ? 0.22 : 0.06), in: Capsule())
                Circle().fill(ink)
                    .frame(width: 12, height: 12)
                    .offset(x: value.map { $0 ? 18.0 : 4.0 } ?? 11)
            }
            .frame(width: 34, height: 20)
            .environment(\.layoutDirection, .leftToRight)
            if compact {
                VStack(alignment: .leading, spacing: 8) {
                    label
                    if value == nil { Text(text("widget.unknown")).font(.caption2) } else { toggle }
                }
            } else {
                HStack(spacing: 8) {
                    label
                    Spacer(minLength: 0)
                    if value == nil { Text(text("widget.unknown")).font(.caption2) } else { toggle }
                }
            }
        }
        .foregroundStyle(ink)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(8)
        .disabled(value == nil)
        .transaction { $0.animation = nil; $0.disablesAnimations = true }
        .invalidatableContent()
        .accessibilityLabel(title)
        .accessibilityValue(text(value.map { $0 ? "widget.on" : "widget.off" } ?? "widget.unknown"))
    }

    @ViewBuilder private var containerMaterial: some View {
        if reduceTransparency {
            Rectangle().fill(.background)
        } else {
            Rectangle().fill(.ultraThinMaterial)
        }
    }

    @ViewBuilder var body: some View {
        #if DEBUG
        if previewFamily != nil {
            content.padding(16)
                .frame(width: family == .systemSmall ? 170 : 360, height: 170)
                .background { containerMaterial }
                .overlay {
                    if previewIncreaseContrast {
                        RoundedRectangle(cornerRadius: 24).strokeBorder(ink, lineWidth: 2)
                    }
                }
                .contrast(previewIncreaseContrast ? 1.25 : 1)
                .clipShape(RoundedRectangle(cornerRadius: 24))
        } else {
            content.containerBackground(for: .widget) { containerMaterial }
        }
        #else
        content.containerBackground(for: .widget) { containerMaterial }
        #endif
    }

    private var content: some View {
        VStack(alignment: .leading, spacing: family == .systemSmall ? 10 : 12) {
            GeometryReader { geometry in
                let width = (geometry.size.width - 4) / 3
                let orderedModes = rtl ? Array(modes.reversed()) : modes
                let index = orderedModes.firstIndex(of: entry.status.mode ?? "")
                ZStack(alignment: .leading) {
                    selectionBackground
                        .frame(width: width - 2, height: 26)
                        .offset(x: 3 + CGFloat(index ?? 0) * width)
                        .opacity(index == nil ? 0 : 1)
                        .allowsHitTesting(false)
                    HStack(spacing: 0) {
                        ForEach(orderedModes, id: \.self) { mode in
                            let selected = entry.status.mode == mode
                            let label = Text(text("tray." + mode))
                                .font(.system(size: family == .systemSmall ? 12 : 13, weight: selected ? .semibold : .regular))
                                .lineLimit(1)
                                .frame(maxWidth: .infinity)
                                .frame(height: 30)
                                .foregroundStyle(modeInk(selected: selected))
                                .contentTransition(reduceMotion ? .identity : .opacity)
                                .contentShape(Rectangle())
                            Button(intent: SetRouting("mode", mode)) { label }
                            .disabled(index == nil)
                            .accessibilityAddTraits(selected ? .isSelected : [])
                        }
                    }
                    .padding(.horizontal, 2)
                    .zIndex(1)
                }
                .background(ink.opacity(0.04), in: Capsule())
                .invalidatableContent()
                .environment(\.layoutDirection, .leftToRight)
            }
            .frame(height: 30)
            HStack(spacing: 8) {
                control(text("tray.tooltip.tun"), action: "tun", value: entry.status.tun, icon: "network")
                control(text("tray.systemProxy"), action: "proxy", value: entry.status.proxy, icon: "shield.lefthalf.filled")
            }
            if let error = entry.status.error {
                Text(text(error)).font(.caption2).foregroundStyle(ink.opacity(0.8)).lineLimit(2)
            }
        }
        .environment(\.locale, locale)
        .environment(\.layoutDirection, rtl ? .rightToLeft : .leftToRight)
        .transaction { $0.animation = nil }
        .buttonStyle(.plain)
    }
}
