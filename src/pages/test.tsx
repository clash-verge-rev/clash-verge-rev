import {
  closestCenter,
  DndContext,
  DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { Box, Button, Grid } from "@mui/material";
import { emit } from "@tauri-apps/api/event";
import { nanoid } from "nanoid";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

// test icons
import apple from "@/assets/image/test/apple.svg?raw";
import github from "@/assets/image/test/github.svg?raw";
import google from "@/assets/image/test/google.svg?raw";
import youtube from "@/assets/image/test/youtube.svg?raw";
import { BasePage } from "@/components/base";
import { ScrollTopButton } from "@/components/layout/scroll-top-button";
import { TestItem } from "@/components/test/test-item";
import { TestViewer, TestViewerRef } from "@/components/test/test-viewer";
import { useVerge } from "@/hooks/use-verge";

const TestPage = () => {
  const { t } = useTranslation();
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const { verge, mutateVerge, patchVerge } = useVerge();

  // test list
  const testList = useMemo(
    () =>
      verge?.test_list ?? [
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
          name: "YouTube",
          url: "https://www.youtube.com",
          icon: youtube,
        },
      ],
    [verge],
  );

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

  const reorder = (list: any[], startIndex: number, endIndex: number) => {
    const result = Array.from(list);
    const [removed] = result.splice(startIndex, 1);
    result.splice(endIndex, 0, removed);
    return result;
  };

  const onDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (over) {
      if (active.id !== over.id) {
        const old_index = testList.findIndex((x) => x.uid === active.id);
        const new_index = testList.findIndex((x) => x.uid === over.id);
        if (old_index < 0 || new_index < 0) {
          return;
        }
        const newList = reorder(testList, old_index, new_index);
        await mutateVerge({ ...verge, test_list: newList }, false);
        await patchVerge({ test_list: newList });
      }
    }
  };

  useEffect(() => {
    if (!verge) return;
    if (!verge?.test_list) {
      patchVerge({ test_list: testList });
    }
  }, [verge, patchVerge, testList]);

  const viewerRef = useRef<TestViewerRef>(null);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const scrollToTop = () => {
    containerRef.current?.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  };

  const handleScroll = (e: any) => {
    setShowScrollTop(e.target.scrollTop > 100);
  };

  return (
    <BasePage
      full
      title={t("tests.page.title")}
      header={
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <Button
            variant="contained"
            size="small"
            onClick={() => emit("verge://test-all")}
          >
            {t("tests.page.actions.testAll")}
          </Button>
          <Button
            variant="contained"
            size="small"
            onClick={() => viewerRef.current?.create()}
          >
            {t("shared.actions.new")}
          </Button>
        </Box>
      }
    >
      <Box
        ref={containerRef}
        onScroll={handleScroll}
        sx={{
          pt: 1.25,
          mb: 0.5,
          px: "10px",
          height: "calc(100vh - 100px)",
          overflow: "auto",
          position: "relative",
        }}
      >
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={onDragEnd}
        >
          <Box sx={{ mb: 4.5 }}>
            <Grid container spacing={{ xs: 1, lg: 1 }}>
              <SortableContext
                items={testList.map((x) => {
                  return x.uid;
                })}
              >
                {testList.map((item) => (
                  <Grid
                    component={"div"}
                    size={{ xs: 6, lg: 2, sm: 4, md: 3 }}
                    key={item.uid}
                  >
                    <TestItem
                      id={item.uid}
                      itemData={item}
                      onEdit={() => viewerRef.current?.edit(item)}
                      onDelete={onDeleteTestListItem}
                    />
                  </Grid>
                ))}
              </SortableContext>
            </Grid>
          </Box>
        </DndContext>

        <ScrollTopButton
          onClick={scrollToTop}
          show={showScrollTop}
          sx={{
            position: "absolute",
            bottom: "20px",
            left: "20px",
            zIndex: 1000,
          }}
        />
      </Box>
      <TestViewer ref={viewerRef} onChange={onTestListItemChange} />
    </BasePage>
  );
};

export default TestPage;
