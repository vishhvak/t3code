import React, { useEffect, useRef } from "react";

export type FluidOrbProps = React.ComponentProps<"div"> & {
  size?: number;
  color?: string;
  /** Deep end of the gradient. Defaults to `color`, giving a single-hue orb. */
  colorSecondary?: string;
  getLevel?: () => number;
  tempo?: number;
};

const VERT = `
attribute vec2 a_pos;
void main() {
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

const FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform vec2 u_resolution;
uniform float u_phase;
uniform float u_level;
uniform vec3 u_color;
uniform vec3 u_color2;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i + vec2(0.0, 0.0)), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.6;
  for (int i = 0; i < 3; i++) {
    v += a * noise(p);
    p *= 2.0;
    a *= 0.5;
  }
  return v;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution.xy;
  float t = u_phase;

  vec2 drift = vec2(
    sin(t) + 0.6 * sin(t * 1.7 + 1.3),
    cos(t * 0.8) + 0.6 * cos(t * 1.3 + 2.1)
  );

  vec2 p = vec2(uv.x * 1.8, uv.y * 1.0) + drift * (0.7 + 0.25 * u_level);

  vec2 q = vec2(fbm(p + drift), fbm(p + vec2(3.2, 1.5) - drift));
  float f = fbm(p + (1.2 + 1.1 * u_level) * q);

  float g = clamp(1.0 - uv.y, 0.0, 1.0);
  float anchor = smoothstep(0.0, 0.3, uv.y);
  float swell = 0.8 + 0.55 * u_level;
  float shade = clamp(g + (f - 0.5) * swell * anchor + 0.10 * u_level, 0.0, 1.0);

  vec3 white = vec3(0.99, 1.0, 1.0);
  vec3 light = mix(white, u_color, 0.5);
  // The second color only reaches the deep end, so the orb reads as one object
  // lit from a single side rather than two tones fighting for the surface.
  vec3 dark = mix(u_color, u_color2, 0.65);

  vec3 col = white;
  col = mix(col, light, smoothstep(0.28, 0.52, shade));
  col = mix(col, dark, smoothstep(0.58, 0.88, shade));

  float edge = smoothstep(0.5, 0.49, distance(uv, vec2(0.5)));

  gl_FragColor = vec4(col * edge, edge);
}
`;

function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace("#", "").trim();
  if (h.length === 3) {
    h = h[0]! + h[0]! + h[1]! + h[1]! + h[2]! + h[2]!;
  }
  const n = parseInt(h, 16);
  if (h.length !== 6 || Number.isNaN(n)) return [0.1, 0.45, 0.95];
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function compile(gl: WebGLRenderingContext, type: number, src: string) {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error(gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

export function FluidOrb({
  size = 240,
  color = "#7C5CFF",
  colorSecondary,
  getLevel,
  tempo = 1,
  className,
  style,
  ...props
}: FluidOrbProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const phaseRef = useRef(0);
  const getLevelRef = useRef(getLevel);
  const tempoRef = useRef(tempo);

  useEffect(() => {
    getLevelRef.current = getLevel;
    tempoRef.current = tempo;
  }, [getLevel, tempo]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext("webgl", { antialias: true, alpha: true });
    if (!gl) return;

    const program = gl.createProgram();
    const vert = compile(gl, gl.VERTEX_SHADER, VERT);
    const frag = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    if (!program || !vert || !frag) return;

    gl.attachShader(program, vert);
    gl.attachShader(program, frag);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error(gl.getProgramInfoLog(program));
      return;
    }
    gl.useProgram(program);

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    );
    const aPos = gl.getAttribLocation(program, "a_pos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const uResolution = gl.getUniformLocation(program, "u_resolution");
    const uPhase = gl.getUniformLocation(program, "u_phase");
    const uLevel = gl.getUniformLocation(program, "u_level");
    gl.uniform3f(gl.getUniformLocation(program, "u_color"), ...hexToRgb(color));
    gl.uniform3f(
      gl.getUniformLocation(program, "u_color2"),
      ...hexToRgb(colorSecondary ?? color),
    );

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const px = Math.round(size * dpr);
    canvas.width = px;
    canvas.height = px;
    gl.viewport(0, 0, px, px);
    gl.uniform2f(uResolution, px, px);

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let last = performance.now();
    let frame = 0;

    const render = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const level = reduce ? 0 : Math.min(1, Math.max(0, getLevelRef.current?.() ?? 0));
      if (!reduce) {
        phaseRef.current += dt * 0.22 * tempoRef.current * (1 + 1.6 * level);
      }
      gl.uniform1f(uPhase, phaseRef.current);
      gl.uniform1f(uLevel, level);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      if (!reduce) frame = requestAnimationFrame(render);
    };
    render(last);

    // A hidden tab must not keep drawing: this shader is expensive enough to
    // hold the GPU awake behind other windows.
    const onVisibility = () => {
      cancelAnimationFrame(frame);
      if (reduce || document.hidden) return;
      last = performance.now();
      frame = requestAnimationFrame(render);
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      cancelAnimationFrame(frame);
      gl.deleteProgram(program);
      gl.deleteShader(vert);
      gl.deleteShader(frag);
      gl.deleteBuffer(buffer);
    };
  }, [size, color, colorSecondary]);

  const classes = ["fluid-orb", className].filter(Boolean).join(" ");
  return (
    <div
      data-slot="fluid-orb"
      className={classes}
      style={{ width: size, height: size, ...style }}
      {...props}
    >
      <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />
    </div>
  );
}
