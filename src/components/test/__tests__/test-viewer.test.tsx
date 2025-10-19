/* eslint-disable @eslint-react/no-create-ref */

import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ChangeEvent, ReactNode } from "react";
import { createRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TestViewer, type TestViewerRef } from "@/components/test/test-viewer";

const mocks = vi.hoisted(() => {
  const nanoidMock = vi.fn(() => "generated-uid");
  const useVergeMock = vi.fn();
  const patchVergeMock = vi.fn();
  const showNoticeMock = vi.fn();

  return {
    nanoidMock,
    useVergeMock,
    patchVergeMock,
    showNoticeMock,
  };
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("ahooks", () => ({
  useLockFn: <T extends (...args: unknown[]) => unknown>(fn: T) => fn,
}));

vi.mock("nanoid", () => ({
  nanoid: mocks.nanoidMock,
}));

vi.mock("@/components/base", () => ({
  BaseDialog: ({
    open,
    title,
    children,
    onOk,
    onCancel,
    okBtn,
    cancelBtn,
    loading,
  }: {
    open: boolean;
    title: string;
    children: ReactNode;
    onOk?: () => void;
    onCancel?: () => void;
    okBtn: string;
    cancelBtn: string;
    loading?: boolean;
  }) =>
    open ? (
      <div data-testid="test-viewer-dialog">
        <h2>{title}</h2>
        <div>{children}</div>
        <button type="button" onClick={onCancel}>
          {cancelBtn}
        </button>
        <button
          type="button"
          onClick={onOk}
          disabled={loading}
          aria-label={okBtn}
        >
          {okBtn}
        </button>
      </div>
    ) : null,
}));

vi.mock("@mui/material", () => ({
  TextField: ({
    label,
    multiline,
    value,
    onChange,
  }: {
    label: string;
    multiline?: boolean;
    value?: string;
    onChange?: (
      event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
    ) => void;
  }) => {
    const Tag = multiline ? "textarea" : "input";
    return (
      <label>
        {label}
        <Tag
          aria-label={label}
          value={value ?? ""}
          onChange={onChange}
          data-testid={`field-${label}`}
        />
      </label>
    );
  },
}));

vi.mock("@/hooks/use-verge", () => ({
  useVerge: () => mocks.useVergeMock(),
}));

vi.mock("@/services/noticeService", () => ({
  showNotice: (...args: unknown[]) => mocks.showNoticeMock(...args),
}));

describe("TestViewer", () => {
  const { nanoidMock, useVergeMock, patchVergeMock, showNoticeMock } = mocks;

  beforeEach(() => {
    vi.clearAllMocks();
    nanoidMock.mockReturnValue("generated-uid");
    useVergeMock.mockReturnValue({
      verge: { test_list: [] },
      patchVerge: patchVergeMock,
    });
  });

  const openViewer = async () => {
    const onChange = vi.fn();
    const ref = createRef<TestViewerRef>();
    render(<TestViewer ref={ref} onChange={onChange} />);
    await act(() => {
      ref.current?.create();
    });
    expect(screen.getByTestId("test-viewer-dialog")).toBeInTheDocument();
    return { ref, onChange };
  };

  it("creates a new test item when form is valid", async () => {
    const { onChange } = await openViewer();
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("Name"), "New Test");
    await user.type(screen.getByLabelText("Test URL"), "https://example.com");

    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(patchVergeMock).toHaveBeenCalledWith({
        test_list: [
          {
            uid: "generated-uid",
            name: "New Test",
            icon: "",
            url: "https://example.com",
          },
        ],
      });
    });

    expect(onChange).toHaveBeenCalledWith("generated-uid");
    expect(showNoticeMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId("test-viewer-dialog")).not.toBeInTheDocument();
  });

  it("shows validation message when required fields are missing", async () => {
    const { onChange } = await openViewer();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(showNoticeMock).toHaveBeenCalledWith(
        "error",
        "`Name` should not be null",
      );
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("updates an existing item through edit flow", async () => {
    useVergeMock.mockReturnValue({
      verge: {
        test_list: [
          {
            uid: "item-1",
            name: "Old",
            icon: "",
            url: "https://old.example",
          },
        ],
      },
      patchVerge: patchVergeMock,
    });

    const onChange = vi.fn();
    const ref = createRef<TestViewerRef>();
    render(<TestViewer ref={ref} onChange={onChange} />);

    await act(() => {
      ref.current?.edit({
        uid: "item-1",
        name: "Old",
        icon: "",
        url: "https://old.example",
      });
    });

    const user = userEvent.setup();
    const nameField = screen.getByLabelText("Name");
    await user.clear(nameField);
    await user.type(nameField, "Updated");

    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(patchVergeMock).toHaveBeenCalledWith({
        test_list: [
          {
            uid: "item-1",
            name: "Updated",
            icon: "",
            url: "https://old.example",
          },
        ],
      });
    });

    expect(onChange).toHaveBeenCalledWith("item-1", {
      uid: "item-1",
      name: "Updated",
      icon: "",
      url: "https://old.example",
    });
  });
});
