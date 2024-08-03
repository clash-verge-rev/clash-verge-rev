function main(config, _name) {
  if (config.mode === "script") {
    config.mode = "rule";
  }
  return config;
}
