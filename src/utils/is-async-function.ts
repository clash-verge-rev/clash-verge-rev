export default function isAsyncFunction(fn: Function): boolean {
  return fn[Symbol.toStringTag] === "AsyncFunction";
}
