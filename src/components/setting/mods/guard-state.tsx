import { sleep } from "@/utils";
import noop from "@/utils/noop";
import {
  cloneElement,
  isValidElement,
  ReactNode,
  useRef,
  useState,
} from "react";

interface Props<Value> {
  value?: Value;
  valueProps?: string;
  onChangeProps?: string;
  waitTime?: number;
  onChange?: (value: Value) => void;
  onFormat?: (...args: any[]) => Value;
  onGuard?: (value: Value, oldValue: Value) => Promise<void>;
  onSuccess?: (value: Value) => void;
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
    onSuccess = noop,
    onCatch = noop,
    onChange = noop,
    onFormat = (v: T) => v,
  } = props;

  const lockRef = useRef(false);
  const saveRef = useRef(value);
  const lastRef = useRef(0);
  const timeRef = useRef<any>();
  const [busy, setBusy] = useState(false);
  const showChildrenBusy = onChange === noop;

  if (!isValidElement(children)) {
    return children as any;
  }

  const childProps = { ...children.props };

  childProps[valueProps] = value;
  childProps["aria-busy"] = busy;
  childProps[onChangeProps] = async (...args: any[]) => {
    // 多次操作无效
    if (lockRef.current) return;

    lockRef.current = true;

    try {
      const newValue = (onFormat as any)(...args);
      // 先在ui上响应操作
      onChange(newValue);

      const now = Date.now();

      // save the old value
      if (waitTime <= 0 || now - lastRef.current >= waitTime) {
        saveRef.current = value;
      }

      lastRef.current = now;
      const guradRetry = async (newValue: any, oldValue: any, retry = 5) => {
        try {
          setBusy(true);
          await onGuard(newValue, oldValue);
          setBusy(false);
        } catch (err: any) {
          if (retry > 0) {
            await sleep(1000);
            await guradRetry(newValue, oldValue, retry - 1);
          } else {
            setBusy(false);
            throw err;
          }
        }
      };

      if (waitTime <= 0) {
        if (showChildrenBusy) {
          await guradRetry(newValue, value!);
        } else {
          await onGuard(newValue, value!);
        }
        onSuccess(newValue);
      } else {
        // debounce guard
        clearTimeout(timeRef.current);

        timeRef.current = setTimeout(async () => {
          try {
            if (showChildrenBusy) {
              await guradRetry(newValue, saveRef.current!);
            } else {
              await onGuard(newValue, saveRef.current!);
            }
            onSuccess(newValue);
          } catch (err: any) {
            // 状态回退
            onChange(saveRef.current!);
            onCatch(err);
          } finally {
            setBusy(false);
          }
        }, waitTime);
      }
    } catch (err: any) {
      // 状态回退
      onChange(saveRef.current!);
      onCatch(err);
    } finally {
      setBusy(false);
    }
    lockRef.current = false;
  };
  return cloneElement(children, childProps);
}
