import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TestCard } from "@/components/home/test-card";
import type { TestViewerRef } from "@/components/test/test-viewer";

const mocks = vi.hoisted(() => {
  let nanoidCounter = 0;
  const emitMock = vi.fn();
  const mutateVergeMock = vi.fn();
  const patchVergeMock = vi.fn();
  const useVergeMock = vi.fn();
  const viewerCreateMock = vi.fn();
  const viewerEditMock = vi.fn();
  const nanoidMock = vi.fn(() => `generated-${nanoidCounter++}`);
  const testItemHandlers = new Map<
    string,
    { onDelete: (uid: string) => void; onEdit: () => void }
  >();
  let latestOnChange:
    | ((uid: string, patch?: Partial<IVergeTestItem>) => void)
    | undefined;
  const setOnChange = (
    handler: (uid: string, patch?: Partial<IVergeTestItem>) => void,
  ) => {
    latestOnChange = handler;
  };

  return {
    emitMock,
    mutateVergeMock,
    patchVergeMock,
    useVergeMock,
    viewerCreateMock,
    viewerEditMock,
    nanoidMock,
    setOnChange,
    getOnChange: () => latestOnChange,
    resetNanoid: () => {
      nanoidCounter = 0;
    },
    registerTestItemHandlers: (
      uid: string,
      handlers: { onDelete: (uid: string) => void; onEdit: () => void },
    ) => {
      testItemHandlers.set(uid, handlers);
    },
    getTestItemHandlers: (uid: string) => testItemHandlers.get(uid),
    resetTestItemHandlers: () => {
      testItemHandlers.clear();
    },
  };
});

vi.mock("@tauri-apps/api/event", () => ({
  emit: (...args: Parameters<typeof mocks.emitMock>) => mocks.emitMock(...args),
}));

vi.mock("nanoid", () => ({
  nanoid: () => mocks.nanoidMock(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (value: string) => value,
  }),
}));

vi.mock("@dnd-kit/core", async () => {
  const React = await vi.importActual<typeof import("react")>("react");

  const DndContext = ({
    children,
    onDragEnd,
  }: {
    children: React.ReactNode;
    onDragEnd?: (event: any) => void;
  }) => {
    if (onDragEnd) {
      // keep latest handler accessible via mocks if needed later
      (DndContext as any).__lastOnDragEnd = onDragEnd;
    }
    return <div data-testid="dnd-context">{children}</div>;
  };

  const DragOverlay = () => <div data-testid="drag-overlay" />;

  return {
    DndContext,
    closestCenter: vi.fn(),
    PointerSensor: Symbol("PointerSensor"),
    useSensor: () => "sensor",
    useSensors: () => [],
    DragOverlay,
  };
});

vi.mock("@dnd-kit/sortable", async () => {
  const React = await vi.importActual<typeof import("react")>("react");
  const { Fragment, createElement } = React;
  return {
    SortableContext: ({ children }: { children: React.ReactNode }) =>
      createElement(Fragment, null, children),
  };
});

vi.mock("@/hooks/use-verge", () => ({
  useVerge: () => mocks.useVergeMock(),
}));

vi.mock("@/components/test/test-item", async () => {
  const React = await vi.importActual<typeof import("react")>("react");
  const { createElement } = React;
  return {
    TestItem: ({
      itemData,
      onDelete,
      onEdit,
    }: {
      id: string;
      itemData: IVergeTestItem;
      onEdit: () => void;
      onDelete: (uid: string) => void;
    }) => {
      mocks.registerTestItemHandlers(itemData.uid, { onDelete, onEdit });
      return createElement("div", {
        "data-testid": `test-item-${itemData.uid}`,
      });
    },
  };
});

vi.mock("@/components/test/test-viewer", async () => {
  const React = await vi.importActual<typeof import("react")>("react");
  const { forwardRef, useImperativeHandle, createElement } = React;

  const TestViewer = forwardRef<
    TestViewerRef,
    {
      onChange: (uid: string, patch?: Partial<IVergeTestItem>) => void;
    }
  >(({ onChange }, ref) => {
    mocks.setOnChange(onChange);
    useImperativeHandle(ref, () => ({
      create: () => mocks.viewerCreateMock(),
      edit: () => mocks.viewerEditMock(),
    }));
    return createElement("div", { "data-testid": "test-viewer-mock" });
  });

  return { TestViewer };
});

vi.mock("@/components/home/enhanced-card", async () => {
  const React = await vi.importActual<typeof import("react")>("react");
  const { createElement } = React;
  return {
    EnhancedCard: ({
      title,
      icon,
      action,
      children,
    }: {
      title: string;
      icon: React.ReactNode;
      action: React.ReactNode;
      children: React.ReactNode;
    }) =>
      createElement(
        "div",
        { "data-testid": "enhanced-card" },
        createElement("h2", null, title),
        createElement("div", { "data-testid": "card-icon" }, icon),
        createElement("div", { "data-testid": "card-action" }, action),
        createElement("div", { "data-testid": "card-body" }, children),
      ),
  };
});

