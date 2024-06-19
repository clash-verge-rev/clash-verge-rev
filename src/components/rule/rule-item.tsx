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
  value: IRuleItem;
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

export const RuleItem = (props: Props) => {
  const { index, value } = props;
  const [expanded, setExpanded] = useState(value.expanded ?? false);

  return (
    <Card
      sx={{
        borderBottom: "1px solid var(--divider-color)",
        margin: "6px 8px 0 0",
        "& ::-webkit-scrollbar": {
          width: "5px",
        },
        "& ::-webkit-scrollbar-thumb": {
          backgroundColor: "var(--primary-main)",
          borderRadius: "2px",
        },
      }}>
      <ListItemButton
        sx={[
          {
            borderBottom: expanded ? "1px solid var(--divider-color)" : "none",
          },
          ({ palette: { mode, primary, text } }) => {
            const bgcolor =
              mode === "light"
                ? alpha(primary.main, 0.25)
                : alpha(primary.main, 0.35);
            const color = expanded ? primary.main : "";
            return {
              bgcolor: expanded ? bgcolor : "",
              "&:hover": {
                bgcolor: expanded ? bgcolor : "",
              },
              "& .MuiTypography-root": {
                color,
              },
              "& .MuiIconButton-root ": {
                color,
              },
            };
          },
        ]}
        onClick={() => {
          if (value.type === "RuleSet") {
            value.expanded = !expanded;
            setExpanded(value.expanded);
          }
        }}>
        <Typography
          color="text.secondary"
          variant="body2"
          sx={{ lineHeight: 2, minWidth: 30, mr: 2.25, textAlign: "center" }}>
          {index}
        </Typography>

        <Box sx={{ userSelect: "none", width: "100%" }}>
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
        <Collapse
          in={expanded}
          timeout="auto"
          unmountOnExit
          sx={{ bgcolor: "var(--background-color-alpha)" }}>
          <Box
            sx={{
              margin: "auto",
              padding: "0 10px 0 50px",
              height:
                value.matchPayloadItems.length > 10
                  ? "222px"
                  : `${value.matchPayloadItems.length * 22 + 2}px`,
            }}>
            <Virtuoso
              data={value.matchPayloadItems}
              itemContent={(index, item) => (
                <Box
                  sx={{
                    userSelect: "text",
                    marginTop: "2px",
                    height: "20px",
                    lineHeight: "20px",
                  }}>
                  <Typography
                    unselectable="on"
                    component="span"
                    variant="body2"
                    color="text.primary">
                    {item}
                  </Typography>
                </Box>
              )}
            />
          </Box>
        </Collapse>
      )}
    </Card>
  );
};
