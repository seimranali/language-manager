const counters = new Map<string, number>();
const gauges = new Map<string, number>();

const label = (name: string, labels: Record<string, string>) => {
  const parts = Object.entries(labels).map(([k, v]) => `${k}="${v}"`);
  return parts.length ? `${name}{${parts.join(",")}}` : name;
};

export const metrics = {
  inc(name: string, labels: Record<string, string> = {}, by = 1) {
    const key = label(name, labels);
    counters.set(key, (counters.get(key) ?? 0) + by);
  },
  set(name: string, value: number, labels: Record<string, string> = {}) {
    gauges.set(label(name, labels), value);
  },
  /** Prometheus text exposition; values are per process. */
  render(): string {
    return [...counters, ...gauges].map(([k, v]) => `${k} ${v}`).join("\n") + "\n";
  },
};
