import { Notice } from "@/components/base";
import {
  styled,
  Box,
  Typography,
  ListItemButton,
  IconButtonProps,
  IconButton,
  Card,
  Collapse,
  alpha,
} from "@mui/material";
import { useState } from "react";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import { Virtuoso } from "react-virtuoso";

interface ExpandMoreProps extends IconButtonProps {
  expand: boolean;
}

const ExpandMore = styled((props: ExpandMoreProps) => {
  const { expand, ...other } = props;
  return <IconButton {...other} />;
})(({ theme, expand }) => ({
  transform: !expand ? "rotate(0deg)" : "rotate(180deg)",
  transition: theme.transitions.create("transform", {
    duration: theme.transitions.duration.shortest,
  }),
}));

const COLOR = [
  "primary",
  "secondary",
  "info.main",
  "warning.main",
  "success.main",
];

interface Props {
  index: number;
  item: IRuleItem;
}

const parseColor = (text: string) => {
  if (text === "REJECT" || text === "REJECT-DROP") return "error.main";
  if (text === "DIRECT") return "text.primary";

  let sum = 0;
  for (let i = 0; i < text.length; i++) {
    sum += text.charCodeAt(i);
  }
  return COLOR[sum % COLOR.length];
};

const RuleItem = (props: Props) => {
  const { index, item: value } = props;
  const [expanded, setExpanded] = useState(value.expanded ?? false);

  return (
    <Card
      sx={[
        {
          borderBottom: "1px solid var(--divider-color)",
          margin: "6px 8px 0 0",
          "& ::-webkit-scrollbar": {
            width: "5px",
          },
          "& ::-webkit-scrollbar-thumb": {
            backgroundColor: "var(--primary-main)",
            borderRadius: "2px",
          },
        },
        ({ palette }) => ({
          bgcolor: expanded ? alpha(palette.primary.main, 0.2) : "",
        }),
      ]}>
      <ListItemButton
        sx={{
          borderBottom: expanded ? "1px solid var(--divider-color)" : "",
        }}
        onClick={async () => {
          if (value.type === "RuleSet") {
            try {
              value.expanded = !expanded;
              setExpanded(value.expanded);
            } catch (e) {
              console.log(e);
              Notice.error("读取规则集失败, 请确认规则集文件是否已经更新同步");
            }
          }
        }}>
        <Typography
          color="text.secondary"
          variant="body2"
          sx={{ lineHeight: 2, minWidth: 30, mr: 2.25, textAlign: "center" }}>
          {index}
        </Typography>

        <Box sx={{ userSelect: "text", width: "100%" }}>
          <Typography component="h6" variant="subtitle1" color="text.primary">
            {value.payload || "-"}
          </Typography>

          <Typography
            component="span"
            variant="body2"
            color="text.secondary"
            sx={{ mr: 3, minWidth: 120, display: "inline-block" }}>
            {value.type}
          </Typography>

          <Typography
            component="span"
            variant="body2"
            color={parseColor(value.proxy)}>
            {value.proxy}
          </Typography>
        </Box>
        {value.type === "RuleSet" && (
          <ExpandMore
            color="primary"
            expand={expanded}
            aria-expanded={expanded}
            aria-label="show more">
            <ExpandMoreIcon />
          </ExpandMore>
        )}
      </ListItemButton>
      {value.matchPayloadItems && (
        <Collapse in={expanded} timeout="auto" unmountOnExit>
          <Box
            sx={{
              margin: "auto",
              px: "2px",
              width: "90%",
              height:
                value.matchPayloadItems.length > 10
                  ? "320px"
                  : value.matchPayloadItems.length * 32,
              ":--scrollbar-width": "thin",
            }}>
            <Virtuoso
              data={value.matchPayloadItems}
              itemContent={(index, item) => (
                <div
                  style={{
                    margin: "2px",
                    height: "30px",
                    lineHeight: "30px",
                  }}>
                  <span>{item}</span>
                </div>
              )}
            />
          </Box>
        </Collapse>
      )}
    </Card>
  );
};

export default RuleItem;
