import { describe, it, expect, beforeEach } from '@jest/globals';
import { MetricsCollector } from '../metrics.js';

describe('MetricsCollector', () => {
  let metrics: MetricsCollector;

  beforeEach(() => {
    metrics = new MetricsCollector();
  });

  it('should increment counter', () => {
    metrics.incrementCounter('test_counter');
    expect(metrics.getCounter('test_counter')).toBe(1);

    metrics.incrementCounter('test_counter', {}, 5);
    expect(metrics.getCounter('test_counter')).toBe(6);
  });

  it('should handle counter with labels', () => {
    metrics.incrementCounter('test_counter', { agent: 'test-agent' });
    metrics.incrementCounter('test_counter', { agent: 'other-agent' });

    expect(metrics.getCounter('test_counter', { agent: 'test-agent' })).toBe(1);
    expect(metrics.getCounter('test_counter', { agent: 'other-agent' })).toBe(1);
  });

  it('should record histogram observations', () => {
    metrics.observeHistogram('test_histogram', 0.5);
    metrics.observeHistogram('test_histogram', 1.0);
    metrics.observeHistogram('test_histogram', 0.1);

    const output = metrics.exportPrometheus();
    expect(output).toContain('test_histogram_bucket');
    expect(output).toContain('test_histogram_sum');
    expect(output).toContain('test_histogram_count');
  });

  it('should export Prometheus format', () => {
    metrics.incrementCounter('test_counter', { label: 'value' });
    metrics.setGauge('test_gauge', 42);

    const output = metrics.exportPrometheus();
    
    expect(output).toContain('test_counter{label="value"}');
    expect(output).toContain('test_gauge 42');
  });

  it('should reset metrics', () => {
    metrics.incrementCounter('test_counter');
    metrics.observeHistogram('test_histogram', 1.0);

    metrics.reset();

    expect(metrics.getCounter('test_counter')).toBe(0);
    const output = metrics.exportPrometheus();
    expect(output).not.toContain('test_counter');
    expect(output).not.toContain('test_histogram');
  });

  it('should set gauge values', () => {
    metrics.setGauge('test_gauge', 100);
    expect(metrics.getCounter('test_gauge')).toBe(100);

    metrics.setGauge('test_gauge', 200);
    expect(metrics.getCounter('test_gauge')).toBe(200);
  });
});

