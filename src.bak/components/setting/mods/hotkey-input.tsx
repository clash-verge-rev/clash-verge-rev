import { useRef, useState } from "react";
import { alpha, Box, IconButton, styled } from "@mui/material";
import { DeleteRounded } from "@mui/icons-material";
import { parseHotkey } from "@/utils/parse-hotkey";

const KeyWrapper = styled("div")(({ theme }) => ({
  position: "relative",
  width: 165,
  minHeight: 36,

  "> input": {
    position: "absolute",
    top: 0,
    left: 0,
    width: "100%",
    height: "100%",
    zIndex: 1,
    opacity: 0,
  },
  "> input:focus + .list": {
    borderColor: alpha(theme.palette.primary.main, 0.75),
  },
  ".list": {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    width: "100%",
    height: "100%",
    minHeight: 36,
    boxSizing: "border-box",
    padding: "3px 4px",
    border: "1px solid",
    borderRadius: 4,
    borderColor: alpha(theme.palette.text.secondary, 0.15),
    "&:last-child": {
      marginRight: 0,
    },
  },
  ".item": {
    color: theme.palette.text.primary,
    border: "1px solid",
    borderColor: alpha(theme.palette.text.secondary, 0.2),
    borderRadius: "2px",
    padding: "1px 1px",
    margin: "2px 0",
    marginRight: 8,
  },
}));

interface Props {
  value: string[];
  onChange: (value: string[]) => void;
}

export const HotkeyInput = (props: Props) => {
  const { value, onChange } = props;

  const changeRef = useRef<string[]>([]);
  const [keys, setKeys] = useState(value);

  return (
    <Box sx={{ display: "flex", alignItems: "center" }}>
      <KeyWrapper>
        <input
          onKeyUp={() => {
            const ret = changeRef.current.slice();
            if (ret.length) {
              onChange(ret);
              changeRef.current = [];
            }
          }}
          onKeyDown={(e) => {
            const evt = e.nativeEvent;
            e.preventDefault();
            e.stopPropagation();

            const key = parseHotkey(evt.key);
            if (key === "UNIDENTIFIED") return;

            changeRef.current = [...new Set([...changeRef.current, key])];
            setKeys(changeRef.current);
          }}
        />

        <div className="list">
          {keys.map((key) => (
            <div key={key} className="item">
              {key}
            </div>
          ))}
        </div>
      </KeyWrapper>

      <IconButton
        size="small"
        title="Delete"
        color="inherit"
        onClick={() => {
          onChange([]);
          setKeys([]);
        }}
      >
        <DeleteRounded fontSize="inherit" />
      </IconButton>
    </Box>
  );
};
