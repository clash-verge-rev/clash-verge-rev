const UNITS = ["B", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"];

const parseTraffic = (num?: number) => {
  if (typeof num !== "number") return ["NaN", ""];
  const exp =
    num < 1 ? 0 : Math.min(Math.floor(Math.log2(num) / 10), UNITS.length - 1);
  const dat = num / Math.pow(1024, exp);
  const ret = dat >= 1000 ? dat.toFixed(0) : dat.toPrecision(3);
  const unit = UNITS[exp];

  return [ret, unit];
};

export default parseTraffic;
