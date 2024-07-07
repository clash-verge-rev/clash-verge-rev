import { Select, SelectProps, styled } from "@mui/material";

export const BaseStyledSelect = styled((props: SelectProps<string>) => {
  return (
    <Select
      size="small"
      autoComplete="new-password"
      sx={{
        width: 120,
        height: 33.375,
        mr: 1,
        '[role="button"]': { py: 0.65 },
      }}
      {...props}
    />
  );
})(({ theme }) => ({
  background: theme.palette.mode === "light" ? "#fff" : undefined,
}));
