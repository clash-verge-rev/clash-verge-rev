export default function isAsyncFunction(fn: (...args: any[]) => any): boolean {
  return fn.constructor.name === "AsyncFunction";
}
