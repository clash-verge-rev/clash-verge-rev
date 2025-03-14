import { useEffect, useRef } from "react";
import { useVerge } from "@/hooks/use-verge";
import { Box, IconButton, Tooltip, alpha, styled } from "@mui/material";
import Grid from "@mui/material/Grid2";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext } from "@dnd-kit/sortable";

import { useTranslation } from "react-i18next";
import { TestViewer, TestViewerRef } from "@/components/test/test-viewer";
import { TestItem } from "@/components/test/test-item";
import { emit } from "@tauri-apps/api/event";
import { nanoid } from "nanoid";
import { Add, NetworkCheck } from "@mui/icons-material";
import { EnhancedCard } from "./enhanced-card";

// test icons
import apple from "@/assets/image/test/apple.svg?raw";
import github from "@/assets/image/test/github.svg?raw";
import google from "@/assets/image/test/google.svg?raw";
import youtube from "@/assets/image/test/youtube.svg?raw";

// 自定义滚动条样式
const ScrollBox = styled(Box)(({ theme }) => ({
  maxHeight: "180px",
  overflowY: "auto",
  overflowX: "hidden",
  "&::-webkit-scrollbar": {
    width: "6px",
  },
  "&::-webkit-scrollbar-thumb": {
    backgroundColor: alpha(theme.palette.text.primary, 0.2),
    borderRadius: "3px",
  },
}));

export const TestCard = () => {
  const { t } = useTranslation();
  const sensors = useSensors(useSensor(PointerSensor));
  const { verge, mutateVerge, patchVerge } = useVerge();

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

  const onDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      let old_index = testList.findIndex((x) => x.uid === active.id);
      let new_index = testList.findIndex((x) => x.uid === over.id);
      if (old_index >= 0 && new_index >= 0) {
        const newList = [...testList];
        const [removed] = newList.splice(old_index, 1);
        newList.splice(new_index, 0, removed);

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
  }, [verge]);

  const viewerRef = useRef<TestViewerRef>(null);

  return (
    <EnhancedCard
      title={t("Website Tests")}
      icon={<NetworkCheck />}
      action={
        <Box sx={{ display: "flex", gap: 1 }}>
          <Tooltip title={t("Test All")} arrow>
            <IconButton size="small" onClick={() => emit("verge://test-all")}>
              <NetworkCheck fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title={t("Create Test")} arrow>
            <IconButton
              size="small"
              onClick={() => viewerRef.current?.create()}
            >
              <Add fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
      }
    >
      <ScrollBox>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={onDragEnd}
        >
          <Grid container spacing={1} columns={12}>
            <SortableContext items={testList.map((x) => x.uid)}>
              {testList.map((item) => (
                <Grid key={item.uid} size={3}>
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
        </DndContext>
      </ScrollBox>

      <TestViewer ref={viewerRef} onChange={onTestListItemChange} />
    </EnhancedCard>
  );
};
