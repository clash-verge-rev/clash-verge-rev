/**
 * parse the traffic to
 * xxx B
 * xxx KB
 * xxx MB
 * xxx GB
 */
const parseTraffic = (num: number) => {
  const gb = 1024 ** 3;
  const mb = 1024 ** 2;
  const kb = 1024;
  let t = num;
  let u = "B";

  if (num < 1000) return [`${Math.round(t)}`, "B"];
  if (num <= mb) {
    t = num / kb;
    u = "KB";
  } else if (num <= gb) {
    t = num / mb;
    u = "MB";
  } else {
    t = num / gb;
    u = "GB";
  }
  if (t >= 100) return [`${Math.round(t)}`, u];
  return [`${Math.round(t * 10) / 10}`, u];
};

export default parseTraffic;
