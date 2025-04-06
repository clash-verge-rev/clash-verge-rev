import { cn } from "@/utils";
import { debounce } from "lodash-es";
import React, {
  ComponentPropsWithoutRef,
  useEffect,
  useRef,
  useState,
} from "react";

// ref https://github.com/magicuidesign/magicui/blob/main/registry/magicui/marquee.tsx
// modified from MagicUI Marquee component.

interface MarqueeProps extends ComponentPropsWithoutRef<"div"> {
  /**
   * Optional CSS class name to apply custom styles
   */
  className?: string;
  /**
   * Whether to reverse the animation direction
   * @default false
   */
  reverse?: boolean;
  /**
   * Whether to pause the animation on hover
   * @default false
   */
  pauseOnHover?: boolean;
  /**
   * Content to be displayed in the marquee
   */
  children: React.ReactNode;
  /**
   * Whether to animate vertically instead of horizontally
   * @default false
   */
  vertical?: boolean;
  /**
   * Number of times to repeat the content
   * @default 4
   */
  repeat?: number;
}

export function Marquee({
  className,
  reverse = false,
  pauseOnHover = false,
  children,
  vertical = false,
  repeat = 4,
  ...props
}: MarqueeProps) {
  const [applyAnimation, setApplyAnimation] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const childrenRef = useRef<HTMLDivElement>(null);
  const firstRender = useRef(true);

  useEffect(() => {
    const calcApplyAnimation = () => {
      if (!containerRef.current) return;
      if (!childrenRef.current && !firstRender.current) {
        // 如果该组件已经应用了动画，并且不是第一次渲染，而且 children 已经改动，需要取消动画，重新计算是否需要应用动画
        setApplyAnimation(false);
        return;
      }
      if (!childrenRef.current) return;
      // 首次初始化，判断是否需要应用动画
      const childrenWidth = childrenRef.current.offsetWidth;
      const containerWidth = containerRef.current.offsetWidth;
      if (childrenWidth >= containerWidth) {
        const duration = (childrenWidth * repeat) / containerWidth;
        document.documentElement.style.setProperty(
          "--duration",
          `${duration}s`,
        );
        setApplyAnimation(true);
      }
    };

    calcApplyAnimation();
    firstRender.current = false;
    // 监听窗口尺寸变化
    const handleResize = debounce(calcApplyAnimation, 300);
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, [children]);

  // 重新计算宽度
  useEffect(() => {
    if (!childrenRef.current || !containerRef.current) return;

    // 排除应用动画的情况, 仅在后续渲染中, 需要重新计算判断是否应用动画的情况
    if (applyAnimation && !firstRender.current) return;
    const childrenWidth = childrenRef.current.offsetWidth;
    const containerWidth = containerRef.current.offsetWidth;
    if (childrenWidth >= containerWidth) {
      const duration = (childrenWidth * repeat) / containerWidth;
      document.documentElement.style.setProperty("--duration", `${duration}s`);
      if (!applyAnimation) {
        setApplyAnimation(true);
      }
    }
  }, [applyAnimation]);

  return (
    <div
      ref={containerRef}
      {...props}
      className={cn(
        "group flex [gap:var(--gap)] overflow-hidden p-2 [--duration:5s] [--gap:1rem]",
        {
          "flex-row": !vertical,
          "flex-col": vertical,
        },
        className,
      )}>
      {!applyAnimation ? (
        <div ref={childrenRef} className="flex shrink-0">
          {children}
        </div>
      ) : (
        Array(repeat)
          .fill(0)
          .map((_, i) => (
            <div
              key={i}
              className={cn("flex shrink-0 justify-around [gap:var(--gap)]", {
                "animate-marquee flex-row": !vertical,
                "animate-marquee-vertical flex-col": vertical,
                "group-hover:[animation-play-state:paused]": pauseOnHover,
                "[animation-direction:reverse]": reverse,
              })}>
              {children}
            </div>
          ))
      )}
    </div>
  );
}
