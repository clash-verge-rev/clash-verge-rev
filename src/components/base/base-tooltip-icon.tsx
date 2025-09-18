import { InfoRounded } from "@mui/icons-material";
import {
  Tooltip,
  IconButton,
  IconButtonProps,
  SvgIconProps,
} from "@mui/material";

interface Props extends IconButtonProps {
  title?: string;
  icon?: React.ElementType<SvgIconProps>;
}

export const TooltipIcon: React.FC<Props> = (props: Props) => {
  const { title = "", icon: Icon = InfoRounded, ...restProps } = props;

  return (
    <Tooltip title={title} placement="top">
      <IconButton color="inherit" size="small" {...restProps}>
        <Icon fontSize="inherit" style={{ cursor: "pointer", opacity: 0.75 }} />
      </IconButton>
    </Tooltip>
  );
};
