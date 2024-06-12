import { memo, useEffect, useRef, useState } from "react";
import { useVerge } from "@/hooks/use-verge";
import { Box, Button } from "@mui/material";

import { useTranslation } from "react-i18next";
import { BasePage } from "@/components/base";
import { TestViewer, TestViewerRef } from "@/components/test/test-viewer";
import { TestItem } from "@/components/test/test-item";
import { emit } from "@tauri-apps/api/event";
import { nanoid } from "nanoid";
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  MouseSensor,
  UniqueIdentifier,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { arrayMove, SortableContext } from "@dnd-kit/sortable";
import { DraggableItem } from "@/components/base/draggable-item";
import { createPortal } from "react-dom";
// test icons
import apple from "@/assets/image/test/apple.svg?raw";
import github from "@/assets/image/test/github.svg?raw";
import google from "@/assets/image/test/google.svg?raw";
import youtube from "@/assets/image/test/youtube.svg?raw";

interface ISortableItem {
  id: string;
  itemData: IVergeTestItem;
}

const FlexDecorationItems = memo(function FlexDecorationItems() {
  return [...new Array(20)].map((_) => (
    <i
      style={{
        display: "flex",
        flexGrow: "1",
        margin: "0 5px",
        width: "180px",
        height: "0",
      }}></i>
  ));
});

const TestPage = () => {
  const { t } = useTranslation();
  const { verge, mutateVerge, patchVerge } = useVerge();
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
  );

  // test list
  const testList = verge?.test_list ?? [
    {
      uid: nanoid(),
      name: "Apple",
      url: "https://www.apple.com",
      icon: apple,
    },
    {
      uid: nanoid(),
      name: "GitHub",
      url: "https://www.github.com",
      icon: github,
    },
    {
      uid: nanoid(),
      name: "Google",
      url: "https://www.google.com",
      icon: google,
    },
    {
      uid: nanoid(),
      name: "Youtube",
      url: "https://www.youtube.com",
      icon: youtube,
    },
  ];
  const [sortableTestList, setSortableTestList] = useState<ISortableItem[]>([]);
  const [draggingTestItem, setDraggingTestItem] =
    useState<ISortableItem | null>(null);

  const [overItemWidth, setOverItemWidth] = useState(180);

  const onTestListItemChange = (
    uid: string,
    patch?: Partial<IVergeTestItem>,
  ) => {
    if (patch) {
      const newList = testList.map((x) => {
        if (x.uid === uid) {
          return { ...x, ...patch };
        }
        return x;
      });
      mutateVerge({ ...verge, test_list: newList }, false);
    } else {
      mutateVerge();
    }
  };

  const onDeleteTestListItem = (uid: string) => {
    const newList = testList.filter((x) => x.uid !== uid);
    patchVerge({ test_list: newList });
    mutateVerge({ ...verge, test_list: newList }, false);
  };

  // const reorder = (list: any[], startIndex: number, endIndex: number) => {
  //   const result = Array.from(list);
  //   const [removed] = result.splice(startIndex, 1);
  //   result.splice(endIndex, 0, removed);
  //   return result;
  // };

  const getIndex = (id: UniqueIdentifier | undefined) => {
    if (id) {
      return sortableTestList.findIndex((x) => x.id === id.toString());
    } else {
      return -1;
    }
  };

  const draggingTestIndex = getIndex(draggingTestItem?.id);

  const handleChainDragEnd = async (event: DragEndEvent) => {
    setDraggingTestItem(null);
    const { over } = event;
    if (over) {
      const overIndex = getIndex(over.id);
      if (draggingTestIndex !== overIndex) {
        const newTestList = arrayMove(
          sortableTestList,
          draggingTestIndex,
          overIndex,
        );
        setSortableTestList(newTestList);
        const testListVerge = newTestList.map((item) => item.itemData);
        await mutateVerge({ ...verge, test_list: testListVerge }, false);
        await patchVerge({ test_list: testListVerge });
      }
    }
  };

  useEffect(() => {
    if (!verge) return;
    if (!verge?.test_list) {
      patchVerge({ test_list: testList });
    }
    const converTestItems = (verge.test_list ?? testList).map((x) => {
      return {
        id: x.uid,
        itemData: x,
        onEdit: () => viewerRef.current?.edit(x),
      };
    });
    setSortableTestList(converTestItems);
  }, [verge]);

  const viewerRef = useRef<TestViewerRef>(null);

  return (
    <BasePage
      full
      title={t("Test")}
      contentStyle={{ height: "100%" }}
      header={
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <Button
            variant="contained"
            size="small"
            onClick={() => emit("verge://test-all")}>
            {t("Test All")}
          </Button>
          <Button
            variant="contained"
            size="small"
            onClick={() => viewerRef.current?.create()}>
            {t("New")}
          </Button>
        </Box>
      }>
      <Box
        sx={{
          pt: 1.25,
          mb: 0.5,
          px: "10px",
          height: "100%",
          overflow: "auto",
        }}>
        <DndContext
          sensors={sensors}
          // onDragStart={(event) => {}}
          onDragOver={(event) => {
            const { over } = event;
            if (over) {
              const itemWidth = event.over?.rect.width;
              if (itemWidth && itemWidth !== overItemWidth) {
                setOverItemWidth(itemWidth);
              }
              const item = sortableTestList.find(
                (item) => item.id === event.active.id,
              )!;
              setDraggingTestItem(item);
            }
          }}
          onDragEnd={handleChainDragEnd}
          onDragCancel={() => setDraggingTestItem(null)}>
          <Box sx={{ width: "100%" }}>
            <SortableContext items={sortableTestList.map((item) => item.id)}>
              <Box sx={{ display: "flex", flexWrap: "wrap" }}>
                {sortableTestList.map((item) => (
                  <DraggableItem
                    key={item.id}
                    id={item.id}
                    sx={{
                      display: "flex",
                      flexGrow: "1",
                      margin: "5px",
                      width: "180px",
                    }}>
                    <TestItem
                      sx={{
                        "& > .MuiBox-root": {
                          bgcolor:
                            draggingTestItem?.id === item.id
                              ? "var(--background-color-alpha)"
                              : "",
                        },
                      }}
                      id={item.id}
                      isDragging={draggingTestItem ? true : false}
                      itemData={item.itemData}
                      onEdit={() => viewerRef.current?.edit(item.itemData)}
                      onDelete={onDeleteTestListItem}
                    />
                  </DraggableItem>
                ))}
                <FlexDecorationItems />
              </Box>
            </SortableContext>
          </Box>
          {createPortal(
            <DragOverlay>
              {draggingTestItem ? (
                <TestItem
                  sx={{
                    width: overItemWidth,
                    borderRadius: "8px",
                    boxShadow: "0px 0px 10px 5px rgba(0,0,0,0.2)",
                  }}
                  id={draggingTestItem.id}
                  itemData={draggingTestItem.itemData}
                  onEdit={() =>
                    viewerRef.current?.edit(draggingTestItem.itemData)
                  }
                  onDelete={onDeleteTestListItem}
                />
              ) : null}
            </DragOverlay>,
            document.body,
          )}
        </DndContext>
      </Box>
      <TestViewer ref={viewerRef} onChange={onTestListItemChange} />
    </BasePage>
  );
};

export default TestPage;
