import { cloneElement, isValidElement, ReactNode, useRef } from "react";
import noop from "../../utils/noop";

interface Props<Value> {
  value?: Value;
  valueProps?: string;
  onChangeProps?: string;
  onChange?: (value: Value) => void;
  onFormat?: (...args: any[]) => Value;
  onGuard?: (value: Value) => Promise<void>;
  onCatch?: (error: Error) => void;
  children: ReactNode;
}

function GuardState<T>(props: Props<T>) {
  const {
    value,
    children,
    valueProps = "value",
    onChangeProps = "onChange",
    onGuard = noop,
    onCatch = noop,
    onChange = noop,
    onFormat = (v: T) => v,
  } = props;

  const lockRef = useRef(false);

  if (isValidElement(children)) {
    const childProps = { ...children.props };

    childProps[valueProps] = value;
    childProps[onChangeProps] = async (...args: any[]) => {
      // 多次操作无效
      if (lockRef.current) return;

      lockRef.current = true;
      const oldValue = value;

      try {
        const newValue = (onFormat as any)(...args);
        // 先在ui上响应操作
        onChange(newValue);
        await onGuard(newValue);
      } catch (err: any) {
        // 状态回退
        onChange(oldValue!);
        onCatch(err);
      }
      lockRef.current = false;
    };
    return cloneElement(children, childProps);
  }

  return children as any;
}

export default GuardState;
