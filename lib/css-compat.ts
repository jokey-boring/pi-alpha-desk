/** 低版本浏览器 CSS 兼容辅助（避免 dvh/dvw、color-mix、inset 等） */

export function supportsColorMix(): boolean {
  return typeof CSS !== "undefined" && CSS.supports("color", "color-mix(in srgb, red, blue)");
}

export function supportsCssMinMax(): boolean {
  return typeof CSS !== "undefined" && CSS.supports("width", "min(1px, 2px)");
}

/** 全屏遮罩/浮层：不用 inset（旧 Safari / 部分 WebView 不支持） */
export const overlayCoverStyle = {
  position: "fixed" as const,
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
};

/** 根布局高度：优先 100%（html/body 已设 height:100%），不用 dvh */
export const appRootHeightStyle = {
  height: "100%",
  minHeight: "100%",
};

/**
 * color-mix 不支持时回退到纯色；支持时用 mix 表达式。
 * SSR 与首屏统一走 fallback，避免 hydration 不一致。
 */
export function colorMix(mixValue: string, fallback: string): string {
  if (typeof CSS !== "undefined" && CSS.supports("color", "color-mix(in srgb, red, blue)")) {
    return mixValue;
  }
  return fallback;
}

/** 弹窗 maxHeight：不用 min()，旧浏览器用 calc + vh */
export function modalMaxHeight(vhOffsetPx = 32, vhCap = 72): string {
  if (supportsCssMinMax()) {
    return `min(${vhCap}vh, calc(100vh - ${vhOffsetPx}px))`;
  }
  return `calc(100vh - ${vhOffsetPx}px)`;
}

export function modalFullScreenSize(mobile: boolean, offsetPx = 16): {
  width: string;
  maxWidth: string;
  height: string;
  maxHeight: string;
} {
  const edge = `calc(100vw - ${offsetPx}px)`;
  const tall = `calc(100vh - ${offsetPx}px)`;
  if (mobile) {
    return { width: edge, maxWidth: edge, height: tall, maxHeight: tall };
  }
  return {
    width: "860px",
    maxWidth: edge,
    height: "78vh",
    maxHeight: tall,
  };
}
