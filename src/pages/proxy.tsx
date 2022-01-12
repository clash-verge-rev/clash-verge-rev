import useSWR, { useSWRConfig } from "swr";
import { useEffect } from "react";
import { Box, List, Paper, Typography } from "@mui/material";
import { getProxies } from "../services/api";
import ProxyGroup from "../components/proxy-group";
import ProxyItem from "../components/proxy-item";

const ProxyPage = () => {
  const { mutate } = useSWRConfig();
  const { data: proxiesData } = useSWR("getProxies", getProxies);
  const { groups = [], proxies = [] } = proxiesData ?? {};

  useEffect(() => {
    // fix the empty proxies on the first sight
    // this bud only show on the build version
    // call twice to avoid something unknown or the delay of the clash startup
    setTimeout(() => mutate("getProxies"), 250);
    setTimeout(() => mutate("getProxies"), 1000);
  }, []);

  return (
    <Box sx={{ width: 0.9, maxWidth: "850px", mx: "auto", mb: 2 }}>
      <Typography variant="h4" component="h1" sx={{ py: 2 }}>
        {groups.length ? "Proxy Groups" : "Proxies"}
      </Typography>

      <Paper sx={{ borderRadius: 1, boxShadow: 2 }}>
        {groups.length > 0 && (
          <List>
            {groups.map((group) => (
              <ProxyGroup key={group.name} group={group} />
            ))}
          </List>
        )}

        {!groups.length && (
          <List>
            {Object.values(proxies).map((proxy) => (
              <ProxyItem
                key={proxy.name}
                proxy={proxy}
                selected={false}
                sx={{ py: 0, px: 2 }}
              />
            ))}
          </List>
        )}
      </Paper>
    </Box>
  );
};

export default ProxyPage;
