// Shallow copy and change all keys to lowercase
type TData = Record<string, any>;

export default function ignoreCase(data: TData): TData {
  if (!data) return data;

  const newData = {} as TData;

  Object.keys(data).forEach((key) => {
    newData[key.toLowerCase()] = data[key];
  });

  return newData;
}
