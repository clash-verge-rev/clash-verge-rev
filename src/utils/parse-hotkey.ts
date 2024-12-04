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
  // 数字键映射
  "1": "Digit1",
  "2": "Digit2",
  "3": "Digit3",
  "4": "Digit4",
  "5": "Digit5",
  "6": "Digit6",
  "7": "Digit7",
  "8": "Digit8",
  "9": "Digit9",
  "0": "Digit0",
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

  // 处理特殊符号到键位的映射
  switch (temp) {
    // 数字键符号
    case "!":
      return "DIGIT1"; // shift + 1
    case "@":
      return "DIGIT2"; // shift + 2
    case "#":
      return "DIGIT3"; // shift + 3
    case "$":
      return "DIGIT4"; // shift + 4
    case "%":
      return "DIGIT5"; // shift + 5
    case "^":
      return "DIGIT6"; // shift + 6
    case "&":
      return "DIGIT7"; // shift + 7
    case "*":
      return "DIGIT8"; // shift + 8
    case "(":
      return "DIGIT9"; // shift + 9
    case ")":
      return "DIGIT0"; // shift + 0
    // 其他特殊符号
    case "?":
      return "SLASH"; // shift + /
    case ":":
      return "SEMICOLON"; // shift + ;
    case "+":
      return "EQUAL"; // shift + =
    case "_":
      return "MINUS"; // shift + -
    case '"':
      return "QUOTE"; // shift + '
    case "<":
      return "COMMA"; // shift + ,
    case ">":
      return "PERIOD"; // shift + .
    case "{":
      return "BRACKETLEFT"; // shift + [
    case "}":
      return "BRACKETRIGHT"; // shift + ]
    case "|":
      return "BACKSLASH"; // shift + \
  }

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
