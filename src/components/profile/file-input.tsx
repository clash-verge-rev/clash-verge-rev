import { Box, Button, Typography } from "@mui/material";
import { useLockFn } from "ahooks";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";

interface Props {
  onChange: (file: File, value: string) => void;
}

export const FileInput = (props: Props) => {
  const { onChange } = props;

  const { t } = useTranslation();
  // file input
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [loading, setLoading] = useState(false);
  const [fileName, setFileName] = useState("");

  const onFileInput = useLockFn(async (e: any) => {
    const file = e.target.files?.[0] as File;

    if (!file) return;

    setFileName(file.name);
    setLoading(true);

    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        resolve(null);
        onChange(file, event.target?.result as string);
      };
      reader.onerror = reject;
      reader.readAsText(file);
    }).finally(() => setLoading(false));
  });

  return (
    <Box sx={{ mt: 2, mb: 1, display: "flex", alignItems: "center" }}>
      <Button
        variant="outlined"
        sx={{ flex: "none" }}
        onClick={() => inputRef.current?.click()}>
        {t("Choose File")}
      </Button>

      <input
        type="file"
        accept=".yaml,.yml"
        ref={inputRef}
        style={{ display: "none" }}
        onChange={onFileInput}
      />

      <Typography noWrap sx={{ ml: 1 }}>
        {loading ? "Loading..." : fileName}
      </Typography>
    </Box>
  );
};
