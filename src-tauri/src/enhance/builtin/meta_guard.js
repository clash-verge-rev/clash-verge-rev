function main(config) {
  if (config.mode === "script") {
    config.mode = "rule";
  }
  return config;
}
