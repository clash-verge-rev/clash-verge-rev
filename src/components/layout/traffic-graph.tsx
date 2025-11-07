import { useTheme } from "@mui/material";
import { useEffect, useImperativeHandle, useRef, type Ref } from "react";
import { Traffic } from "tauri-plugin-mihomo-api";

const maxPoint = 30;

const refLineAlpha = 1;
const refLineWidth = 2;

const upLineAlpha = 0.6;
const upLineWidth = 4;

const downLineAlpha = 1;
const downLineWidth = 4;

const defaultList = Array(maxPoint + 2).fill({ up: 0, down: 0 });

export interface TrafficRef {
  appendData: (data: Traffic) => void;
  toggleStyle: () => void;
}

/**
 * draw the traffic graph
 */
export function TrafficGraph({ ref }: { ref?: Ref<TrafficRef> }) {
  const countRef = useRef(0);
  const styleRef = useRef(true);
  const listRef = useRef<Traffic[]>(defaultList);
  const canvasRef = useRef<HTMLCanvasElement>(null!);

  const cacheRef = useRef<Traffic | null>(null);

  const { palette } = useTheme();

  useImperativeHandle(ref, () => ({
    appendData: (data: Traffic) => {
      cacheRef.current = data;
    },
    toggleStyle: () => {
      styleRef.current = !styleRef.current;
    },
  }));

  useEffect(() => {
    let timer: any;
    const zero = { up: 0, down: 0 };

    const handleData = () => {
      const data = cacheRef.current ? cacheRef.current : zero;
      cacheRef.current = null;

      const list = listRef.current;
      if (list.length > maxPoint + 2) list.shift();
      list.push(data);
      countRef.current = 0;

      timer = setTimeout(handleData, 1000);
    };

    handleData();

    return () => {
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

    const drawBezier = (list: number[], offset: number, length: number) => {
      if (length === 0) return;
      const firstX = (dx * -1 - offset + 3) | 0;
      const firstY = countY(list[0]);
      context.moveTo(firstX, firstY);
      for (let i = 1; i < length; i++) {
        const p1x = (dx * (i - 1) - offset + 3) | 0;
        const p1y = countY(list[i]);
        const hasNext = i + 1 < length;
        const p2x = hasNext ? (dx * i - offset + 3) | 0 : p1x;
        const p2y = hasNext ? countY(list[i + 1]) : p1y;
        const x1 = (p1x + p2x) / 2;
        const y1 = (p1y + p2y) / 2;
        context.quadraticCurveTo(p1x, p1y, x1, y1);
      }
    };

    const drawLine = (list: number[], offset: number, length: number) => {
      if (length === 0) return;
      const startX = (dx * -1 - offset) | 0;
      const startY = countY(list[0]);
      context.moveTo(startX, startY);
      for (let i = 1; i < length; i++) {
        const x = (dx * (i - 1) - offset) | 0;
        const y = countY(list[i]);
        context.lineTo(x, y);
      }
    };

    const listUpArr: number[] = new Array(maxPoint + 2);
    const listDownArr: number[] = new Array(maxPoint + 2);

    const drawGraph = (lastTime: number) => {
      const listCurr = listRef.current;
      const len = listCurr.length;
      for (let i = 0; i < len; i++) {
        const v = listCurr[i];
        listUpArr[i] = v.up;
        listDownArr[i] = v.down;
      }
      const lineStyle = styleRef.current;

      const now = Date.now();
      const diff = now - lastTime;
      if (diff < 33) {
        raf = requestAnimationFrame(() => drawGraph(lastTime));
        return;
      }
      const temp = Math.min((diff / 1000) * dx + countRef.current, dx);
      const offset = countRef.current === 0 ? 0 : temp;
      countRef.current = temp;

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

      context.beginPath();
      context.globalAlpha = upLineAlpha;
      context.lineWidth = upLineWidth;
      context.strokeStyle = upLineColor;
      if (lineStyle) {
        drawBezier(listUpArr, offset, len);
      } else {
        drawLine(listUpArr, offset, len);
      }
      context.stroke();
      context.closePath();

      context.beginPath();
      context.globalAlpha = downLineAlpha;
      context.lineWidth = downLineWidth;
      context.strokeStyle = downLineColor;
      if (lineStyle) {
        drawBezier(listDownArr, offset, len);
      } else {
        drawLine(listDownArr, offset, len);
      }
      context.stroke();
      context.closePath();

      raf = requestAnimationFrame(() => drawGraph(now));
    };

    drawGraph(Date.now());

    return () => {
      cancelAnimationFrame(raf);
    };
  }, [palette]);

  return <canvas ref={canvasRef} style={{ width: "100%", height: "100%" }} />;
}
