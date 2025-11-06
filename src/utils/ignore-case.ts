type TData = Record<string, any>;

function deepClone(value: any): any {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    const cloned = new Array(value.length);
    for (let i = 0; i < value.length; i++) {
      cloned[i] = deepClone(value[i]);
    }
    return cloned;
  }
  if (value instanceof Date) {
    return new Date(value.getTime());
  }
  const cloned: any = {};
  for (const key in value) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      cloned[key] = deepClone(value[key]);
    }
  }
  return cloned;
}

export default function ignoreCase(data: TData): TData {
  if (!data) return {};

  const newData = {} as TData;
  const keys = Object.keys(data);
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    newData[key.toLowerCase()] = deepClone(data[key]);
  }

  return newData;
}
