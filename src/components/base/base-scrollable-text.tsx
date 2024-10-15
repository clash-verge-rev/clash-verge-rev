import { motion } from "framer-motion";
import { ReactNode, useEffect, useRef, useState } from "react";

interface ScrollingTextProps {
  children: ReactNode;
  speed?: number;
}

export const ScrollableText = ({
  children,
  speed = 50,
}: ScrollingTextProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [textWidth, setTextWidth] = useState(0);
  const [shouldScroll, setShouldScroll] = useState(false);
  const [firstDisplay, setFirstDisplay] = useState(true);

  useEffect(() => {
    if (!firstDisplay) {
      setFirstDisplay(true);
    }
    const updateWidths = () => {
      if (containerRef.current && textRef.current) {
        const containerWidth = containerRef.current.offsetWidth;
        const textWidth = textRef.current.offsetWidth;
        setContainerWidth(containerWidth);
        setTextWidth(textWidth);
        setShouldScroll(textWidth > containerWidth);
      }
    };

    updateWidths();
    window.addEventListener("resize", updateWidths);

    return () => window.removeEventListener("resize", updateWidths);
  }, [children]);

  const duration = firstDisplay
    ? textWidth / speed
    : (textWidth + containerWidth) / speed;

  return (
    <div className="relative w-full overflow-hidden">
      <div
        ref={containerRef}
        className="relative overflow-hidden whitespace-nowrap">
        <motion.div
          ref={textRef}
          className={"inline-block"}
          animate={{
            x: shouldScroll
              ? [firstDisplay ? 0 : containerWidth, -textWidth]
              : [0, 0],
          }}
          transition={{
            duration: duration,
            ease: "linear",
            repeat: shouldScroll ? Infinity : 0,
            delay: firstDisplay ? 1 : 0,
          }}
          onUpdate={(v) => {
            if (
              firstDisplay &&
              textWidth !== 0 &&
              (v["x"] as number) <= -textWidth + 5
            ) {
              setFirstDisplay(false);
            }
          }}
          onAnimationComplete={(definition) => {}}>
          {children}
        </motion.div>
      </div>
    </div>
  );
};
