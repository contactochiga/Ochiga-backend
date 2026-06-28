type MetricKind = "counter" | "gauge" | "histogram";

type MetricPoint = {
  name: string;
  kind: MetricKind;
  labels: Record<string, string>;
  value: number;
};

function labelsKey(labels?: Record<string, string | number | boolean | null | undefined>) {
  const entries = Object.entries(labels || {})
    .filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== "")
    .map(([key, value]) => [key, String(value)] as const)
    .sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(entries);
}

function parseLabels(key: string) {
  return Object.fromEntries(JSON.parse(key) as Array<[string, string]>) as Record<string, string>;
}

function renderLabels(labels: Record<string, string>) {
  const entries = Object.entries(labels);
  if (!entries.length) return "";
  return `{${entries.map(([key, value]) => `${key}="${String(value).replace(/"/g, '\\"')}"`).join(",")}}`;
}

export class MetricsRegistry {
  private counters = new Map<string, Map<string, number>>();
  private gauges = new Map<string, Map<string, number>>();
  private histograms = new Map<string, Map<string, { count: number; sum: number; min: number; max: number }>>();

  increment(name: string, labels?: Record<string, string | number | boolean | null | undefined>, value = 1) {
    const metric = this.counters.get(name) || new Map<string, number>();
    const key = labelsKey(labels);
    metric.set(key, (metric.get(key) || 0) + value);
    this.counters.set(name, metric);
  }

  gauge(name: string, value: number, labels?: Record<string, string | number | boolean | null | undefined>) {
    const metric = this.gauges.get(name) || new Map<string, number>();
    metric.set(labelsKey(labels), value);
    this.gauges.set(name, metric);
  }

  observe(name: string, value: number, labels?: Record<string, string | number | boolean | null | undefined>) {
    const metric = this.histograms.get(name) || new Map<string, { count: number; sum: number; min: number; max: number }>();
    const key = labelsKey(labels);
    const current = metric.get(key) || { count: 0, sum: 0, min: value, max: value };
    metric.set(key, {
      count: current.count + 1,
      sum: current.sum + value,
      min: Math.min(current.min, value),
      max: Math.max(current.max, value),
    });
    this.histograms.set(name, metric);
  }

  snapshot() {
    const points: MetricPoint[] = [];
    for (const [name, metric] of this.counters.entries()) {
      for (const [key, value] of metric.entries()) {
        points.push({ name, kind: "counter", labels: parseLabels(key), value });
      }
    }
    for (const [name, metric] of this.gauges.entries()) {
      for (const [key, value] of metric.entries()) {
        points.push({ name, kind: "gauge", labels: parseLabels(key), value });
      }
    }
    for (const [name, metric] of this.histograms.entries()) {
      for (const [key, value] of metric.entries()) {
        const labels = parseLabels(key);
        points.push({ name: `${name}_count`, kind: "histogram", labels, value: value.count });
        points.push({ name: `${name}_sum`, kind: "histogram", labels, value: value.sum });
        points.push({ name: `${name}_min`, kind: "histogram", labels, value: value.min });
        points.push({ name: `${name}_max`, kind: "histogram", labels, value: value.max });
      }
    }
    return points;
  }

  toPrometheus() {
    return this.snapshot()
      .map((point) => `${point.name}${renderLabels(point.labels)} ${point.value}`)
      .join("\n");
  }
}

export const operationalMetrics = new MetricsRegistry();

export function observeDuration(name: string, startedAt: number, labels?: Record<string, string | number | boolean | null | undefined>) {
  operationalMetrics.observe(name, Math.max(0, Date.now() - startedAt), labels);
}
