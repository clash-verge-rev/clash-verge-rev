import { createElement, isValidElement, ReactNode, useRef } from "react";

import noop from "@/utils/noop";

interface Props<Value> {
  value?: Value;
  valueProps?: string;
  onChangeProps?: string;
  waitTime?: number;
  onChange?: (value: Value) => void;
  onFormat?: (...args: any[]) => Value;
  onGuard?: (value: Value, oldValue: Value) => Promise<void>;
  onCatch?: (error: Error) => void;
  children: ReactNode;
}

export function GuardState<T>(props: Props<T>) {
  const {
    value,
    children,
    valueProps = "value",
    onChangeProps = "onChange",
    waitTime = 0, // debounce wait time default 0
    onGuard = noop,
    onCatch = noop,
    onChange = noop,
    onFormat,
  } = props;

  const lockRef = useRef(false);
  const saveRef = useRef(value);
  const lastRef = useRef(0);
  const timeRef = useRef<any>(undefined);

  if (!isValidElement(children)) {
    return children as any;
  }

  const childProps = { ...(children.props as Record<string, any>) };

  childProps[valueProps] = value;
  childProps[onChangeProps] = async (...args: any[]) => {
    // 多次操作无效
    if (lockRef.current) return;
    lockRef.current = true;

    try {
      const newValue = onFormat ? (onFormat as any)(...args) : (args[0] as T);
      // 先在ui上响应操作
      onChange(newValue);

      const now = Date.now();

      // save the old value
      if (waitTime <= 0 || now - lastRef.current >= waitTime) {
        saveRef.current = value;
      }

      lastRef.current = now;

      if (waitTime <= 0) {
        await onGuard(newValue, value!);
        lockRef.current = false;
      } else {
        // debounce guard
        clearTimeout(timeRef.current);

        timeRef.current = setTimeout(async () => {
          try {
            await onGuard(newValue, saveRef.current!);
          } catch (err: any) {
            // 状态回退
            onChange(saveRef.current!);
            onCatch(err);
          } finally {
            lockRef.current = false;
          }
        }, waitTime);
      }
    } catch (err: any) {
      // 状态回退
      onChange(saveRef.current!);
      onCatch(err);
      lockRef.current = false;
    }
  };
  const { children: nestedChildren, ...restProps } = childProps;

  return createElement(children.type, restProps, nestedChildren);
}
