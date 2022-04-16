import { useEffect, useRef } from "react";
import { useTheme } from "@mui/material";

const maxPoint = 30;

const refLineAlpha = 1;
const refLineWidth = 2;

const upLineAlpha = 0.6;
const upLineWidth = 4;

const downLineAlpha = 1;
const downLineWidth = 4;

const duration = 16 / 1000;
const defaultList = Array(maxPoint + 1).fill({ up: 0, down: 0 });

type TrafficData = { up: number; down: number };

interface Props {
  instance: React.MutableRefObject<{
    appendData: (data: TrafficData) => void;
    toggleStyle: () => void;
  }>;
}

/**
 * draw the traffic graph
 */
const TrafficGraph = (props: Props) => {
  const { instance } = props;

  const countRef = useRef(0);
  const styleRef = useRef(true);
  const listRef = useRef<TrafficData[]>(defaultList);
  const canvasRef = useRef<HTMLCanvasElement>(null!);

  const { palette } = useTheme();

  useEffect(() => {
    let timer: any;
    let cache: TrafficData | null = null;
    const zero = { up: 0, down: 0 };

    const handleData = () => {
      const data = cache ? cache : zero;
      cache = null;

      const list = listRef.current;
      if (list.length > maxPoint + 1) list.shift();
      list.push(data);
      countRef.current = 0;

      timer = setTimeout(handleData, 1000);
    };

    instance.current = {
      appendData: (data: TrafficData) => {
        cache = data;
      },
      toggleStyle: () => {
        styleRef.current = !styleRef.current;
      },
    };

    handleData();

    return () => {
      instance.current = null!;
      if (timer) clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    let raf = 0;
    const canvas = canvasRef.current!;

    if (!canvas) return;

    const context = canvas.getContext("2d")!;

    if (!context) return;

    const { primary, secondary, divider } = palette;
    const refLineColor = divider || "rgba(0, 0, 0, 0.12)";
    const upLineColor = secondary.main || "#9c27b0";
    const downLineColor = primary.main || "#5b5c9d";

    const width = canvas.width;
    const height = canvas.height;
    const dx = width / maxPoint;
    const dy = height / 7;
    const l1 = dy;
    const l2 = dy * 4;

    const countY = (v: number) => {
      const h = height;

      if (v == 0) return h - 1;
      if (v <= 10) return h - (v / 10) * dy;
      if (v <= 100) return h - (v / 100 + 1) * dy;
      if (v <= 1024) return h - (v / 1024 + 2) * dy;
      if (v <= 10240) return h - (v / 10240 + 3) * dy;
      if (v <= 102400) return h - (v / 102400 + 4) * dy;
      if (v <= 1048576) return h - (v / 1048576 + 5) * dy;
      if (v <= 10485760) return h - (v / 10485760 + 6) * dy;
      return 1;
    };

    const drawBezier = (list: number[]) => {
      const count = countRef.current;
      const offset = Math.min(1, count * duration);
      const offsetX = dx * offset;

      let lx = 0;
      let ly = height;
      let llx = 0;
      let lly = height;

      list.forEach((val, index) => {
        const x = (dx * index - offsetX) | 0;
        const y = countY(val);
        const s = 0.25;

        if (index === 0) context.moveTo(x, y);
        else {
          let nx = (dx * (index + 1)) | 0;
          let ny = index < maxPoint - 1 ? countY(list[index + 1]) | 0 : 0;
          const ax = (lx + (x - llx) * s) | 0;
          const ay = (ly + (y - lly) * s) | 0;
          const bx = (x - (nx - lx) * s) | 0;
          const by = (y - (ny - ly) * s) | 0;
          context.bezierCurveTo(ax, ay, bx, by, x, y);
        }

        llx = lx;
        lly = ly;
        lx = x;
        ly = y;
      });
    };

    const drawLine = (list: number[]) => {
      const count = countRef.current;
      const offset = Math.min(1, count * duration);
      const offsetX = dx * offset;

      list.forEach((val, index) => {
        const x = (dx * index - offsetX) | 0;
        const y = countY(val);

        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      });
    };

    const drawGraph = () => {
      context.clearRect(0, 0, width, height);

      // Reference lines
      context.beginPath();
      context.globalAlpha = refLineAlpha;
      context.lineWidth = refLineWidth;
      context.strokeStyle = refLineColor;
      context.moveTo(0, l1);
      context.lineTo(width, l1);
      context.moveTo(0, l2);
      context.lineTo(width, l2);
      context.stroke();
      context.closePath();

      const listUp = listRef.current.map((v) => v.up);
      const listDown = listRef.current.map((v) => v.down);
      const lineStyle = styleRef.current;

      context.beginPath();
      context.globalAlpha = upLineAlpha;
      context.lineWidth = upLineWidth;
      context.strokeStyle = upLineColor;
      lineStyle ? drawLine(listUp) : drawBezier(listUp);
      context.stroke();
      context.closePath();

      context.beginPath();
      context.globalAlpha = downLineAlpha;
      context.lineWidth = downLineWidth;
      context.strokeStyle = downLineColor;
      lineStyle ? drawLine(listDown) : drawBezier(listDown);
      context.stroke();
      context.closePath();

      countRef.current += 1;

      raf = requestAnimationFrame(drawGraph);
    };

    drawGraph();

    return () => {
      cancelAnimationFrame(raf);
    };
  }, [palette]);

  return <canvas ref={canvasRef} style={{ width: "100%", height: "100%" }} />;
};

export default TrafficGraph;
