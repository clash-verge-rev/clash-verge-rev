import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import "@/test/utils/page-test-utils";

const openWebUrlMock = vi.fn();
const showNoticeMock = vi.fn();

vi.mock("@/components/setting/setting-system", () => ({
  default: ({ onError }: { onError: (err: Error) => void }) => (
    <button
      type="button"
      data-testid="setting-system"
      onClick={() => onError(new Error("system error"))}
    >
      setting-system
    </button>
  ),
}));

vi.mock("@/components/setting/setting-clash", () => ({
  default: () => <div data-testid="setting-clash">setting-clash</div>,
}));

vi.mock("@/components/setting/setting-verge-basic", () => ({
  default: () => (
    <div data-testid="setting-verge-basic">setting-verge-basic</div>
  ),
}));

vi.mock("@/components/setting/setting-verge-advanced", () => ({
  default: () => (
    <div data-testid="setting-verge-advanced">setting-verge-advanced</div>
  ),
}));

vi.mock("@/services/cmds", () => ({
  openWebUrl: (...args: Parameters<typeof openWebUrlMock>) =>
    openWebUrlMock(...args),
}));

vi.mock("@/services/noticeService", () => ({
  showNotice: (...args: [string, string]) => showNoticeMock(...args),
}));

vi.mock("@/services/states", () => ({
  useThemeMode: () => "dark",
}));

const SettingsPageModule = await import("@/pages/settings");
const SettingsPage = SettingsPageModule.default;

describe("SettingsPage", () => {
  beforeEach(() => {
    openWebUrlMock.mockReset();
    showNoticeMock.mockReset();
  });

  it("renders header actions and opens external links", async () => {
    const user = userEvent.setup();
    render(<SettingsPage />);

    expect(screen.getByTestId("base-page-title")).toHaveTextContent("Settings");

    await user.click(screen.getByTitle("Manual"));
    await user.click(screen.getByTitle("TG Channel"));
    await user.click(screen.getByTitle("Github Repo"));

    expect(openWebUrlMock).toHaveBeenCalledWith(
      "https://clash-verge-rev.github.io/index.html",
    );
    expect(openWebUrlMock).toHaveBeenCalledWith("https://t.me/clash_verge_re");
    expect(openWebUrlMock).toHaveBeenCalledWith(
      "https://github.com/clash-verge-rev/clash-verge-rev",
    );
  });

  it("surfaces child errors with showNotice", async () => {
    const user = userEvent.setup();
    render(<SettingsPage />);

    await user.click(screen.getByTestId("setting-system"));

    expect(showNoticeMock).toHaveBeenCalledWith("error", "system error");
  });
});
