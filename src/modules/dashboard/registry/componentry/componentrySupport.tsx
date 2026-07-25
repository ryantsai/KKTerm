import {
  Component,
  useEffect,
  useState,
  type ErrorInfo,
  type ReactNode,
} from "react";

export function cn(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function appBackgroundIsLight(): boolean {
  if (typeof document === "undefined") return false;
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue("--app-bg")
    .trim();
  const hex = value.match(/^#([0-9a-f]{6})$/i)?.[1];
  const rgb = value.match(
    /^rgba?\(\s*(\d+(?:\.\d+)?)\s*[, ]\s*(\d+(?:\.\d+)?)\s*[, ]\s*(\d+(?:\.\d+)?)/i,
  );
  const channels = hex
    ? [
        Number.parseInt(hex.slice(0, 2), 16),
        Number.parseInt(hex.slice(2, 4), 16),
        Number.parseInt(hex.slice(4, 6), 16),
      ]
    : rgb
      ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])]
      : null;
  if (!channels) return false;
  const [red, green, blue] = channels.map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.04045
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return red * 0.2126 + green * 0.7152 + blue * 0.0722 > 0.5;
}

export function useComponentryLightTheme(): boolean {
  const [light, setLight] = useState(appBackgroundIsLight);

  useEffect(() => {
    const sync = () => setLight(appBackgroundIsLight());
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-color-scheme"],
    });
    sync();
    return () => observer.disconnect();
  }, []);

  return light;
}

interface WebGLErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
}

interface WebGLErrorBoundaryState {
  hasError: boolean;
}

export class WebGLErrorBoundary extends Component<
  WebGLErrorBoundaryProps,
  WebGLErrorBoundaryState
> {
  public state: WebGLErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): WebGLErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(_error: Error, _errorInfo: ErrorInfo) {
    // The fallback is intentionally silent because the entire background host
    // is decorative and already hidden from assistive technology.
  }

  render() {
    return this.state.hasError
      ? (this.props.fallback ?? <WebGLFallback />)
      : this.props.children;
  }
}

export function WebGLFallback({ className }: { className?: string }) {
  return (
    <div
      className={cn("componentry-webgl-fallback", className)}
      aria-hidden="true"
    />
  );
}
