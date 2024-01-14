import { GridComparatorFn } from "@mui/x-data-grid";

const UNITS = ["B", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"];
const unitMap = new Map<string, number>();
unitMap.set("分钟前", 60);
unitMap.set("小时前", 60 * 60);
unitMap.set("天前", 60 * 60 * 24);
unitMap.set("个月前", 60 * 60 * 24 * 30);
unitMap.set("年前", 60 * 60 * 24 * 30 * 12);

export const sortWithUnit: GridComparatorFn<string> = (v1, v2) => {
  const [ret1, unit1] = v1.split(" ");
  const [ret2, unit2] = v2.split(" ");
  let value1 =
    parseFloat(ret1) *
    Math.pow(1024, UNITS.indexOf(unit1.replace("/s", "").trim()));
  let value2 =
    parseFloat(ret2) *
    Math.pow(1024, UNITS.indexOf(unit2.replace("/s", "").trim()));
  return value1 - value2;
};

export const sortStringTime: GridComparatorFn<string> = (v1, v2) => {
  if (v1 === "几秒前") {
    return -1;
  }
  if (v2 === "几秒前") {
    return 1;
  }

  const matches1 = v1.match(/[0-9]+/);
  const num1 = matches1 !== null ? parseInt(matches1[0]) : 0;
  const matches2 = v2.match(/[0-9]+/);
  const num2 = matches2 !== null ? parseInt(matches2[0]) : 0;
  const unit1 = unitMap.get(v1.replace(num1.toString(), "").trim()) || 0;
  const unit2 = unitMap.get(v2.replace(num2.toString(), "").trim()) || 0;
  return num1 * unit1 - num2 * unit2;
};
