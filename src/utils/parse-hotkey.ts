const parseHotkey = (key: string) => {
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
      return temp;
  }
};

export default parseHotkey;
