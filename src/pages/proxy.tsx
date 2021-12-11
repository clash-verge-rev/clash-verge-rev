import { useEffect, useState } from "react";
import { Box, List, Typography } from "@mui/material";
import services from "../services";
import ProxyGroup from "../components/proxy-group";
import type { ProxyGroupItem } from "../services/proxy";

const ProxyPage = () => {
  const [groups, setGroups] = useState<ProxyGroupItem[]>([]);

  useEffect(() => {
    // Todo
    // result cache
    services.getProxyInfo().then((res) => {
      setGroups(res.groups);
    });
  }, []);

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
