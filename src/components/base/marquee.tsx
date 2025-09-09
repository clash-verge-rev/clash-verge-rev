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

  /**
   * Number of pixels to scroll per second
   * @default 30
   */
  speed?: number;
}

export function Marquee({
  className,
  reverse = false,
  pauseOnHover = false,
  children,
  vertical = false,
  repeat = 4,
  speed = 30,
  ...props
}: MarqueeProps) {
  const [applyAnimation, setApplyAnimation] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const childrenRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current || !childrenRef.current) return;

    const container = containerRef.current;
    const child = childrenRef.current;

    const calcAnimation = () => {
      const childrenSize = vertical ? child.offsetHeight : child.offsetWidth;
      const containerSize = vertical
        ? container.offsetHeight
        : container.offsetWidth;

      const needAnimation = childrenSize >= containerSize + 5;
      if (needAnimation) {
        const duration = childrenSize / speed;
        document.documentElement.style.setProperty(
          "--duration",
          `${duration}s`,
        );
      }
      // 只有结果不同才更新，避免闪烁
      if (applyAnimation !== needAnimation) {
        setApplyAnimation(needAnimation);
      }
    };

    // 防抖包装
    const updateAnimation = debounce(calcAnimation, 200);

    // 用 ResizeObserver 来监听尺寸变化
    const resizeObserver = new ResizeObserver(updateAnimation);
    resizeObserver.observe(container);

    // 监听 DOM 内容变化
    const mutationObserver = new MutationObserver(updateAnimation);
    mutationObserver.observe(container, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    // 初始化时手动跑一次
    updateAnimation();

    return () => {
      resizeObserver.disconnect();
      mutationObserver.disconnect();
    };
  }, [vertical, repeat, applyAnimation]);

  return (
    <div
      ref={containerRef}
      {...props}
      className={cn(
        "group flex w-full [gap:var(--gap)] overflow-hidden [--duration:5s] [--gap:1rem]",
        vertical ? "flex-col" : "flex-row",
        className,
      )}>
      {!applyAnimation ? (
        <div ref={childrenRef} className="flex shrink-0">
          {children}
        </div>
      ) : (
        Array.from({ length: repeat }).map((_, i) => (
          <div
            key={i}
            ref={i === 0 ? childrenRef : undefined}
            className={cn(
              "flex shrink-0 justify-around [gap:var(--gap)]",
              vertical
                ? "animate-marquee-vertical flex-col"
                : "animate-marquee flex-row",
              {
                "group-hover:[animation-play-state:paused]": pauseOnHover,
                "[animation-direction:reverse]": reverse,
              },
            )}>
            {children}
          </div>
        ))
      )}
    </div>
  );
}
