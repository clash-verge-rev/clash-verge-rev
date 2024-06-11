import { useEffect, useRef, useState } from "react";
import { useVerge } from "@/hooks/use-verge";
import { Box, Button, Grid } from "@mui/material";

import { useTranslation } from "react-i18next";
import { BasePage } from "@/components/base";
import { TestViewer, TestViewerRef } from "@/components/test/test-viewer";
import { TestItem } from "@/components/test/test-item";
import { emit } from "@tauri-apps/api/event";
import { nanoid } from "nanoid";
import { ReactSortable, SortableEvent } from "react-sortablejs";

interface ISortableItem {
  id: string;
  itemData: IVergeTestItem;
}

// test icons
import apple from "@/assets/image/test/apple.svg?raw";
import github from "@/assets/image/test/github.svg?raw";
import google from "@/assets/image/test/google.svg?raw";
import youtube from "@/assets/image/test/youtube.svg?raw";

const TestPage = () => {
  const { t } = useTranslation();
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
  const [sortableTestList, setSortableTestList] = useState<ISortableItem[]>([]);

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

  const handleDragEnd = async (event: SortableEvent) => {
    if (event.oldIndex === event.newIndex) return;
    let newList = reorder(testList, event.oldIndex!, event.newIndex!);
    await mutateVerge({ ...verge, test_list: newList }, false);
    await patchVerge({ test_list: newList });
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
      <Box sx={{ pt: 1.25, mb: 0.5, px: "10px" }}>
        <ReactSortable
          style={{ display: "flex", flexWrap: "wrap" }}
          animation={150}
          dragClass="sortable-drag"
          list={sortableTestList}
          setList={setSortableTestList}
          onEnd={handleDragEnd}>
          {sortableTestList.map((item) => (
            <TestItem
              id={item.id}
              itemData={item.itemData}
              onEdit={() => viewerRef.current?.edit(item.itemData)}
              onDelete={onDeleteTestListItem}
            />
          ))}
          {[...new Array(20)].map((_) => (
            <i
              style={{
                display: "flex",
                flexGrow: "1",
                margin: "0 5px",
                width: "180px",
                height: "0",
              }}></i>
          ))}
        </ReactSortable>
      </Box>
      <TestViewer ref={viewerRef} onChange={onTestListItemChange} />
    </BasePage>
  );
};

export default TestPage;
