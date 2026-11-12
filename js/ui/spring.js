// Física de resortes (3.6) para que los gestos se sientan como objetos reales:
// cada animación arranca desde donde está el elemento en pantalla, hereda la
// velocidad del dedo y se puede agarrar y revertir en cualquier momento.
// Parámetros al estilo de Apple: `damping` (1 = sin rebote, < 1 rebota) y
// `response` (segundos para llegar; no es una duración fija).

const reduced = () =>
  document.documentElement.dataset.motion === 'off' || matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Posición y velocidad de un resorte `t` segundos después de soltarlo. */
export function springAt(t, { from, to, velocity = 0, damping = 1, response = 0.35 }) {
  const w0 = (2 * Math.PI) / response;
  const a = from - to;
  if (damping >= 1) {
    const e = Math.exp(-w0 * t);
    const b = velocity + w0 * a;
    return { x: to + (a + b * t) * e, v: (b - w0 * (a + b * t)) * e };
  }
  const wd = w0 * Math.sqrt(1 - damping * damping);
  const b = (velocity + damping * w0 * a) / wd;
  const e = Math.exp(-damping * w0 * t);
  const cos = Math.cos(wd * t);
  const sin = Math.sin(wd * t);
  return {
    x: to + e * (a * cos + b * sin),
    v: e * ((b * wd - damping * w0 * a) * cos - (a * wd + damping * w0 * b) * sin),
  };
}

/**
 * Anima un valor con un resorte. `onUpdate(x)` recibe cada cuadro.
 * Devuelve { stop(), value(), velocity() } para interrumpirlo desde el valor
 * que se ve en pantalla. Con movimiento reducido llega al destino de una vez.
 */
export function spring({ from, to, velocity = 0, damping = 1, response = 0.35, onUpdate, onDone }) {
  let cur = { x: from, v: velocity };
  let raf = 0;
  let done = false;
  const finish = () => {
    done = true;
    onUpdate(to);
    onDone?.();
  };
  if (reduced() || from === to) {
    finish();
    return { stop() {}, value: () => to, velocity: () => 0 };
  }
  const t0 = performance.now();
  const frame = (now) => {
    cur = springAt((now - t0) / 1000, { from, to, velocity, damping, response });
    if (Math.abs(cur.x - to) < 0.4 && Math.abs(cur.v) < 4) return finish();
    onUpdate(cur.x);
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return {
    stop() {
      cancelAnimationFrame(raf);
      done = true;
    },
    value: () => (done ? to : cur.x),
    velocity: () => (done ? 0 : cur.v),
  };
}

/** A dónde llegaría un lanzamiento con esta velocidad (px/s), como el scroll de iOS. */
export function project(velocity, decelerationRate = 0.998) {
  return ((velocity / 1000) * decelerationRate) / (1 - decelerationRate);
}

/** Resistencia progresiva al pasar un borde: se mueve cada vez menos, nunca choca. */
export function rubberband(overshoot, dimension, constant = 0.55) {
  return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot));
}

/** Guarda los últimos movimientos del dedo para saber su velocidad al soltar. */
export function velocityTracker() {
  let pts = [];
  return {
    add(v, t = performance.now()) {
      pts.push({ v, t });
      while (pts.length > 2 && t - pts[0].t > 100) pts.shift();
    },
    /** px/s; 0 si el dedo se quedó quieto antes de soltar. */
    velocity(now = performance.now()) {
      if (pts.length < 2 || now - pts[pts.length - 1].t > 80) return 0;
      const a = pts[0];
      const b = pts[pts.length - 1];
      return b.t > a.t ? ((b.v - a.v) / (b.t - a.t)) * 1000 : 0;
    },
    reset() {
      pts = [];
    },
  };
}
