import { ThemeProvider, createTheme } from "@mui/material/styles";
import { fireEvent, render, screen, within } from "@testing-library/react";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ConnectionItem } from "@/components/connection/connection-item";
import parseTraffic from "@/utils/parse-traffic";

dayjs.extend(relativeTime);

const closeConnectionsMock = vi.fn();

vi.mock("tauri-plugin-mihomo-api", () => ({
  closeConnections: (...args: Parameters<typeof closeConnectionsMock>) =>
    closeConnectionsMock(...args),
}));

vi.mock("ahooks", () => ({
  useLockFn: <T extends (...args: never[]) => unknown>(fn: T) => fn,
}));

const renderItem = (value: any, onShowDetail = vi.fn()) =>
  render(
    <ThemeProvider theme={createTheme()}>
      <ConnectionItem value={value} onShowDetail={onShowDetail} />
    </ThemeProvider>,
  );

describe("ConnectionItem", () => {
  const baseConnection = {
    id: "connection-1",
    chains: ["ProxyA", "ProxyB", "ProxyC"],
    metadata: {
      host: "example.com",
      destinationIP: "93.184.216.34",
      destinationPort: 443,
      process: "chrome.exe",
      network: "tcp",
      type: "https",
    },
    start: Date.UTC(2024, 0, 1, 0, 0, 0),
    curUpload: 512,
    curDownload: 2048,
  } as any;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.UTC(2024, 0, 1, 0, 1, 0)));
    closeConnectionsMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders connection metadata, tags, and traffic when threshold met", () => {
    renderItem(baseConnection);

    expect(screen.getByText("example.com")).toBeInTheDocument();
    expect(screen.getByText("tcp")).toBeInTheDocument();
    expect(screen.getByText("https")).toBeInTheDocument();
    expect(screen.getByText("chrome.exe")).toBeInTheDocument();
    expect(screen.getByText("ProxyC / ProxyB / ProxyA")).toBeInTheDocument();

    const tagContainer = screen.getByText(
      "ProxyC / ProxyB / ProxyA",
    ).parentElement!;
    const uploadText = parseTraffic(baseConnection.curUpload!).join("");
    const downloadText = parseTraffic(baseConnection.curDownload!).join("");
    const trafficTag = Array.from(tagContainer.querySelectorAll("span")).find(
      (element) => {
        const content = element.textContent ?? "";
        return (
          content.includes(uploadText) &&
          content.includes(downloadText) &&
          content.includes("/")
        );
      },
    );
    expect(trafficTag).toBeDefined();

    const expectedTime = dayjs(baseConnection.start).fromNow();
    expect(screen.getByText(expectedTime)).toBeInTheDocument();
  });

  it("invokes onShowDetail when list item content is clicked", () => {
    const onShowDetail = vi.fn();
    renderItem(baseConnection, onShowDetail);

    fireEvent.click(screen.getByText("example.com"));
    expect(onShowDetail).toHaveBeenCalledTimes(1);
  });

  it("hides traffic tag when current rates are below threshold", () => {
    const lowTrafficConnection = {
      ...baseConnection,
      curUpload: 80,
      curDownload: 40,
    };

    renderItem(lowTrafficConnection);

    const detailBox = screen.getByText("example.com").closest("li");
    expect(detailBox).not.toBeNull();

    expect(within(detailBox!).queryByText("80 B")).toBeNull();
    expect(within(detailBox!).queryByText("40 B")).toBeNull();
  });

  it("closes the connection via icon button", async () => {
    closeConnectionsMock.mockResolvedValue(undefined);
    renderItem(baseConnection);

    const deleteButton = screen.getByRole("button");
    fireEvent.click(deleteButton);

    expect(closeConnectionsMock).toHaveBeenCalledWith(baseConnection.id);
  });

  it("falls back to destination IP and hides optional tags when data is missing", () => {
    const onShowDetail = vi.fn();
    const fallbackConnection = {
      ...baseConnection,
      chains: [],
      metadata: {
        ...baseConnection.metadata,
        host: undefined,
        destinationIP: "198.51.100.5",
        network: "udp",
        process: undefined,
      },
      curUpload: 10,
      curDownload: 20,
    } as any;

    renderItem(fallbackConnection, onShowDetail);

    const primary = screen.getByText("198.51.100.5");
    fireEvent.click(primary);
    expect(onShowDetail).toHaveBeenCalledTimes(1);

    expect(screen.getByText("udp")).toBeInTheDocument();
    expect(screen.queryByText("chrome.exe")).toBeNull();
    expect(screen.queryByText("ProxyC / ProxyB / ProxyA")).toBeNull();

    const tagContainer = screen.getByText("udp").parentElement!;
    expect(
      within(tagContainer).queryByText((_, node) =>
        (node?.textContent ?? "").includes("/"),
      ),
    ).toBeNull();
    expect(
      within(tagContainer).queryByText((_, node) =>
        (node?.textContent ?? "").includes("10 B"),
      ),
    ).toBeNull();
  });
});
