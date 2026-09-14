import Charts
import SwiftUI

struct DashboardView: View {
    @Environment(\.palette) private var palette
    @Environment(\.scenePhase) private var scenePhase
    let agent: Agent
    let api: RoostAPI
    let discuss: (String) -> Void
    @State private var snapshot: DashboardSnapshot?
    @State private var error: String?
    @State private var updating = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                if let error { ErrorNotice(text: error) }
                if let snapshot {
                    if !snapshot.enabled {
                        ContentUnavailableView {
                            Label("A place for the big picture", systemImage: "chart.xyaxis.line")
                        } description: {
                            Text(
                                "Enable dashboards for Roost to keep trackers, charts, and updates with each agent."
                            )
                        } actions: {
                            Button("Enable dashboards") { Task { await enable() } }
                                .buttonStyle(.borderedProminent)
                                .disabled(updating)
                        }
                    } else if snapshot.widgets.isEmpty && snapshot.datasets.isEmpty {
                        ContentUnavailableView {
                            Label("Your dashboard starts here", systemImage: "chart.bar.xaxis")
                        } description: {
                            Text(
                                "Ask \(agent.name) to build a tracker for something you care about."
                            )
                        } actions: {
                            Button("Start a tracker") {
                                discuss("Let's create a dashboard tracker.")
                            }
                            .buttonStyle(.borderedProminent)
                        }
                    } else {
                        ForEach(snapshot.widgets) { widget in
                            VStack(alignment: .leading, spacing: 20) {
                                Text(widget.title).font(.title3.weight(.semibold))
                                ForEach(Array(widget.blocks.enumerated()), id: \.offset) {
                                    _, block in
                                    DashboardBlockView(block: block, datasets: snapshot.datasets)
                                }
                                HStack {
                                    Text(Date(milliseconds: widget.updatedAt), style: .relative)
                                        .font(.caption).foregroundStyle(palette.muted)
                                    Spacer()
                                    Button {
                                        discuss(
                                            "Let's discuss the \"\(widget.title)\" dashboard widget."
                                        )
                                    } label: {
                                        Label("Discuss", systemImage: "bubble.left")
                                    }
                                    .font(.subheadline)
                                }
                            }
                            .padding(20)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(palette.surface, in: RoundedRectangle(cornerRadius: 24))
                        }
                        if !snapshot.datasets.isEmpty {
                            VStack(alignment: .leading, spacing: 14) {
                                Text("Data sources").font(.headline)
                                ForEach(snapshot.datasets) { dataset in
                                    DisclosureGroup {
                                        VStack(alignment: .leading, spacing: 12) {
                                            if let description = dataset.description {
                                                Text(description).font(.subheadline)
                                            }
                                            if let source = dataset.sourceUrl,
                                                let url = workspaceURL(source)
                                            {
                                                Link("Open source", destination: url)
                                            }
                                            DataTable(
                                                columns: dataset.columns.map(\.label),
                                                rows: dataset.rows.map { $0.map(\.text) })
                                            Text(
                                                "Revision \(dataset.revision) · \(Date(milliseconds: dataset.updatedAt).formatted(date: .abbreviated, time: .shortened))"
                                            )
                                            .font(.caption).foregroundStyle(palette.muted)
                                        }
                                        .padding(.top, 12)
                                    } label: {
                                        VStack(alignment: .leading, spacing: 4) {
                                            Text(dataset.title)
                                            Text("\(dataset.rows.count) rows").font(.caption)
                                                .foregroundStyle(palette.muted)
                                        }
                                    }
                                }
                            }
                            .padding(.horizontal, 4)
                        }
                    }
                } else if error == nil {
                    ProgressView("Loading dashboard…").frame(maxWidth: .infinity).padding(.top, 80)
                }
            }
            .padding(16)
        }
        .themedScreen()
        .navigationTitle("\(agent.name)’s dashboard")
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await refresh() }
        .task(id: scenePhase) {
            guard scenePhase == .active else { return }
            while !Task.isCancelled {
                await refresh()
                do { try await Task.sleep(for: .seconds(15)) } catch { break }
            }
        }
    }

    private func refresh() async {
        do {
            snapshot = try await api.get("agents/\(agent.id)/dashboard")
            error = nil
        } catch { if !Task.isCancelled { self.error = error.localizedDescription } }
    }
    private func enable() async {
        updating = true
        defer { updating = false }
        do {
            _ = try await api.post("agents/\(agent.id)/dashboard", ["enabled": true])
            await refresh()
        } catch { self.error = error.localizedDescription }
    }
}

struct DashboardBlockView: View {
    @Environment(\.palette) private var palette
    let block: DashboardBlock
    let datasets: [DashboardDataset]

