const UNITS = ["B", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"];

const parseTraffic = (num: number) => {
  if (num < 1000) return [`${Math.round(num)}`, "B"];
  const exp = Math.min(Math.floor(Math.log10(num) / 3), UNITS.length - 1);
  const ret = (num / Math.pow(1000, exp)).toPrecision(3);
  const unit = UNITS[exp];

  return [ret, unit];
};

export default parseTraffic;
