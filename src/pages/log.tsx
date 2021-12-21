import dayjs from "dayjs";
import { useEffect, useRef, useState } from "react";
import { Box, Button, Paper, Typography } from "@mui/material";
import { Virtuoso } from "react-virtuoso";
import LogItem from "../components/log-item";
import services from "../services";

let logCache: any[] = [];

const LogPage = () => {
  const [logData, setLogData] = useState<any[]>(logCache);

  useEffect(() => {
    const sourcePromise = services.getLogs((t) => {
      const time = dayjs().format("MM-DD HH:mm:ss");
      const item = { ...t, time };
      setLogData((l) => (logCache = [...l, item]));
    });

    return () => {
      sourcePromise.then((src) => src.cancel("cancel"));
    };
  }, []);

  return (
    <Box
      sx={{
        position: "relative",
        width: 0.9,
        maxWidth: "850px",
        height: "100%",
        mx: "auto",
      }}
    >
      <Typography variant="h4" component="h1" sx={{ py: 2 }}>
        Logs
      </Typography>

      <Button
        size="small"
        variant="contained"
        sx={{ position: "absolute", top: 22, right: 0 }}
        onClick={() => {
          setLogData([]);
          logCache = [];
        }}
      >
        Clear
      </Button>

      <Paper sx={{ boxShadow: 2, height: "calc(100% - 100px)" }}>
        <Virtuoso
          initialTopMostItemIndex={999}
          data={logData}
          itemContent={(index, logItem) => {
            return (
              <LogItem>
                <span className="time">{logItem.time}</span>
                <span className="type">{logItem.type}</span>
                <span className="data">{logItem.payload}</span>
              </LogItem>
            );
          }}
          followOutput={"smooth"}
        />
      </Paper>
    </Box>
  );
};

export default LogPage;
