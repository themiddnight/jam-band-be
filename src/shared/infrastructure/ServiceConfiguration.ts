/**
 * Main service configuration for the entire application
 */

import { container, serviceRegistry } from './di';
import { InMemoryEventBus } from '../domain/events/InMemoryEventBus';
import { configureLobbyServices, initializeLobbyContext } from '../../domains/lobby-management/infrastructure/ServiceConfiguration';
import { configureRoomServices, initializeRoomContext } from '../../domains/room-management/infrastructure/ServiceConfiguration';
import { performanceMetrics } from './monitoring';

/**
 * Configure shared services used across all bounded contexts
 */
export function configureSharedServices(): void {
  // Event bus (singleton, eagerly loaded)
  container.singleton('eventBus', () => {
    return new InMemoryEventBus();
  });

  // Performance metrics (singleton, eagerly loaded)
  container.singleton('performanceMetrics', () => {
    return performanceMetrics;
  });

  // Monitoring dashboard (lazy loaded)
  container.lazy('monitoringDashboard', async () => {
    const { monitoringDashboard } = await import('./monitoring');
    return monitoringDashboard;
  });
}

/**
 * Configure all bounded context services
 */
export function configureAllServices(): void {
  // Configure shared services first
  configureSharedServices();
  
  // Configure bounded context services
  configureLobbyServices();
  configureRoomServices();
  
  // Add more contexts as they are implemented
  // configureAudioServices();
  // configureRealTimeCommunicationServices();
  // configureUserServices();
}

/**
 * Initialize all contexts in optimal order
 */
export async function initializeAllContexts(): Promise<void> {
  const startTime = Bun.nanoseconds();
  
  try {
    // Initialize shared services first
    await container.get('eventBus');
    await container.get('performanceMetrics');
    
    // Initialize contexts in dependency order
    // Room management first (other contexts depend on it)
    await initializeRoomContext();
    
    // Lobby management (depends on room management)
    await initializeLobbyContext();
    
    // Add more contexts as needed
    // await initializeAudioContext();
    // await initializeRealTimeCommunicationContext();
    // await initializeUserContext();
    
    const duration = (Bun.nanoseconds() - startTime) / 1_000_000;
    
    performanceMetrics.recordDuration(
      'application.initialization',
      duration,
      'application',
      { status: 'success' }
    );
    
    console.log(`✅ All contexts initialized successfully in ${duration.toFixed(2)}ms`);
    
  } catch (error) {
    const duration = (Bun.nanoseconds() - startTime) / 1_000_000;
    
    performanceMetrics.recordDuration(
      'application.initialization',
      duration,
      'application',
      { status: 'error' }
    );
    
    console.error('❌ Failed to initialize contexts:', error);
    throw error;
  }
}

/**
 * Get service health report
 */
export function getServiceHealthReport(): {
  contexts: string[];
  totalServices: number;
  circularDependencies: string[];
  serviceHealth: any;
  recommendations: string[];
} {
  const analysis = serviceRegistry.analyzeDependencies();
  const serviceHealth = serviceRegistry.getServiceHealth();
  
  const recommendations: string[] = [];
  
  if (analysis.circularDependencies.length > 0) {
    recommendations.push(`Found ${analysis.circularDependencies.length} circular dependencies`);
  }
  
  if (analysis.heavyContexts.length > 0) {
    recommendations.push(`Heavy contexts detected: ${analysis.heavyContexts.map(c => c.context).join(', ')}`);
  }
  
  if (serviceHealth.failedInitializations > 0) {
    recommendations.push(`${serviceHealth.failedInitializations} services failed to initialize`);
  }
  
  if (serviceHealth.averageInitTime > 100) {
    recommendations.push(`Slow service initialization (${serviceHealth.averageInitTime.toFixed(2)}ms average)`);
  }
  
  return {
    ...analysis,
    serviceHealth,
    recommendations
  };
}

/**
 * Gracefully shutdown all services
 */
export async function shutdownServices(): Promise<void> {
  const startTime = Bun.nanoseconds();
  
  try {
    // Clear all service instances
    container.clearInstances();
    
    const duration = (Bun.nanoseconds() - startTime) / 1_000_000;
    
    performanceMetrics.recordDuration(
      'application.shutdown',
      duration,
      'application',
      { status: 'success' }
    );
    
    console.log(`✅ Services shutdown completed in ${duration.toFixed(2)}ms`);
    
  } catch (error) {
    const duration = (Bun.nanoseconds() - startTime) / 1_000_000;
    
    performanceMetrics.recordDuration(
      'application.shutdown',
      duration,
      'application',
      { status: 'error' }
    );
    
    console.error('❌ Failed to shutdown services:', error);
    throw error;
  }
}