/**
 * Service dependency analyzer for optimization
 * Requirements: 8.3, 11.4
 */

import { Container } from './Container';
import { performanceMetrics } from '../monitoring/PerformanceMetrics';
import { getHighResolutionTime, calculateProcessingTime } from '../../utils/timing';

export interface DependencyNode {
  name: string;
  dependencies: string[];
  dependents: string[];
  depth: number;
  isCircular: boolean;
  circularPath?: string[];
}

export interface DependencyAnalysis {
  nodes: Map<string, DependencyNode>;
  circularDependencies: string[][];
  maxDepth: number;
  criticalPath: string[];
  recommendations: string[];
}

export class DependencyAnalyzer {
  constructor(private container: Container) {}

  /**
   * Analyze all service dependencies
   */
  analyze(): DependencyAnalysis {
    const startTime = getHighResolutionTime();
    
    try {
      const dependencyGraph = this.container.getDependencyGraph();
      const nodes = this.buildDependencyNodes(dependencyGraph);
      const circularDependencies = this.findCircularDependencies(nodes);
      const { maxDepth, criticalPath } = this.calculateDepths(nodes);
      const recommendations = this.generateRecommendations(nodes, circularDependencies);

      const duration = calculateProcessingTime(startTime);
      performanceMetrics.recordDuration(
        'dependency.analysis',
        duration,
        'dependency-analyzer'
      );

      return {
        nodes,
        circularDependencies,
        maxDepth,
        criticalPath,
        recommendations
      };
    } catch (error) {
      const duration = calculateProcessingTime(startTime);
      performanceMetrics.recordDuration(
        'dependency.analysis',
        duration,
        'dependency-analyzer',
        { status: 'error' }
      );
      throw error;
    }
  }

  /**
   * Suggest dependency injection optimizations
   */
  suggestOptimizations(): {
    lazyLoadCandidates: string[];
    eagerLoadCandidates: string[];
    interfaceExtractionCandidates: string[];
    circularDependencyFixes: Array<{
      cycle: string[];
      suggestedFix: string;
    }>;
  } {
    const analysis = this.analyze();
    
    const lazyLoadCandidates = this.findLazyLoadCandidates(analysis.nodes);
    const eagerLoadCandidates = this.findEagerLoadCandidates(analysis.nodes);
    const interfaceExtractionCandidates = this.findInterfaceExtractionCandidates(analysis.nodes);
    const circularDependencyFixes = this.suggestCircularDependencyFixes(analysis.circularDependencies);

    return {
      lazyLoadCandidates,
      eagerLoadCandidates,
      interfaceExtractionCandidates,
      circularDependencyFixes
    };
  }

  /**
   * Optimize service loading order
   */
  optimizeLoadingOrder(serviceNames: string[]): string[] {
    const analysis = this.analyze();
    const serviceNodes = serviceNames
      .map(name => analysis.nodes.get(name))
      .filter(node => node !== undefined) as DependencyNode[];

    // Sort by dependency depth (dependencies first)
    serviceNodes.sort((a, b) => a.depth - b.depth);

    return serviceNodes.map(node => node.name);
  }

  /**
   * Detect potential memory leaks from circular references
   */
  detectMemoryLeakRisks(): {
    circularReferences: string[][];
    heavyCircularNodes: string[];
    recommendations: string[];
  } {
    const analysis = this.analyze();
    const recommendations: string[] = [];
    
    const circularReferences = analysis.circularDependencies;
    const heavyCircularNodes = circularReferences
      .flat()
      .filter((node, index, arr) => arr.indexOf(node) === index) // unique
      .filter(node => {
        const nodeInfo = analysis.nodes.get(node);
        return nodeInfo && nodeInfo.dependents.length > 3; // Heavy nodes with many dependents
      });

    if (circularReferences.length > 0) {
      recommendations.push(`Found ${circularReferences.length} circular dependency cycles`);
    }

    if (heavyCircularNodes.length > 0) {
      recommendations.push(`Heavy nodes in circular dependencies: ${heavyCircularNodes.join(', ')}`);
      recommendations.push('Consider using interfaces or event-driven patterns to break cycles');
    }

    return {
      circularReferences,
      heavyCircularNodes,
      recommendations
    };
  }

  /**
   * Generate dependency visualization data
   */
  generateVisualizationData(): {
    nodes: Array<{
      id: string;
      label: string;
      depth: number;
      isCircular: boolean;
      dependencyCount: number;
      dependentCount: number;
    }>;
    edges: Array<{
      from: string;
      to: string;
      isCircular: boolean;
    }>;
  } {
    const analysis = this.analyze();
    
    const nodes = Array.from(analysis.nodes.values()).map(node => ({
      id: node.name,
      label: node.name,
      depth: node.depth,
      isCircular: node.isCircular,
      dependencyCount: node.dependencies.length,
      dependentCount: node.dependents.length
    }));

    const edges: Array<{ from: string; to: string; isCircular: boolean }> = [];
    
    for (const node of analysis.nodes.values()) {
      for (const dependency of node.dependencies) {
        edges.push({
          from: node.name,
          to: dependency,
          isCircular: node.isCircular && analysis.nodes.get(dependency)?.isCircular === true
        });
      }
    }

    return { nodes, edges };
  }

  private buildDependencyNodes(dependencyGraph: Record<string, string[]>): Map<string, DependencyNode> {
    const nodes = new Map<string, DependencyNode>();
    
    // Initialize nodes
    for (const [name, dependencies] of Object.entries(dependencyGraph)) {
      nodes.set(name, {
        name,
        dependencies,
        dependents: [],
        depth: 0,
        isCircular: false
      });
    }

    // Build reverse dependencies (dependents)
    for (const [name, dependencies] of Object.entries(dependencyGraph)) {
      for (const dependency of dependencies) {
        const dependencyNode = nodes.get(dependency);
        if (dependencyNode) {
          dependencyNode.dependents.push(name);
        }
      }
    }

    return nodes;
  }

