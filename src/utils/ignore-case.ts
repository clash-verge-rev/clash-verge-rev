// Deep copy and change all keys to lowercase
type TData = Record<string, any>;

export default function ignoreCase(data: TData): TData {
  if (!data) return {};

  const newData = {} as TData;

  Object.entries(data).forEach(([key, value]) => {
    newData[key.toLowerCase()] = JSON.parse(JSON.stringify(value));
  });

  return newData;
}
