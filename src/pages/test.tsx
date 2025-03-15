import { useVerge } from "@/hooks/use-verge";
import { Box, Button } from "@mui/material";
import { memo, useEffect, useRef, useState } from "react";

import { BasePage, DraggableItem } from "@/components/base";
import { TestItem } from "@/components/test/test-item";
import { TestViewer, TestViewerRef } from "@/components/test/test-viewer";
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
import { emit } from "@tauri-apps/api/event";
import { nanoid } from "nanoid";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
// test icons
import apple from "@/assets/image/test/apple.svg?raw";
import github from "@/assets/image/test/github.svg?raw";
import google from "@/assets/image/test/google.svg?raw";
import youtube from "@/assets/image/test/youtube.svg?raw";

const FlexDecorationItems = memo(function FlexDecorationItems() {
  return [...Array(20)].map((_, index) => (
    <i key={index} className="mx-[5px] my-0 flex h-0 w-[180px] grow"></i>
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
  const [sortableTestList, setSortableTestList] = useState<IVergeTestItem[]>(
    [],
  );
  const [draggingTestItem, setDraggingTestItem] =
    useState<IVergeTestItem | null>(null);

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

  const getIndex = (id: UniqueIdentifier | undefined) => {
    if (id) {
      return sortableTestList.findIndex((x) => x.uid === id.toString());
    } else {
      return -1;
    }
  };

  const draggingTestIndex = getIndex(draggingTestItem?.uid);

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
        await mutateVerge({ ...verge, test_list: newTestList }, false);
        await patchVerge({ test_list: newTestList });
      }
    }
  };

  useEffect(() => {
    if (!verge) return;
    if (!verge?.test_list) {
      patchVerge({ test_list: testList });
    }
    setSortableTestList(verge.test_list ?? testList);
  }, [verge]);

  const viewerRef = useRef<TestViewerRef>(null);

  return (
    <BasePage
      full
      title={t("Test")}
      contentStyle={{ height: "100%", overflow: "auto" }}
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
      <Box sx={{ pt: "5px", px: "5px" }}>
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
                (item) => item.uid === event.active.id,
              )!;
              setDraggingTestItem(item);
            }
          }}
          onDragEnd={handleChainDragEnd}
          onDragCancel={() => setDraggingTestItem(null)}>
          <Box sx={{ width: "100%" }}>
            <SortableContext items={sortableTestList.map((item) => item.uid)}>
              <Box sx={{ display: "flex", flexWrap: "wrap" }}>
                {sortableTestList.map((item) => (
                  <DraggableItem
                    key={item.uid}
                    id={item.uid}
                    sx={{
                      display: "flex",
                      flexGrow: "1",
                      margin: "5px",
                      width: "180px",
                    }}>
                    <TestItem
                      id={item.uid}
                      isDragging={draggingTestItem?.uid === item.uid}
                      itemData={item}
                      onEdit={() => viewerRef.current?.edit(item)}
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
                  id={draggingTestItem.uid}
                  itemData={draggingTestItem}
                  onEdit={() => viewerRef.current?.edit(draggingTestItem)}
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
