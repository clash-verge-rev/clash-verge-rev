// This function is exported for use by the Clash core
// eslint-disable-next-line no-unused-vars
function main(config, _name) {
  if (config.mode === "script") {
    config.mode = "rule";
  }
  return config;
}
