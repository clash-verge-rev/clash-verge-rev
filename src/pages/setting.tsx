import { Box } from "@mui/system";
import { useRecoilState } from "recoil";
import { atomPaletteMode } from "../states/setting";
import PaletteSwitch from "../components/palette-switch";

const SettingPage = () => {
  const [mode, setMode] = useRecoilState(atomPaletteMode);

  return (
    <Box>
      <h1>Setting</h1>

      <Box>
        <PaletteSwitch
          checked={mode !== "light"}
          onChange={(_e, c) => setMode(c ? "dark" : "light")}
          inputProps={{ "aria-label": "controlled" }}
        />
      </Box>
    </Box>
  );
};

export default SettingPage;
