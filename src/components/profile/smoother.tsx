import { useEffect, useRef } from "react";

export const Smoother: React.FC = ({ children }) => {
  const self = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (typeof window.getComputedStyle == "undefined") return;
    const element = self.current;
    if (!element) return;
    var height = window.getComputedStyle(element).height;
    element.style.transition = "none";
    element.style.height = "auto";
    var targetHeight = window.getComputedStyle(element).height;
    element.style.height = height;

    setTimeout(() => {
      element.style.transition = "height .5s";
      element.style.height = targetHeight;
    }, 0);
  });
  return (
    <div
      ref={self}
      style={{
        overflowY: "hidden",
      }}
    >
      {children}
    </div>
  );
};