    var body: some View {
        switch block.type {
        case "markdown": MarkdownText(text: block.text ?? "")
        case "metrics":
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .top, spacing: 24) { metrics }
                VStack(alignment: .leading, spacing: 16) { metrics }
            }
        case "tasks":
            VStack(alignment: .leading, spacing: 12) {
                ForEach(Array((block.items ?? []).enumerated()), id: \.offset) { _, item in
                    Label {
                        Text(item.label).strikethrough(item.status == "done")
                    } icon: {
                        Image(
                            systemName: item.status == "done"
                                ? "checkmark.circle.fill"
                                : item.status == "doing" ? "circle.lefthalf.filled" : "circle"
                        )
                        .foregroundStyle(item.status == "done" ? palette.accent : palette.muted)
                    }
                    .accessibilityLabel("\(item.label), \(item.status ?? "todo")")
                }
            }
        case "links":
            VStack(alignment: .leading, spacing: 12) {
                ForEach(Array((block.items ?? []).enumerated()), id: \.offset) { _, item in
                    if let url = workspaceURL(item.url ?? "") {
                        Link(destination: url) { Label(item.label, systemImage: "arrow.up.right") }
                    }
                }
            }
        case "table": DataTable(columns: block.columns ?? [], rows: block.rows ?? [])
        case "chart", "dataset-chart": DashboardChart(block: block, datasets: datasets)
        default: Text("Update Roost to view this content.").foregroundStyle(palette.muted)
        }
    }

    private var metrics: some View {
        ForEach(Array((block.items ?? []).enumerated()), id: \.offset) { _, item in
            VStack(alignment: .leading, spacing: 5) {
                Text(item.label).font(.subheadline).foregroundStyle(palette.muted)
                Text(item.value ?? "—").font(.system(.title, design: .rounded).weight(.semibold))
                    .foregroundStyle(palette.accent)
                if let note = item.note { Text(note).font(.caption).foregroundStyle(palette.muted) }
            }
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

struct DataTable: View {
    @Environment(\.palette) private var palette
    let columns: [String]
    let rows: [[String]]
    var body: some View {
        if rows.isEmpty {
            Text("No data yet").font(.subheadline).foregroundStyle(palette.muted)
        } else {
            ScrollView(.horizontal) {
                Grid(alignment: .leading, horizontalSpacing: 20, verticalSpacing: 12) {
                    GridRow {
                        ForEach(Array(columns.enumerated()), id: \.offset) { _, column in
                            Text(column).fontWeight(.semibold).foregroundStyle(palette.muted)
                        }
                    }
                    ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                        GridRow {
                            ForEach(Array(columns.enumerated()), id: \.offset) { index, column in
                                Text(row.indices.contains(index) ? row[index] : "—")
                                    .frame(maxWidth: 240, alignment: .leading)
                                    .accessibilityLabel(
                                        "\(column): \(row.indices.contains(index) ? row[index] : "—")"
                                    )
                            }
                        }
                    }
                }
                .font(.subheadline).textSelection(.enabled).padding(.vertical, 4)
            }
        }
    }
}

struct DashboardChart: View {
    @Environment(\.palette) private var palette
    let block: DashboardBlock
    let datasets: [DashboardDataset]
    struct Point: Identifiable {
        let id: Int
        let label: String
        let x: Double?
        let value: Double
        let series: String
    }
    private var points: [Point] {
        if block.type == "chart" {
            return (block.points ?? []).enumerated()
                .map {
                    Point(
                        id: $0.offset, label: $0.element.label, x: nil, value: $0.element.value,
                        series: block.title ?? "Value")
                }
        }
        guard let dataset = datasets.first(where: { $0.key == block.datasetKey }),
            let x = dataset.columns.firstIndex(where: { $0.key == block.x })
        else { return [] }
        var result: [Point] = []
        for series in block.series ?? [] {
            guard let index = dataset.columns.firstIndex(where: { $0.key == series.column }) else {
                return []
            }
            for row in dataset.rows {
                guard row.indices.contains(x), row.indices.contains(index),
                    let value = row[index].number
                else { return [] }
                result.append(
                    Point(
                        id: result.count, label: row[x].text, x: row[x].number, value: value,
                        series: series.label))
            }
        }
        return result
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            if let title = block.title { Text(title).font(.subheadline.weight(.semibold)) }
            if let error = block.chartError {
                Text(error).font(.subheadline).foregroundStyle(palette.muted)
            } else if points.isEmpty {
                Text("No chart data yet").foregroundStyle(palette.muted)
            } else {
                Chart(points) { point in
                    switch block.style {
                    case "donut":
                        SectorMark(
                            angle: .value("Value", point.value), innerRadius: .ratio(0.65),
                            angularInset: 2
                        )
                        .foregroundStyle(by: .value("Category", point.label))
                    case "scatter":
                        PointMark(x: .value("X", point.x ?? 0), y: .value("Value", point.value))
                            .foregroundStyle(by: .value("Series", point.series))
                    case "bar":
                        BarMark(x: .value("Label", point.label), y: .value("Value", point.value))
                            .foregroundStyle(by: .value("Series", point.series))
                            .position(by: .value("Series", point.series))
                            .cornerRadius(3)
                    case "stacked-bar":
                        BarMark(x: .value("Label", point.label), y: .value("Value", point.value))
                            .foregroundStyle(by: .value("Series", point.series))
                    case "area":
                        AreaMark(x: .value("Label", point.label), y: .value("Value", point.value))
                            .foregroundStyle(by: .value("Series", point.series))
                            .opacity(0.55)
                    default:
                        LineMark(x: .value("Label", point.label), y: .value("Value", point.value))
                            .foregroundStyle(by: .value("Series", point.series))
                            .symbol(by: .value("Series", point.series))
                    }
                }
                .chartForegroundStyleScale(range: [
                    palette.accent, palette.action, palette.review, palette.muted,
                ])
                .frame(height: 220)
                DisclosureGroup("View values") {
                    DataTable(
                        columns: ["Label", "Series", "Value"],
                        rows: points.map { [$0.label, $0.series, $0.value.formatted()] }
                    )
                    .padding(.top, 8)
                }
                .font(.caption)
            }
        }
    }
}
