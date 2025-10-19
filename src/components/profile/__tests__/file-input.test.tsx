import { createTheme, ThemeProvider } from "@mui/material/styles";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FileInput } from "@/components/profile/file-input";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

const renderWithTheme = (ui: ReactElement) =>
  render(<ThemeProvider theme={createTheme()}>{ui}</ThemeProvider>);

class MockFileReader {
  public onload: ((event: ProgressEvent<FileReader>) => void) | null = null;
  public onerror: ((event: ProgressEvent<FileReader>) => void) | null = null;

  // track calls for assertions if needed
  public readAsText = vi.fn(() => {
    setTimeout(() => {
      this.onload?.({
        target: { result: "mock-file-content" },
      } as ProgressEvent<FileReader>);
    }, 0);
  });
}

describe("FileInput", () => {
  beforeEach(() => {
    vi.stubGlobal("FileReader", MockFileReader);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads selected file and forwards contents to onChange handler", async () => {
    const onChange = vi.fn();
    const { container } = renderWithTheme(<FileInput onChange={onChange} />);
    const input = container.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    const file = new File(["dummy"], "config.yaml", { type: "text/yaml" });
    const user = userEvent.setup();

    await user.upload(input, file);

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith(file, "mock-file-content");
    });

    await waitFor(() => {
      expect(screen.getByText("config.yaml")).toBeInTheDocument();
    });
  });

  it("ignores change event when no file is provided", async () => {
    const onChange = vi.fn();
    const { container } = renderWithTheme(<FileInput onChange={onChange} />);
    const input = container.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;

    fireEvent.change(input, { target: { files: [] } });

    await waitFor(() => {
      expect(onChange).not.toHaveBeenCalled();
    });
    const status = container.querySelector("p");
    expect(status?.textContent).toBe("");
  });
});
