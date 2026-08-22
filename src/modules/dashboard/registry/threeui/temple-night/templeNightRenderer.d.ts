export interface TempleNightRenderer {
  readonly reducedMotion: boolean;
  render(time: number): void;
  resize(): void;
  setPointer(x: number, y: number, active: boolean): void;
  dispose(): void;
}

export function createTempleNightRenderer(canvas: HTMLCanvasElement): TempleNightRenderer | null;
