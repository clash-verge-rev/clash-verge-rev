import { cn } from "@/utils";
import { motion, useAnimationControls } from "framer-motion";
import { debounce } from "lodash-es";
import React, { useEffect, useRef } from "react";

interface ScrollableTextProps {
  className?: string;
  children: React.ReactNode;
}

export const ScrollableText = (props: ScrollableTextProps) => {
  const { className, children } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const controls = useAnimationControls();

  const animate = async () => {
    if (!containerRef.current || !textRef.current) return;
    const textWidth = textRef.current.offsetWidth;
    const containerWidth = containerRef.current.offsetWidth;
    const calcScrollLength = -textWidth + containerWidth - 30;
    if (textWidth > containerWidth) {
      await controls.start({
        x: [0, calcScrollLength],
        transition: {
          duration: textWidth / 50, // Adjust speed here
          ease: "linear",
        },
      });
    }
    await controls.start({
      x: [0, 0],
      transition: {
        duration: 0,
        ease: "linear",
      },
    });
    let innerTimeoutId;
    if (textWidth > containerWidth) {
      innerTimeoutId = setTimeout(() => {
        animate();
      }, 1000);
    } else {
      clearTimeout(innerTimeoutId);
      controls.stop();
    }
  };

  useEffect(() => {
    if (textRef.current && containerRef.current) {
      const textWidth = textRef.current.offsetWidth;
      const containerWidth = containerRef.current.offsetWidth;
      let timeoutId;
      if (textWidth > containerWidth) {
        timeoutId = setTimeout(() => {
          animate();
        }, 1000);
      } else {
        clearTimeout(timeoutId);
        controls.stop();
      }
    }
  }, [controls, children]);

  useEffect(() => {
    const debouncedResize = debounce(animate, 200);
    document.addEventListener("resize", debouncedResize);

    return () => {
      document.removeEventListener("resize", debouncedResize);
    };
  }, []);

  return (
    <div
      className={cn(
        "flex h-full min-h-6 select-text items-center justify-center",
        className,
      )}>
      <div
        ref={containerRef}
        className="relative h-full w-full overflow-hidden"
        aria-label="Scrolling text container">
        <motion.div
          ref={textRef}
          animate={controls}
          className="absolute left-0 top-0 whitespace-nowrap">
          <div>{children}</div>
        </motion.div>
        {/* <div className="absolute inset-y-0 left-0 z-10 w-8 bg-gradient-to-r from-white to-transparent"></div>
        <div className="absolute inset-y-0 right-0 z-10 w-8 bg-gradient-to-l from-white to-transparent"></div> */}
      </div>
    </div>
  );
};
