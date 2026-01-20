import { useState } from 'react';
import type { RxCollection } from 'rxdb';
import type { BenchmarkResult, CapacityTestResult } from '@offline-sync/sdk/testing';
import {
  benchmarkWrite,
  benchmarkRead,
  benchmarkQuery,
  testCapacity,
} from '@offline-sync/sdk/testing';

interface PerformanceProps {
  collection: RxCollection;
}

export function Performance({ collection }: PerformanceProps) {
  const [benchmarks, setBenchmarks] = useState<BenchmarkResult[]>([]);
  const [capacityResult, setCapacityResult] = useState<CapacityTestResult | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [currentTest, setCurrentTest] = useState<string>('');

  const todoDataFactory = () => ({
    text: `Performance test todo ${Date.now()}`,
    completed: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  const runWriteBenchmark = async () => {
    setCurrentTest('写入测试...');
    const result = await benchmarkWrite(collection, 100, todoDataFactory);
    setBenchmarks((prev) => [...prev.filter((b) => b.operation !== 'write'), result]);
    setCurrentTest('');
  };

  const runReadBenchmark = async () => {
    setCurrentTest('读取测试...');
    const result = await benchmarkRead(collection, 100);
    setBenchmarks((prev) => [...prev.filter((b) => b.operation !== 'read'), result]);
    setCurrentTest('');
  };

  const runQueryBenchmark = async () => {
    setCurrentTest('查询测试...');
    const result = await benchmarkQuery(collection, 100);
    setBenchmarks((prev) => [...prev.filter((b) => b.operation !== 'query'), result]);
    setCurrentTest('');
  };

  const runCapacityTest = async () => {
    setCurrentTest('容量测试...');
    const result = await testCapacity(collection, 10, todoDataFactory);
    setCapacityResult(result);
    setCurrentTest('');
  };

  const runAllBenchmarks = async () => {
    setIsRunning(true);
    setCurrentTest('运行所有基准测试...');

    const writeResult = await benchmarkWrite(collection, 100, todoDataFactory);
    setBenchmarks((prev) => [...prev.filter((b) => b.operation !== 'write'), writeResult]);

    setCurrentTest('运行所有基准测试... 读取');
    const readResult = await benchmarkRead(collection, 100);
    setBenchmarks((prev) => [...prev.filter((b) => b.operation !== 'read'), readResult]);

    setCurrentTest('运行所有基准测试... 查询');
    const queryResult = await benchmarkQuery(collection, 100);
    setBenchmarks((prev) => [...prev.filter((b) => b.operation !== 'query'), queryResult]);

    setCurrentTest('');
    setIsRunning(false);
  };

  const getStatusClass = (result: BenchmarkResult): string => {
    const { avgTime, operation } = result;
    switch (operation) {
      case 'write':
        return avgTime < 10 ? 'status-excellent' : avgTime < 50 ? 'status-good' : 'status-fair';
      case 'read':
        return avgTime < 5 ? 'status-excellent' : avgTime < 20 ? 'status-good' : 'status-fair';
      case 'query':
        return avgTime < 50 ? 'status-excellent' : avgTime < 100 ? 'status-good' : 'status-fair';
      default:
        return '';
    }
  };

  const clearResults = () => {
    setBenchmarks([]);
    setCapacityResult(null);
  };

  return (
    <div className="performance">
      <h2>性能测试</h2>

      <div className="performance-controls">
        <button
          className="btn btn-primary"
          onClick={runWriteBenchmark}
          disabled={isRunning}
        >
          写入测试
        </button>
        <button
          className="btn btn-primary"
          onClick={runReadBenchmark}
          disabled={isRunning}
        >
          读取测试
        </button>
        <button
          className="btn btn-primary"
          onClick={runQueryBenchmark}
          disabled={isRunning}
        >
          查询测试
        </button>
        <button
          className="btn btn-primary"
          onClick={runCapacityTest}
          disabled={isRunning}
        >
          容量测试 (10MB)
        </button>
        <button
          className="btn btn-secondary"
          onClick={runAllBenchmarks}
          disabled={isRunning}
        >
          运行所有测试
        </button>
        <button
          className="btn btn-secondary"
          onClick={clearResults}
          disabled={isRunning}
        >
          清除结果
        </button>
      </div>

      {currentTest && (
        <div className="performance-status">
          <span className="spinner"></span>
          {currentTest}
        </div>
      )}

      {benchmarks.length > 0 && (
        <div className="performance-results">
          <h3>基准测试结果</h3>
          {benchmarks.map((result, index) => (
            <div key={index} className={`benchmark-result ${getStatusClass(result)}`}>
              <h4>{result.operation.toUpperCase()} 操作 ({result.count} 次)</h4>
              <div className="benchmark-metrics">
                <div className="metric">
                  <span className="metric-label">总耗时:</span>
                  <span className="metric-value">{result.totalTime.toFixed(2)}ms</span>
                </div>
                <div className="metric">
                  <span className="metric-label">平均耗时:</span>
                  <span className="metric-value">{result.avgTime.toFixed(2)}ms</span>
                </div>
                <div className="metric">
                  <span className="metric-label">最小耗时:</span>
                  <span className="metric-value">{result.minTime.toFixed(2)}ms</span>
                </div>
                <div className="metric">
                  <span className="metric-label">最大耗时:</span>
                  <span className="metric-value">{result.maxTime.toFixed(2)}ms</span>
                </div>
                <div className="metric">
                  <span className="metric-label">吞吐量:</span>
                  <span className="metric-value">{result.opsPerSecond.toFixed(0)} ops/sec</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {capacityResult && (
        <div className="capacity-result">
          <h3>容量测试结果</h3>
          <div className={`capacity-status ${capacityResult.success ? 'status-success' : 'status-fail'}`}>
            {capacityResult.success ? '✅ 通过' : '❌ 失败'}
          </div>
          <div className="capacity-metrics">
            <div className="metric">
              <span className="metric-label">目标大小:</span>
              <span className="metric-value">{capacityResult.targetSizeMB} MB</span>
            </div>
            <div className="metric">
              <span className="metric-label">实际大小:</span>
              <span className="metric-value">{capacityResult.actualSizeMB.toFixed(2)} MB</span>
            </div>
            <div className="metric">
              <span className="metric-label">文档数量:</span>
              <span className="metric-value">{capacityResult.documentCount}</span>
            </div>
          </div>
          {capacityResult.error && (
            <div className="capacity-error">
              错误: {capacityResult.error}
            </div>
          )}
        </div>
      )}

      <div className="performance-targets">
        <h3>性能基准目标</h3>
        <ul>
          <li>单次写入: &lt; 10ms</li>
          <li>批量读取 (100 条): &lt; 50ms</li>
          <li>查询 (1000 条数据): &lt; 100ms</li>
          <li>容量: &gt; 100MB</li>
        </ul>
      </div>
    </div>
  );
}
