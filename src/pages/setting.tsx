import { useState } from "react";
import { useRecoilState } from "recoil";
import {
  Box,
  List,
  ListItem,
  ListItemText,
  ListSubheader,
  Typography,
  TextField,
  styled,
  Switch,
  Select,
  MenuItem,
} from "@mui/material";
import { atomPaletteMode } from "../states/setting";
import PaletteSwitch from "../components/palette-switch";
import { setSysProxy } from "../services/command";

const MiniListItem = styled(ListItem)(({ theme }) => ({
  paddingTop: 5,
  paddingBottom: 5,
}));

const SettingPage = () => {
  const [mode, setMode] = useRecoilState(atomPaletteMode);
  const [proxy, setProxy] = useState(false);

  const onSysproxy = (enable: boolean) => {
    const value = proxy;
    setProxy(enable);
    setSysProxy(enable)
      .then(() => {
        console.log("success");
      })
      .catch((err) => {
        setProxy(value); // recover
        console.log(err);
      });
  };

  return (
    <Box sx={{ width: 0.9, maxWidth: "850px", mx: "auto", mb: 2 }}>
      <Typography variant="h4" component="h1" sx={{ py: 2 }}>
        Setting
      </Typography>

      <List sx={{ borderRadius: 1, boxShadow: 2 }}>
        <ListSubheader>通用设置</ListSubheader>

        <MiniListItem>
          <ListItemText primary="外观主题" />
          <PaletteSwitch
            edge="end"
            checked={mode !== "light"}
            onChange={(_e, c) => setMode(c ? "dark" : "light")}
          />
        </MiniListItem>

        <MiniListItem>
          <ListItemText primary="开机自启" />
          <Switch edge="end" />
        </MiniListItem>

        <MiniListItem>
          <ListItemText primary="设置系统代理" />
          <Switch
            edge="end"
            checked={proxy}
            onChange={(_e, c) => onSysproxy(c)}
          />
        </MiniListItem>

        <MiniListItem>
          <ListItemText primary="局域网连接" />
          <Switch edge="end" />
        </MiniListItem>

        <MiniListItem>
          <ListItemText primary="IPv6" />
          <Switch edge="end" />
        </MiniListItem>

        <MiniListItem>
          <ListItemText primary="日志等级" />
          <Select size="small" sx={{ width: 120 }}>
            <MenuItem value="debug">Debug</MenuItem>
            <MenuItem value="info">Info</MenuItem>
            <MenuItem value="warning">Warning</MenuItem>
            <MenuItem value="error">Error</MenuItem>
          </Select>
        </MiniListItem>

        <MiniListItem>
          <ListItemText primary="混合代理端口" />
          <TextField size="small" defaultValue={7890} sx={{ width: 120 }} />
        </MiniListItem>
      </List>
    </Box>
  );
};

export default SettingPage;
