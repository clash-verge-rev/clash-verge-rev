function main(params) {
  if (params.mode === "script") {
    params.mode = "rule";
  }
  return params;
}
