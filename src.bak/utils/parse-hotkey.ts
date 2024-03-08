const KEY_MAP: Record<string, string> = {
  '"': "'",
  ":": ";",
  "?": "/",
  ">": ".",
  "<": ",",
  "{": "[",
  "}": "]",
  "|": "\\",
  "!": "1",
  "@": "2",
  "#": "3",
  $: "4",
  "%": "5",
  "^": "6",
  "&": "7",
  "*": "8",
  "(": "9",
  ")": "0",
  "~": "`",
};

export const parseHotkey = (key: string) => {
  let temp = key.toUpperCase();

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
