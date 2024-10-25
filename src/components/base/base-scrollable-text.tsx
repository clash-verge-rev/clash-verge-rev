import { motion } from "framer-motion";
import { ReactNode, useEffect, useRef, useState } from "react";

interface ScrollingTextProps {
  children: ReactNode;
  speed?: number;
}

export const ScrollableText = ({
  children,
  speed = 30,
}: ScrollingTextProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const initTextRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);

  const [loopNum, setLoopNum] = useState(1);
  const [containerWidth, setContainerWidth] = useState(0);
  const [textWidth, setTextWidth] = useState(0);
  const [shouldScroll, setShouldScroll] = useState(false);

  useEffect(() => {
    const updateWidths = () => {
      if (initTextRef.current && containerRef.current) {
        const containerWidth = containerRef.current.offsetWidth;
        const initTextWidth = initTextRef.current.offsetWidth;
        const shouldScroll = initTextWidth > containerWidth;
        setShouldScroll(shouldScroll);
      }
      if (containerRef.current && textRef.current) {
        const containerWidth = containerRef.current.offsetWidth;
        const textWidth = textRef.current.offsetWidth;
        setContainerWidth(containerWidth);
        setTextWidth(textWidth);
        const shouldScroll = textWidth > containerWidth;
        setShouldScroll(shouldScroll);
        if (shouldScroll) {
          const repeats = Math.ceil(containerWidth / textWidth) + 1;
          setLoopNum(repeats);
        } else {
          setLoopNum(1);
        }
      }
    };

    updateWidths();
    window.addEventListener("resize", updateWidths);

    return () => window.removeEventListener("resize", updateWidths);
  }, [children, shouldScroll]);

  return (
    <div className="relative w-full overflow-hidden">
      <div
        ref={containerRef}
        className="relative overflow-hidden whitespace-nowrap">
        <motion.div
          className={"inline-block"}
          animate={{
            x: shouldScroll ? [0, -textWidth] : [0, 0],
          }}
          transition={{
            duration: shouldScroll ? textWidth / speed : 0,
            ease: "linear",
            repeat: shouldScroll ? Infinity : 0,
            delay: 1,
          }}>
          {shouldScroll ? (
            [...Array(loopNum)].map((_, index) => (
              <div ref={textRef} key={index} className="inline-block pr-10">
                {children}
              </div>
            ))
          ) : (
            <div ref={initTextRef} className="inline-block">
              {children}
            </div>
          )}
        </motion.div>
      </div>
    </div>
  );
};
