import SwiftUI
import WidgetKit

#if DEBUG && PREVIEW_HOST
import UniformTypeIdentifiers
import AppKit
private struct RoutingStylePreview: View {
    @State var medium = false
    @State var dark = false
    @State var language = "en"
    @State var mode = "rule"
    @State var tun = "on"
    @State var proxy = "off"
    @State var error = "none"
    @State var reduceTransparency = false
    @State var reduceMotion = false
    @State private var backdrop = "gradient"
    @State private var material = "automatic"
    @State private var rendering = "automatic"
    @State private var increaseContrast = false
    @State private var importingWallpaper = false
    @State private var wallpaper: NSImage?
    @State private var wallpaperName = ""
    @State private var wallpaperError: String?

    private var renderingOverride: WidgetRenderingMode? {
        switch rendering {
        case "fullColor": .fullColor
        case "accented": .accented
        case "vibrant": .vibrant
        default: nil
        }
    }
    private func importWallpaper(_ result: Result<URL, Error>) {
        do {
            let url = try result.get()
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() } }
            let data = try Data(contentsOf: url)
            guard let image = NSImage(data: data) else {
                wallpaperError = "The selected file is not a readable image."
                return
            }
            wallpaper = image
            wallpaperName = url.lastPathComponent
            wallpaperError = nil
            backdrop = "wallpaper"
        } catch {
            let failure = error as NSError
            if failure.domain != NSCocoaErrorDomain || failure.code != NSUserCancelledError {
                wallpaperError = error.localizedDescription
            }
        }
    }

    private func state(_ value: String) -> Bool? {
        value == "unknown" ? nil : value == "on"
    }
    private var sample: Status {
        Status(mode: mode == "unknown" ? nil : mode, tun: state(tun), proxy: state(proxy),
               error: error == "none" ? nil : "widget." + error, language: language)
    }

    @ViewBuilder private var background: some View {
        switch backdrop {
        case "wallpaper":
            if let wallpaper {
                GeometryReader { geometry in
                    Image(nsImage: wallpaper).resizable().scaledToFill()
                        .frame(width: geometry.size.width, height: geometry.size.height).clipped()
                }
            }
        case "light": Color(white: 0.92)
        case "dark": Color(white: 0.1)
        case "pattern":
            Canvas { context, size in
                for row in 0..<8 {
                    for column in 0..<14 {
                        let rect = CGRect(x: CGFloat(column) * 32, y: CGFloat(row) * 32, width: 32, height: 32)
                        context.fill(Path(rect), with: .color((row + column).isMultiple(of: 2) ? .white : .black))
                    }
                }
            }
        default:
            LinearGradient(colors: [.blue, .purple, .orange], startPoint: .topLeading, endPoint: .bottomTrailing)
        }
    }

    var body: some View {
        VStack(spacing: 12) {
            ZStack {
                background
                RoutingView(entry: Entry(date: .now, status: sample), previewFamily: medium ? .systemMedium : .systemSmall,
                            previewRenderingMode: renderingOverride, previewMaterial: material, previewIncreaseContrast: increaseContrast,
                            previewReduceMotion: reduceMotion, previewReduceTransparency: reduceTransparency)
                    .environment(\.colorScheme, dark ? .dark : .light)
                    .allowsHitTesting(false)
            }
            .frame(height: 218)
            .clipShape(RoundedRectangle(cornerRadius: 12))
            ScrollView {
                VStack(alignment: .leading, spacing: 10) {
                    HStack {
                        Toggle("Medium", isOn: $medium)
                        Toggle("Dark", isOn: $dark)
                    }
                    Picker("Background", selection: $backdrop) {
                        Text("Light").tag("light")
                        Text("Dark").tag("dark")
                        Text("Gradient").tag("gradient")
                        Text("Contrast pattern").tag("pattern")
                        if wallpaper != nil { Text("Selected wallpaper").tag("wallpaper") }
                    }
                    HStack {
                        Button("Choose wallpaper…") { importingWallpaper = true }
                        if wallpaper != nil {
                            Text(wallpaperName).lineLimit(1).truncationMode(.middle)
                            Button("Clear") {
                                wallpaper = nil; wallpaperName = ""; wallpaperError = nil
                                if backdrop == "wallpaper" { backdrop = "gradient" }
                            }
                        }
                    }
                    if let wallpaperError { Text(wallpaperError).font(.caption).foregroundStyle(.red) }
                    Picker("Selected material", selection: $material) {
                        Text("Automatic").tag("automatic")
                        Text("Thin material").tag("thin")
                        if #available(macOS 26.0, *) { Text("Liquid Glass").tag("glass") }
                    }
                    Text("Selected material applies only in full-color rendering with Reduce transparency off.")
                        .font(.caption).foregroundStyle(.secondary)
                    Picker("Rendering input (approximate)", selection: $rendering) {
                        Text("Automatic").tag("automatic")
                        Text("Full color").tag("fullColor")
                        Text("Accented").tag("accented")
                        Text("Vibrant").tag("vibrant")
                    }
                    Toggle("Increase contrast (approximate)", isOn: $increaseContrast)
                    Picker("Language", selection: $language) {
                        Text("English").tag("en")
                        Text("简体中文").tag("zh")
                    }
                    Picker("Mode", selection: $mode) {
                        Text("Rule").tag("rule")
                        Text("Global").tag("global")
                        Text("Direct").tag("direct")
                        Text("Unknown").tag("unknown")
                    }
                    .pickerStyle(.segmented)
                    HStack {
                        Picker("TUN", selection: $tun) {
                            Text("On").tag("on"); Text("Off").tag("off"); Text("Unknown").tag("unknown")
                        }
                        Picker("Proxy", selection: $proxy) {
                            Text("On").tag("on"); Text("Off").tag("off"); Text("Unknown").tag("unknown")
                        }
                    }
                    Picker("Error", selection: $error) {
                        Text("None").tag("none")
                        Text("Offline").tag("unavailable")
                        Text("Failed").tag("failed")
                    }
                    Toggle("Reduce transparency", isOn: $reduceTransparency)
                    Toggle("Reduce motion", isOn: $reduceMotion)
                    Text("Style only. Controls change sample data; no proxy requests. Desktop WidgetKit compositing is not simulated.")
                        .font(.caption).foregroundStyle(.secondary)
                }
                .padding(4)
            }
        }
        .padding(16)
        .frame(width: 440, height: 570)
        .fileImporter(isPresented: $importingWallpaper, allowedContentTypes: [.image], onCompletion: importWallpaper)
    }
}

#Preview("Style control panel") {
    RoutingStylePreview()
}

#Preview("Medium · 中文 · Dark") {
    RoutingStylePreview(medium: true, dark: true, language: "zh", mode: "global")
}

#Preview("Small · English · Reduced transparency") {
    RoutingStylePreview(language: "en", mode: "direct", reduceTransparency: true)
}

#Preview("中文 · Unknown · Offline") {
    RoutingStylePreview(medium: true, dark: true, language: "zh", mode: "unknown", tun: "unknown", proxy: "unknown", error: "unavailable")
}
#endif
