export default function isAsyncFunction(
  fn: () => void | Promise<any>,
): boolean {
  return fn.constructor.name === "AsyncFunction";
}
