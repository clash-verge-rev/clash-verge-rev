import { FolderRounded } from "@mui/icons-material";
import { Box, Typography } from "@mui/material";

interface Props {
  group: IProfileGroup;
  profileCount: number;
  children: React.ReactNode;
}

export const ProfileGroupSection = (props: Props) => {
  const { group, profileCount, children } = props;

  if (profileCount === 0) return null;

  return (
    <Box sx={{ mb: 2.5 }}>
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          px: 1,
          py: 0.75,
          mb: 1.5,
        }}
      >
        <FolderRounded
          sx={{
            fontSize: "18px",
            color: "primary.main",
            mr: 1,
          }}
        />
        <Typography
          variant="body2"
          sx={{
            fontWeight: 600,
            color: "text.primary",
            letterSpacing: "0.5px",
          }}
        >
          {group.name}
        </Typography>
        <Typography
          variant="caption"
          sx={{
            ml: 0.75,
            color: "text.secondary",
            fontSize: "12px",
          }}
        >
          ({profileCount})
        </Typography>
      </Box>
      {children}
    </Box>
  );
};
