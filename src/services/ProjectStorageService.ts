import { loggingService } from './LoggingService';

export interface ProjectMetadata {
  roomId: string;
  projectName: string;
  uploadedBy: string;
  uploadedAt: string;
  projectData: any; // The deserialized project.json
}

/**
 * In-memory storage for project metadata per room
 */
export class ProjectStorageService {
  private projects: Map<string, ProjectMetadata> = new Map();

  /**
   * Save project metadata for a room
   */
  saveProject(roomId: string, projectData: any, uploadedBy: string): void {
    const metadata: ProjectMetadata = {
      roomId,
      projectName: projectData.metadata?.name || 'Untitled Project',
      uploadedBy,
      uploadedAt: new Date().toISOString(),
      projectData,
    };

    this.projects.set(roomId, metadata);
    
    loggingService.logInfo('Project saved to memory', {
      roomId,
      projectName: metadata.projectName,
      uploadedBy,
    });
  }

  /**
   * Get project metadata for a room
   */
  getProject(roomId: string): ProjectMetadata | null {
    return this.projects.get(roomId) || null;
  }

  /**
   * Delete project for a room
   */
  deleteProject(roomId: string): void {
    this.projects.delete(roomId);
    loggingService.logInfo('Project deleted from memory', { roomId });
  }

  /**
   * Check if room has a project
   */
  hasProject(roomId: string): boolean {
    return this.projects.has(roomId);
  }
}

export const projectStorageService = new ProjectStorageService();
