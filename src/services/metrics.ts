import { config } from '../config.js';

interface Counter {
  value: number;
  labels: Record<string, string>;
}

interface Histogram {
  buckets: number[];
  counts: number[];
  sum: number;
  labels: Record<string, string>;
}

export class MetricsCollector {
  private counters = new Map<string, Counter[]>();
  private histograms = new Map<string, Histogram[]>();

  /**
   * Increment a counter metric
   */
  incrementCounter(name: string, labels: Record<string, string> = {}, value: number = 1): void {
    if (!config.metrics.enabled) return;

    const key = this.getMetricKey(name, labels);
    const existing = this.counters.get(name);
    
    if (!existing) {
      this.counters.set(name, [{ value, labels }]);
      return;
    }

    const match = existing.find(c => this.labelsMatch(c.labels, labels));
    if (match) {
      match.value += value;
    } else {
      existing.push({ value, labels });
    }
  }

  /**
   * Record a histogram observation
   */
  observeHistogram(name: string, value: number, labels: Record<string, string> = {}): void {
    if (!config.metrics.enabled) return;

    const buckets = [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];
    const key = this.getMetricKey(name, labels);
    const existing = this.histograms.get(name);

    if (!existing) {
      const counts = new Array(buckets.length + 1).fill(0);
      const bucketIndex = this.findBucketIndex(value, buckets);
      counts[bucketIndex] = 1;
      this.histograms.set(name, [{ buckets, counts, sum: value, labels }]);
      return;
    }

    const match = existing.find(h => this.labelsMatch(h.labels, labels));
    if (match) {
      match.sum += value;
      const bucketIndex = this.findBucketIndex(value, match.buckets);
      match.counts[bucketIndex] = (match.counts[bucketIndex] || 0) + 1;
    } else {
      const counts = new Array(buckets.length + 1).fill(0);
      const bucketIndex = this.findBucketIndex(value, buckets);
      counts[bucketIndex] = 1;
      existing.push({ buckets, counts, sum: value, labels });
    }
  }

  /**
   * Get metric value
   */
  getCounter(name: string, labels: Record<string, string> = {}): number {
    const existing = this.counters.get(name);
    if (!existing) return 0;

    const match = existing.find(c => this.labelsMatch(c.labels, labels));
    return match ? match.value : 0;
  }

  /**
   * Set a gauge value (stored as counter for simplicity)
   */
  setGauge(name: string, value: number, labels: Record<string, string> = {}): void {
    if (!config.metrics.enabled) return;

    const existing = this.counters.get(name);
    if (!existing) {
      this.counters.set(name, [{ value, labels }]);
      return;
    }

    const match = existing.find(c => this.labelsMatch(c.labels, labels));
    if (match) {
      match.value = value;
    } else {
      existing.push({ value, labels });
    }
  }

  /**
   * Export metrics in Prometheus format
   */
  exportPrometheus(): string {
    if (!config.metrics.enabled) {
      return '# Metrics collection is disabled\n';
    }

    const lines: string[] = [];

    // Export counters
    for (const [name, counters] of this.counters.entries()) {
      for (const counter of counters) {
        const labelsStr = this.formatLabels(counter.labels);
        lines.push(`${name}${labelsStr} ${counter.value}`);
      }
    }

    // Export histograms
    for (const [name, histograms] of this.histograms.entries()) {
      for (const histogram of histograms) {
        const labelsStr = this.formatLabels(histogram.labels);
        
        // Export bucket counts
        for (let i = 0; i < histogram.buckets.length; i++) {
          const cumulative = histogram.counts.slice(0, i + 1).reduce((a, b) => a + b, 0);
          lines.push(`${name}_bucket${labelsStr}{le="${histogram.buckets[i]}"} ${cumulative}`);
        }
        
        // Export +Inf bucket
        const total = histogram.counts.reduce((a, b) => a + b, 0);
        lines.push(`${name}_bucket${labelsStr}{le="+Inf"} ${total}`);
        
        // Export sum and count
        lines.push(`${name}_sum${labelsStr} ${histogram.sum}`);
        lines.push(`${name}_count${labelsStr} ${total}`);
      }
    }

    return lines.join('\n') + '\n';
  }

  /**
   * Reset all metrics (useful for testing)
   */
  reset(): void {
    this.counters.clear();
    this.histograms.clear();
  }

  private getMetricKey(name: string, labels: Record<string, string>): string {
    const labelsStr = Object.entries(labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join(',');
    return `${name}{${labelsStr}}`;
  }

  private labelsMatch(a: Record<string, string>, b: Record<string, string>): boolean {
    const keysA = Object.keys(a).sort();
    const keysB = Object.keys(b).sort();

    if (keysA.length !== keysB.length) return false;

    return keysA.every(key => a[key] === b[key]);
  }

  private formatLabels(labels: Record<string, string>): string {
    const entries = Object.entries(labels).sort(([a], [b]) => a.localeCompare(b));
    if (entries.length === 0) return '';

    const labelStr = entries.map(([k, v]) => `${k}="${this.escapeLabelValue(v)}"`).join(',');
    return `{${labelStr}}`;
  }

  private escapeLabelValue(value: string): string {
    return value
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n');
  }

  private findBucketIndex(value: number, buckets: number[]): number {
    for (let i = 0; i < buckets.length; i++) {
      if (value <= buckets[i]) {
        return i;
      }
    }
    return buckets.length; // +Inf bucket
  }
}

// Singleton instance
export const metrics = new MetricsCollector();

