import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React, { forwardRef, useImperativeHandle } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import "@/test/utils/page-test-utils";

const emitMock = vi.fn();
const mutateVergeMock = vi.fn();
const patchVergeMock = vi.fn();
const testViewerCreateMock = vi.fn();
const testViewerEditMock = vi.fn();
const renderTestItemMock = vi.fn();

let vergeState: any = {
  test_list: [
    { uid: "one", name: "One", url: "https://one.example.com" },
    { uid: "two", name: "Two", url: "https://two.example.com" },
  ],
};

let dndContextProps: {
  onDragEnd?: (event: {
    active: { id: string };
    over?: { id: string } | null;
  }) => void;
} | null = null;

vi.mock("nanoid", () => ({
  nanoid: vi
    .fn()
    .mockImplementationOnce(() => "apple-id")
    .mockImplementationOnce(() => "github-id")
    .mockImplementationOnce(() => "google-id")
    .mockImplementationOnce(() => "youtube-id")
    .mockImplementation(() => "default-id"),
}));

vi.mock("@tauri-apps/api/event", () => ({
  emit: (...args: Parameters<typeof emitMock>) => emitMock(...args),
}));

vi.mock("@/hooks/use-verge", () => ({
  useVerge: () => ({
    verge: vergeState,
    mutateVerge: mutateVergeMock,
    patchVerge: patchVergeMock,
  }),
}));

vi.mock("@/components/layout/scroll-top-button", () => ({
  ScrollTopButton: ({ onClick }: { onClick: () => void }) => (
    <button type="button" data-testid="scroll-top" onClick={onClick}>
      scroll-top
    </button>
  ),
}));

vi.mock("@/components/test/test-item", () => ({
  TestItem: ({
    itemData,
    onDelete,
    id,
    ...rest
  }: {
    itemData: IVergeTestItem;
    onDelete: (uid: string) => void;
    id: string;
  }) => {
    renderTestItemMock({ itemData, onDelete, id, ...rest });
    return (
      <div data-testid={`test-item-${itemData.name}`}>
        <button
          type="button"
          data-testid={`delete-${itemData.uid}`}
          onClick={() => onDelete(id)}
        >
          delete
        </button>
      </div>
    );
  },
}));

vi.mock("@/components/test/test-viewer", () => ({
  TestViewer: forwardRef((_props: any, ref) => {
    useImperativeHandle(ref, () => ({
      create: testViewerCreateMock,
      edit: testViewerEditMock,
    }));
    return <div data-testid="test-viewer" />;
  }),
}));

vi.mock("@dnd-kit/core", () => ({
  DndContext: ({ children, ...props }: any) => {
    dndContextProps = { ...props };
    return <div data-testid="dnd-context">{children}</div>;
  },
  closestCenter: vi.fn(),
  PointerSensor: vi.fn(),
  KeyboardSensor: vi.fn(),
  useSensor: vi.fn((sensor) => sensor),
  useSensors: vi.fn((...args) => args),
}));

vi.mock("@dnd-kit/sortable", () => ({
  SortableContext: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  sortableKeyboardCoordinates: vi.fn(),
}));

const TestPageModule = await import("@/pages/test");
const TestPage = TestPageModule.default;

describe("TestPage", () => {
  beforeEach(() => {
    emitMock.mockReset();
    mutateVergeMock.mockReset().mockResolvedValue(undefined);
    patchVergeMock.mockReset().mockResolvedValue(undefined);
    testViewerCreateMock.mockReset();
    testViewerEditMock.mockReset();
    renderTestItemMock.mockClear();
    vergeState = {
      test_list: [
        { uid: "one", name: "One", url: "https://one.example.com" },
        { uid: "two", name: "Two", url: "https://two.example.com" },
      ],
    };
    dndContextProps = null;
    localStorage.clear();
  });

  it("falls back to default test list when verge has none", async () => {
    vergeState = {};
    render(<TestPage />);

    await waitFor(() => {
      expect(patchVergeMock).toHaveBeenCalled();
    });

    const firstCall = patchVergeMock.mock.calls[0][0] as {
      test_list: Array<{ name: string }>;
    };
    expect(firstCall.test_list).toHaveLength(4);
    expect(renderTestItemMock).toHaveBeenCalled();
    expect(renderTestItemMock.mock.calls[0][0].itemData.name).toBe("Apple");
  });

  it("emits verge test-all event and opens viewer for new test", async () => {
    const user = userEvent.setup();
    render(<TestPage />);

    await user.click(screen.getByRole("button", { name: "Test All" }));
    expect(emitMock).toHaveBeenCalledWith("verge://test-all");

    await user.click(screen.getByRole("button", { name: "New" }));
    expect(testViewerCreateMock).toHaveBeenCalled();
  });

  it("deletes a test item and syncs verge state", async () => {
    const user = userEvent.setup();
    render(<TestPage />);

    await user.click(screen.getByTestId("delete-one"));

    expect(patchVergeMock).toHaveBeenCalledWith({
      test_list: [{ uid: "two", name: "Two", url: "https://two.example.com" }],
    });
    expect(mutateVergeMock).toHaveBeenCalledWith(
      {
        ...vergeState,
        test_list: [
          { uid: "two", name: "Two", url: "https://two.example.com" },
        ],
      },
      false,
    );
  });

  it("reorders tests on drag end and persists the new order", async () => {
    render(<TestPage />);

    expect(dndContextProps?.onDragEnd).toBeTruthy();

    await dndContextProps!.onDragEnd?.({
      active: { id: "one" },
      over: { id: "two" },
    });

    const reordered = [
      { uid: "two", name: "Two", url: "https://two.example.com" },
      { uid: "one", name: "One", url: "https://one.example.com" },
    ];

    expect(mutateVergeMock).toHaveBeenCalledWith(
      { ...vergeState, test_list: reordered },
      false,
    );
    expect(patchVergeMock).toHaveBeenCalledWith({ test_list: reordered });
  });
});
