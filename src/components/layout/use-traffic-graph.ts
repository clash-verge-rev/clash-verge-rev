import { useRef } from "react";

const minPoint = 10;
const maxPoint = 36;

const refLineAlpha = 0.5;
const refLineWidth = 2;
const refLineColor = "#ccc";

const upLineAlpha = 0.6;
const upLineWidth = 4;
const upLineColor = "#9c27b0";

const downLineAlpha = 1;
const downLineWidth = 4;
const downLineColor = "#5b5c9d";

/**
 * draw the traffic graph
 */
export default function useTrafficGraph() {
  type TrafficData = { up: number; down: number };
  const listRef = useRef<TrafficData[]>([]);
  const styleRef = useRef(true);
  const canvasRef = useRef<HTMLCanvasElement>(null!);

  const drawGraph = () => {
    const canvas = canvasRef.current!;
    const context = canvas.getContext("2d")!;
    const width = canvas.width;
    const height = canvas.height;
    const l1 = height * 0.2;
    const l2 = height * 0.6;
    const dl = height * 0.4;

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

    const countY = (value: number) => {
      let v = value;
      if (v < 1024) v = (v / 1024) * dl;
      else if (v < 1048576) v = dl + (v / 1048576) * dl;
      else v = 2 * dl + (v / 10485760) * l1;
      return height - v;
    };

    const drawBezier = (list: number[]) => {
      const len = list.length;
      const size = Math.min(Math.max(len, minPoint), maxPoint);
      const axis = width / size;

      let lx = 0;
      let ly = height;
      let llx = 0;
      let lly = height;

      list.forEach((val, index) => {
        const x = (axis * index) | 0;
        const y = countY(val);
        const s = 0.25;

        if (index === 0) context.moveTo(x, y);
        else {
          let nx = (axis * (index + 1)) | 0;
          let ny = index < len - 1 ? countY(list[index + 1]) | 0 : 0;
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
      const len = list.length;
      const size = Math.min(Math.max(len, minPoint), maxPoint);
      const axis = width / size;

      list.forEach((val, index) => {
        const x = (axis * index) | 0;
        const y = countY(val);

        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      });
    };

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
  };

  const appendData = (data: TrafficData) => {
    const list = listRef.current;
    if (list.length > maxPoint) list.shift();
    list.push(data);
    drawGraph();
  };

  const toggleStyle = () => {
    styleRef.current = !styleRef.current;
    drawGraph();
  };

  return {
    canvasRef,
    appendData,
    toggleStyle,
  };
}