vi.mock("@mui/material", async () => {
  const React = await vi.importActual<typeof import("react")>("react");
  const { createElement, Fragment } = React;

  const Box = ({ children, ...rest }: { children?: React.ReactNode }) =>
    createElement("div", { ...rest }, children);

  const IconButton = ({
    children,
    onClick,
  }: {
    children?: React.ReactNode;
    onClick?: () => void;
  }) => createElement("button", { type: "button", onClick }, children);

  const Tooltip = ({
    children,
  }: {
    children: React.ReactElement;
    title: string;
  }) => createElement(Fragment, null, children);

  const Grid = ({ children }: { children?: React.ReactNode }) =>
    createElement("div", null, children);

  const styled = (Component: React.ComponentType<any>) => {
    return (_: unknown) => (props: any) => createElement(Component, props);
  };

  const alpha = () => "";

  return {
    Box,
    IconButton,
    Tooltip,
    Grid,
    styled,
    alpha,
  };
});

vi.mock("@mui/icons-material", () => ({
  NetworkCheck: () => <span>NetworkCheck</span>,
  Add: () => <span>Add</span>,
}));

vi.mock("@/assets/image/test/apple.svg?raw", () => ({ default: "<svg/>" }));
vi.mock("@/assets/image/test/github.svg?raw", () => ({ default: "<svg/>" }));
vi.mock("@/assets/image/test/google.svg?raw", () => ({ default: "<svg/>" }));
vi.mock("@/assets/image/test/youtube.svg?raw", () => ({ default: "<svg/>" }));

describe("TestCard", () => {
  const {
    emitMock,
    mutateVergeMock,
    patchVergeMock,
    useVergeMock,
    viewerCreateMock,
    resetNanoid,
    getOnChange,
    getTestItemHandlers,
    resetTestItemHandlers,
  } = mocks;

  beforeEach(() => {
    vi.clearAllMocks();
    resetNanoid();
    resetTestItemHandlers();
  });

  const renderWithVerge = (verge: Partial<IVergeConfig> | undefined) => {
    useVergeMock.mockReturnValue({
      verge,
      mutateVerge: mutateVergeMock,
      patchVerge: patchVergeMock,
    });
    return render(<TestCard />);
  };

  it("initializes default test list when verge missing test_list", async () => {
    renderWithVerge({});

    await waitFor(() => {
      expect(patchVergeMock).toHaveBeenCalledTimes(1);
      const patchArg = patchVergeMock.mock.calls[0][0] as Partial<IVergeConfig>;
      expect(patchArg.test_list).toBeTruthy();
      expect(patchArg.test_list).toHaveLength(4);
    });
  });

  it("emits test-all event when Test All button clicked", async () => {
    renderWithVerge({
      test_list: [
        {
          uid: "a",
          name: "Item A",
          url: "https://a",
          icon: "",
        },
      ],
    });

    const user = userEvent.setup();
    const testAllButton = screen
      .getAllByRole("button")
      .find((button) => button.textContent === "NetworkCheck");
    expect(testAllButton).toBeTruthy();
    await user.click(testAllButton as HTMLButtonElement);

    expect(emitMock).toHaveBeenCalledWith("verge://test-all");
  });

  it("opens create viewer when Create Test button clicked", async () => {
    renderWithVerge({
      test_list: [
        {
          uid: "a",
          name: "Item A",
          url: "https://a",
          icon: "",
        },
      ],
    });

    const user = userEvent.setup();
    const createButton = screen
      .getAllByRole("button")
      .find((button) => button.textContent === "Add");
    expect(createButton).toBeTruthy();
    await user.click(createButton as HTMLButtonElement);

    expect(viewerCreateMock).toHaveBeenCalledTimes(1);
  });

  it("updates verge when TestViewer emits change", async () => {
    const verge = {
      test_list: [
        {
          uid: "a",
          name: "Item A",
          url: "https://a",
          icon: "",
        },
        {
          uid: "b",
          name: "Item B",
          url: "https://b",
          icon: "",
        },
      ],
    };

    renderWithVerge(verge);

    const handler = getOnChange();
    expect(handler).toBeDefined();

    handler?.("b", { name: "Updated" });

    expect(mutateVergeMock).toHaveBeenCalledWith(
      {
        ...verge,
        test_list: [
          verge.test_list![0],
          { ...verge.test_list![1], name: "Updated" },
        ],
      },
      false,
    );
  });

  it("mutates verge without patch when TestViewer reports plain change", async () => {
    const verge = {
      test_list: [
        {
          uid: "a",
          name: "Item A",
          url: "https://a",
          icon: "",
        },
      ],
    };

    renderWithVerge(verge);
    mutateVergeMock.mockClear();

    const handler = getOnChange();
    handler?.("a");

    expect(mutateVergeMock).toHaveBeenCalledTimes(1);
    expect(mutateVergeMock).toHaveBeenCalledWith();
  });

  it("removes a test item via TestItem delete handler", async () => {
    const verge = {
      test_list: [
        {
          uid: "a",
          name: "Item A",
          url: "https://a",
          icon: "",
        },
        {
          uid: "b",
          name: "Item B",
          url: "https://b",
          icon: "",
        },
      ],
    };

    renderWithVerge(verge);

    mutateVergeMock.mockClear();
    patchVergeMock.mockClear();

    const handlers = getTestItemHandlers("b");
    expect(handlers).toBeDefined();
    handlers?.onDelete("b");

    expect(patchVergeMock).toHaveBeenCalledWith({
      test_list: [
        {
          uid: "a",
          name: "Item A",
          url: "https://a",
          icon: "",
        },
      ],
    });
    expect(mutateVergeMock).toHaveBeenCalledWith(
      {
        ...verge,
        test_list: [
          {
            uid: "a",
            name: "Item A",
            url: "https://a",
            icon: "",
          },
        ],
      },
      false,
    );
  });
});
