import connections from "./connections.json";
import home from "./home.json";
import layout from "./layout.json";
import logs from "./logs.json";
import profiles from "./profiles.json";
import proxies from "./proxies.json";
import rules from "./rules.json";
import settings from "./settings.json";
import shared from "./shared.json";
import tests from "./tests.json";
import unlock from "./unlock.json";

const resources = {
  shared: shared,
  profiles: profiles,
  proxies: proxies,
  connections: connections,
  tests: tests,
  logs: logs,
  rules: rules,
  home: home,
  unlock: unlock,
  settings: settings,
  layout: layout,
};

export default resources;
