import { Check, ContentCopy } from "@mui/icons-material";
import { IconButton, IconButtonProps } from "@mui/material";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { useState } from "react";

type CopyButtonProps = IconButtonProps & {
  content: string;
};
export const CopyButton = (props: CopyButtonProps) => {
  const [copied, setCopied] = useState(false);
  return (
    <IconButton
      {...props}
      onClick={async () => {
        await writeText(props.content);
        setCopied(true);
        setTimeout(() => {
          setCopied(false);
        }, 2000);
      }}>
      {copied ? (
        <Check fontSize="inherit" />
      ) : (
        <ContentCopy fontSize="inherit" />
      )}
    </IconButton>
  );
};
