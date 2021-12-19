import useSWR from "swr";
import { Box, List, Typography } from "@mui/material";
import services from "../services";
import ProxyGroup from "../components/proxy-group";

const ProxyPage = () => {
  const { data } = useSWR("getProxies", services.getProxies);
  const { groups = [] } = data ?? {};

  return (
    <Box sx={{ width: 0.9, maxWidth: "850px", mx: "auto", mb: 2 }}>
      <Typography variant="h4" component="h1" sx={{ py: 2 }}>
        Proxy Groups
      </Typography>

      {groups.length > 0 && (
        <List sx={{ borderRadius: 1, boxShadow: 2 }}>
          {groups.map((group) => (
            <ProxyGroup key={group.name} group={group} />
          ))}
        </List>
      )}
    </Box>
  );
};

export default ProxyPage;
