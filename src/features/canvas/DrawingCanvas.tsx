import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Platform,
  StyleSheet,
  View,
  type LayoutChangeEvent,
} from "react-native";
import Svg, { Path, Rect } from "react-native-svg";
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
} from "react-native-gesture-handler";
import type { Stroke, StrokePoint } from "@/lib/types";
import { colors } from "@/lib/theme";

type Props = {
  tool: "pen" | "eraser";
  disabled?: boolean;
  onStrokesChange?: (strokes: Stroke[]) => void;
};

export type DrawingCanvasHandle = {
  /** Rasterize the current drawing to a base64 PNG (no data: prefix). */
  exportPngBase64: () => Promise<string>;
};

// Downscale exports for AI judging latency / payload size.
const MAX_EXPORT_DIM = 768;

function pointsToPath(points: StrokePoint[]) {
  if (points.length === 0) return "";
  const [first, ...rest] = points;
  return `M ${first.x} ${first.y} ` + rest.map((p) => `L ${p.x} ${p.y}`).join(" ");
}

export const DrawingCanvas = forwardRef<DrawingCanvasHandle, Props>(
  function DrawingCanvas({ tool, disabled, onStrokesChange }, ref) {
    const [strokes, setStrokes] = useState<Stroke[]>([]);
    const [size, setSize] = useState({ width: 320, height: 420 });
    const strokesRef = useRef<Stroke[]>([]);
    const sizeRef = useRef(size);
    const currentId = useRef<string | null>(null);
    const toolRef = useRef(tool);
    const svgRef = useRef<Svg>(null);
    toolRef.current = tool;
    sizeRef.current = size;

    const commit = useCallback(
      (next: Stroke[]) => {
        strokesRef.current = next;
        setStrokes(next);
        onStrokesChange?.(next);
      },
      [onStrokesChange],
    );

    const pan = useMemo(
      () =>
        Gesture.Pan()
          .enabled(!disabled)
          .minDistance(0)
          .onBegin((e) => {
            const id = `${Date.now()}-${Math.random()}`;
            currentId.current = id;
            const stroke: Stroke = {
              id,
              tool: toolRef.current,
              width: toolRef.current === "eraser" ? 24 : 4,
              points: [{ x: e.x, y: e.y }],
            };
            commit([...strokesRef.current, stroke]);
          })
          .onUpdate((e) => {
            const id = currentId.current;
            if (!id) return;
            commit(
              strokesRef.current.map((s) =>
                s.id === id ? { ...s, points: [...s.points, { x: e.x, y: e.y }] } : s,
              ),
            );
          })
          .onFinalize(() => {
            currentId.current = null;
          })
          .runOnJS(true),
      [commit, disabled],
    );

    const onLayout = (e: LayoutChangeEvent) => {
      const { width, height } = e.nativeEvent.layout;
      if (width > 0 && height > 0) setSize({ width, height });
    };

    useImperativeHandle(
      ref,
      () => ({
        exportPngBase64: () =>
          exportToPng(strokesRef.current, sizeRef.current, svgRef.current),
      }),
      [],
    );

    return (
      <GestureHandlerRootView style={styles.root} onLayout={onLayout}>
        <GestureDetector gesture={pan}>
          <View style={styles.canvas} collapsable={false}>
            <Svg
              ref={svgRef}
              width={size.width}
              height={size.height}
              viewBox={`0 0 ${size.width} ${size.height}`}
            >
              <Rect x={0} y={0} width={size.width} height={size.height} fill={colors.canvas} />
              {strokes.map((stroke) => (
                <Path
                  key={stroke.id}
                  d={pointsToPath(stroke.points)}
                  stroke={stroke.tool === "eraser" ? colors.canvas : colors.stroke}
                  strokeWidth={stroke.width}
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ))}
            </Svg>
          </View>
        </GestureDetector>
      </GestureHandlerRootView>
    );
  },
);

async function exportToPng(
  strokes: Stroke[],
  size: { width: number; height: number },
  svgNode: Svg | null,
): Promise<string> {
  const w = Math.max(1, Math.floor(size.width));
  const h = Math.max(1, Math.floor(size.height));
  const scale = Math.min(1, MAX_EXPORT_DIM / Math.max(w, h));
  const outW = Math.max(1, Math.floor(w * scale));
  const outH = Math.max(1, Math.floor(h * scale));

  if (Platform.OS === "web" && typeof document !== "undefined") {
    const canvas = document.createElement("canvas");
    canvas.width = outW;
    canvas.height = outH;
    // Force plain sRGB. Without this, Chrome on wide-gamut (P3) displays embeds
    // a Display P3 ICC profile in the exported PNG; Android's Skia-based image
    // decoder can fail to decode that profile and silently drops the image
    // (works fine everywhere else, since browsers tolerate it — this is why
    // web-submitted drawings rendered on web/iOS but came up blank on Android).
    const ctx = canvas.getContext("2d", { colorSpace: "srgb" });
    if (!ctx) throw new Error("Canvas unsupported");
    ctx.scale(scale, scale);
    ctx.fillStyle = colors.canvas;
    ctx.fillRect(0, 0, w, h);
    for (const stroke of strokes) {
      if (stroke.points.length < 1) continue;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.lineWidth = stroke.width;
      ctx.strokeStyle = stroke.tool === "eraser" ? colors.canvas : colors.stroke;
      ctx.beginPath();
      ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
      for (let i = 1; i < stroke.points.length; i++) {
        ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
      }
      if (stroke.points.length === 1) {
        ctx.lineTo(stroke.points[0].x + 0.1, stroke.points[0].y);
      }
      ctx.stroke();
    }
    return canvas.toDataURL("image/png").replace(/^data:image\/png;base64,/, "");
  }

  // Native (iOS/Android): react-native-svg renders via native views, not a DOM
  // canvas, so rasterize the live <Svg> node through its built-in exporter
  // instead. width/height must both be present and numeric or the native
  // module rejects the call outright (and never invokes the callback).
  if (!svgNode) return WHITE_PNG_BASE64;
  return new Promise<string>((resolve, reject) => {
    try {
      svgNode.toDataURL(
        (base64: string) => {
          if (base64) resolve(base64);
          else reject(new Error("Failed to export drawing"));
        },
        { width: outW, height: outH },
      );
    } catch (e) {
      reject(e instanceof Error ? e : new Error("Failed to export drawing"));
    }
  });
}

const WHITE_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO5nZ3kAAAAASUVORK5CYII=";

const styles = StyleSheet.create({
  root: {
    flex: 1,
    width: "100%",
    backgroundColor: colors.canvas,
    borderRadius: 8,
    overflow: "hidden",
    borderWidth: 2,
    borderColor: colors.ink,
  },
  canvas: {
    flex: 1,
    backgroundColor: colors.canvas,
  },
});
