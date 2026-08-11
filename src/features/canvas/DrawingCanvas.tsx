import { useCallback, useMemo, useRef, useState } from "react";
import {
  Platform,
  StyleSheet,
  View,
  type LayoutChangeEvent,
} from "react-native";
import Svg, { Path } from "react-native-svg";
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

function pointsToPath(points: StrokePoint[]) {
  if (points.length === 0) return "";
  const [first, ...rest] = points;
  return `M ${first.x} ${first.y} ` + rest.map((p) => `L ${p.x} ${p.y}`).join(" ");
}

export function DrawingCanvas({ tool, disabled, onStrokesChange }: Props) {
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [size, setSize] = useState({ width: 320, height: 420 });
  const strokesRef = useRef<Stroke[]>([]);
  const currentId = useRef<string | null>(null);
  const toolRef = useRef(tool);
  toolRef.current = tool;

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

  return (
    <GestureHandlerRootView style={styles.root} onLayout={onLayout}>
      <GestureDetector gesture={pan}>
        <View style={styles.canvas} collapsable={false}>
          <Svg width={size.width} height={size.height}>
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
}

export async function strokesToPngBase64(
  strokes: Stroke[],
  width: number,
  height: number,
): Promise<string> {
  const w = Math.max(1, Math.floor(width));
  const h = Math.max(1, Math.floor(height));

  if (Platform.OS === "web" && typeof document !== "undefined") {
    const canvas = document.createElement("canvas");
    // Downscale for AI latency
    const maxDim = 768;
    const scale = Math.min(1, maxDim / Math.max(w, h));
    canvas.width = Math.max(1, Math.floor(w * scale));
    canvas.height = Math.max(1, Math.floor(h * scale));
    const ctx = canvas.getContext("2d");
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

  return WHITE_PNG_BASE64;
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