  private findCircularDependencies(nodes: Map<string, DependencyNode>): string[][] {
    const visited = new Set<string>();
    const recursionStack = new Set<string>();
    const cycles: string[][] = [];

    const dfs = (nodeName: string, path: string[]): void => {
      if (recursionStack.has(nodeName)) {
        const cycleStart = path.indexOf(nodeName);
        const cycle = path.slice(cycleStart).concat(nodeName);
        cycles.push(cycle);
        
        // Mark nodes as circular
        cycle.forEach(name => {
          const node = nodes.get(name);
          if (node) {
            node.isCircular = true;
            node.circularPath = cycle;
          }
        });
        return;
      }

      if (visited.has(nodeName)) {
        return;
      }

      visited.add(nodeName);
      recursionStack.add(nodeName);

      const node = nodes.get(nodeName);
      if (node) {
        for (const dependency of node.dependencies) {
          dfs(dependency, [...path, nodeName]);
        }
      }

      recursionStack.delete(nodeName);
    };

    for (const nodeName of nodes.keys()) {
      if (!visited.has(nodeName)) {
        dfs(nodeName, []);
      }
    }

    return cycles;
  }

  private calculateDepths(nodes: Map<string, DependencyNode>): { maxDepth: number; criticalPath: string[] } {
    const depths = new Map<string, number>();
    const visited = new Set<string>();
    let maxDepth = 0;
    let criticalPath: string[] = [];

    const calculateDepth = (nodeName: string, path: string[]): number => {
      if (depths.has(nodeName)) {
        return depths.get(nodeName)!;
      }

      if (visited.has(nodeName)) {
        // Circular dependency, return current path length
        return path.length;
      }

      visited.add(nodeName);
      const node = nodes.get(nodeName);
      
      if (!node || node.dependencies.length === 0) {
        depths.set(nodeName, 0);
        visited.delete(nodeName);
        return 0;
      }

      let maxDependencyDepth = 0;
      for (const dependency of node.dependencies) {
        const depthPath = [...path, nodeName];
        const dependencyDepth = calculateDepth(dependency, depthPath);
        maxDependencyDepth = Math.max(maxDependencyDepth, dependencyDepth);
      }

      const nodeDepth = maxDependencyDepth + 1;
      depths.set(nodeName, nodeDepth);
      node.depth = nodeDepth;

      if (nodeDepth > maxDepth) {
        maxDepth = nodeDepth;
        criticalPath = [...path, nodeName];
      }

      visited.delete(nodeName);
      return nodeDepth;
    };

    for (const nodeName of nodes.keys()) {
      calculateDepth(nodeName, []);
    }

    return { maxDepth, criticalPath };
  }

  private generateRecommendations(
    nodes: Map<string, DependencyNode>,
    circularDependencies: string[][]
  ): string[] {
    const recommendations: string[] = [];

    // Circular dependency recommendations
    if (circularDependencies.length > 0) {
      recommendations.push(`Found ${circularDependencies.length} circular dependencies - consider using interfaces or events`);
    }

    // Deep dependency chain recommendations
    const deepNodes = Array.from(nodes.values()).filter(node => node.depth > 5);
    if (deepNodes.length > 0) {
      recommendations.push(`${deepNodes.length} services have deep dependency chains (>5 levels) - consider flattening`);
    }

    // High fan-out recommendations
    const highFanOutNodes = Array.from(nodes.values()).filter(node => node.dependents.length > 10);
    if (highFanOutNodes.length > 0) {
      recommendations.push(`Services with high fan-out: ${highFanOutNodes.map(n => n.name).join(', ')} - consider splitting`);
    }

    // Leaf node recommendations (potential lazy loading candidates)
    const leafNodes = Array.from(nodes.values()).filter(node => node.dependents.length === 0);
    if (leafNodes.length > 0) {
      recommendations.push(`${leafNodes.length} leaf services could be lazy-loaded`);
    }

    return recommendations;
  }

  private findLazyLoadCandidates(nodes: Map<string, DependencyNode>): string[] {
    return Array.from(nodes.values())
      .filter(node => 
        node.dependents.length <= 2 && // Low usage
        node.dependencies.length > 0 && // Has dependencies
        !node.isCircular // Not in circular dependency
      )
      .map(node => node.name);
  }

  private findEagerLoadCandidates(nodes: Map<string, DependencyNode>): string[] {
    return Array.from(nodes.values())
      .filter(node => 
        node.dependents.length >= 5 && // High usage
        node.depth <= 2 && // Shallow dependency
        !node.isCircular // Not in circular dependency
      )
      .map(node => node.name);
  }

  private findInterfaceExtractionCandidates(nodes: Map<string, DependencyNode>): string[] {
    return Array.from(nodes.values())
      .filter(node => 
        node.dependents.length >= 3 && // Multiple dependents
        node.dependencies.length >= 2 // Multiple dependencies
      )
      .map(node => node.name);
  }

  private suggestCircularDependencyFixes(cycles: string[][]): Array<{ cycle: string[]; suggestedFix: string }> {
    return cycles.map(cycle => {
      const cycleStr = cycle.join(' -> ');
      let suggestedFix = '';

      if (cycle.length === 2) {
        suggestedFix = 'Extract interface or use dependency injection with factory pattern';
      } else if (cycle.length === 3) {
        suggestedFix = 'Introduce mediator pattern or event-driven communication';
      } else {
        suggestedFix = 'Consider breaking into smaller services or using event sourcing';
      }

      return { cycle, suggestedFix: `${suggestedFix} (cycle: ${cycleStr})` };
    });
  }
}