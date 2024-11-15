const KEY_MAP: Record<string, string> = {
  // 特殊字符映射
  "-": "Minus",
  "=": "Equal",
  "[": "BracketLeft",
  "]": "BracketRight",
  "\\": "Backslash",
  ";": "Semicolon",
  "'": "Quote",
  ",": "Comma",
  ".": "Period",
  "/": "Slash",
  // Option + 特殊字符映射
  "–": "Minus", // Option + -
  "≠": "Equal", // Option + =
  "\u201C": "BracketLeft", // Option + [
  "\u2019": "BracketRight", // Option + ]
  "«": "Backslash", // Option + \
  "…": "Semicolon", // Option + ;
  æ: "Quote", // Option + '
  "≤": "Comma", // Option + ,
  "≥": "Period", // Option + .
  "÷": "Slash", // Option + /

  // Option组合键映射
  Å: "A",
  "∫": "B",
  Ç: "C",
  "∂": "D",
  "´": "E",
  ƒ: "F",
  "©": "G",
  "˙": "H",
  ˆ: "I",
  "∆": "J",
  "˚": "K",
  "¬": "L",
  µ: "M",
  "˜": "N",
  Ø: "O",
  π: "P",
  Œ: "Q",
  "®": "R",
  ß: "S",
  "†": "T",
  "¨": "U",
  "√": "V",
  "∑": "W",
  "≈": "X",
  "¥": "Y",
  Ω: "Z",
};

const mapKeyCombination = (key: string): string => {
  const mappedKey = KEY_MAP[key] || key;
  return `${mappedKey}`;
};
export const parseHotkey = (key: string) => {
  let temp = key.toUpperCase();
  console.log(temp);

  if (temp.startsWith("ARROW")) {
    temp = temp.slice(5);
  } else if (temp.startsWith("DIGIT")) {
    temp = temp.slice(5);
  } else if (temp.startsWith("KEY")) {
    temp = temp.slice(3);
  } else if (temp.endsWith("LEFT")) {
    temp = temp.slice(0, -4);
  } else if (temp.endsWith("RIGHT")) {
    temp = temp.slice(0, -5);
  }
  console.log(temp, mapKeyCombination(temp));

  switch (temp) {
    case "CONTROL":
      return "CTRL";
    case "META":
      return "CMD";
    case " ":
      return "SPACE";
    default:
      return KEY_MAP[temp] || temp;
  }
};
