import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { updateRuleProvider } from "tauri-plugin-mihomo-api";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const useAppDataMock = vi.fn();
let consoleErrorSpy: ReturnType<typeof vi.spyOn> | undefined;

vi.mock("@/providers/app-data-context", () => ({
  useAppData: () => useAppDataMock(),
}));

vi.mock("@/services/noticeService", () => ({
  showNotice: vi.fn(),
}));

vi.mock("tauri-plugin-mihomo-api", () => ({
  updateRuleProvider: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("ahooks", () => ({
  useLockFn: <T extends (...args: never[]) => unknown>(fn: T) => fn,
}));

vi.mock("dayjs", () => ({
  default: () => ({
    fromNow: () => "moments ago",
  }),
}));

import { showNotice } from "@/services/noticeService";

import { ProviderButton } from "../provider-button";

type RuleProvider = {
  name: string;
  behavior: string;
  format: string;
  ruleCount: number;
  type: string;
  updatedAt: string;
  vehicleType: string;
};

const updateRuleProviderMock = vi.mocked(updateRuleProvider);
const showNoticeMock = vi.mocked(showNotice);

const sampleProviders: Record<string, RuleProvider> = {
  "alpha-provider": {
    name: "alpha-provider",
    behavior: "classical",
    format: "yaml",
    ruleCount: 12,
    type: "http",
    updatedAt: "2024-01-01T00:00:00Z",
    vehicleType: "http",
  },
  "beta-provider": {
    name: "beta-provider",
    behavior: "domain",
    format: "yaml",
    ruleCount: 25,
    type: "http",
    updatedAt: "2024-02-01T00:00:00Z",
    vehicleType: "file",
  },
};

const arrange = (
  overrides: Partial<ReturnType<typeof createContextValue>> = {},
) => {
  const contextValue = createContextValue(overrides);
  useAppDataMock.mockReturnValue(contextValue);

  return {
    contextValue,
    user: userEvent.setup(),
    renderResult: render(<ProviderButton />),
  };
};

const createContextValue = (
  overrides: Partial<{
    ruleProviders: Record<string, RuleProvider>;
    refreshRules: () => Promise<void>;
    refreshRuleProviders: () => Promise<void>;
  }> = {},
) => ({
  ruleProviders: sampleProviders,
  refreshRules: vi.fn().mockResolvedValue(undefined),
  refreshRuleProviders: vi.fn().mockResolvedValue(undefined),
  ...overrides,
});

beforeEach(() => {
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  consoleErrorSpy?.mockRestore();
  consoleErrorSpy = undefined;
  vi.clearAllMocks();
  useAppDataMock.mockReset();
});

describe("ProviderButton", () => {
  it("renders nothing when there are no rule providers", () => {
    useAppDataMock.mockReturnValue(
      createContextValue({
        ruleProviders: {},
      }),
    );

    const { container } = render(<ProviderButton />);

    expect(container).toBeEmptyDOMElement();
    expect(updateRuleProviderMock).not.toHaveBeenCalled();
  });

  it("opens the dialog and updates a single provider", async () => {
    const { user, contextValue } = arrange();

    const trigger = screen.getByRole("button", { name: "Rule Provider" });
    await user.click(trigger);

    const listItem = await screen.findByText("alpha-provider");
    const updateButton = within(listItem.closest("li")!).getByTitle(
      "Update Provider",
    );

    updateRuleProviderMock.mockResolvedValue(undefined);

    await user.click(updateButton);

    await waitFor(() =>
      expect(updateRuleProviderMock).toHaveBeenCalledWith("alpha-provider"),
    );
    expect(contextValue.refreshRules).toHaveBeenCalledTimes(1);
    expect(contextValue.refreshRuleProviders).toHaveBeenCalledTimes(1);
    expect(showNoticeMock).toHaveBeenCalledWith(
      "success",
      expect.stringContaining("alpha-provider"),
    );
  });

  it("updates all providers when requested", async () => {
    const { user, contextValue } = arrange();
    await user.click(screen.getByRole("button", { name: "Rule Provider" }));

    const updateAll = await screen.findByRole("button", { name: "Update All" });
    updateRuleProviderMock.mockResolvedValue(undefined);

    await user.click(updateAll);

    await waitFor(() =>
      expect(updateRuleProviderMock).toHaveBeenCalledTimes(
        Object.keys(sampleProviders).length,
      ),
    );
    const calledNames = updateRuleProviderMock.mock.calls.map(([name]) => name);
    expect(calledNames).toEqual(
      expect.arrayContaining(Object.keys(sampleProviders)),
    );
    expect(contextValue.refreshRules).toHaveBeenCalledTimes(1);
    expect(contextValue.refreshRuleProviders).toHaveBeenCalledTimes(1);
    expect(showNoticeMock).toHaveBeenCalledWith("success", expect.any(String));
  });

  it("disables the provider action while an update is pending", async () => {
    const { user } = arrange();
    await user.click(screen.getByRole("button", { name: "Rule Provider" }));

    const targetRow = await screen.findByText("beta-provider");
    const actionButton = within(targetRow.closest("li")!).getByTitle(
      "Update Provider",
    );

    let resolveUpdate: (() => void) | undefined;
    updateRuleProviderMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveUpdate = resolve;
        }),
    );

    await user.click(actionButton);

    await waitFor(() => expect(actionButton).toBeDisabled());

    resolveUpdate?.();

    await waitFor(() => expect(actionButton).not.toBeDisabled());
  });

  it("reports an error when a provider update fails", async () => {
    const { user, contextValue } = arrange();
    await user.click(screen.getByRole("button", { name: "Rule Provider" }));

    const listItem = await screen.findByText("alpha-provider");
    const updateButton = within(listItem.closest("li")!).getByTitle(
      "Update Provider",
    );

    updateRuleProviderMock.mockRejectedValueOnce(new Error("network-down"));

    await user.click(updateButton);

    await waitFor(() =>
      expect(showNoticeMock).toHaveBeenCalledWith(
        "error",
        expect.stringContaining("network-down"),
      ),
    );
    expect(contextValue.refreshRules).not.toHaveBeenCalled();
    expect(contextValue.refreshRuleProviders).not.toHaveBeenCalled();
    await waitFor(() => expect(updateButton).not.toBeDisabled());
  });

  it("continues updating remaining providers when one fails", async () => {
    const { user, contextValue } = arrange();
    await user.click(screen.getByRole("button", { name: "Rule Provider" }));

    updateRuleProviderMock
      .mockImplementationOnce(() => Promise.reject(new Error("boom")))
      .mockResolvedValue(undefined);

    const updateAll = await screen.findByRole("button", { name: "Update All" });
    await user.click(updateAll);

    await waitFor(() =>
      expect(updateRuleProviderMock).toHaveBeenCalledTimes(
        Object.keys(sampleProviders).length,
      ),
    );
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("alpha-provider"),
      expect.any(Error),
    );
    expect(contextValue.refreshRules).toHaveBeenCalledTimes(1);
    expect(contextValue.refreshRuleProviders).toHaveBeenCalledTimes(1);
    expect(showNoticeMock).toHaveBeenCalledWith("success", expect.any(String));
  });
});
