import fs from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

/**
 * Service for managing saved project files on disk
 * Stores projects in /record-audio/{userId}/{projectId}/
 * Also manages in-memory project storage for active rooms
 */
export class ProjectStorageService {
  private readonly basePath: string;
  // In-memory storage for active room projects (roomId -> project data)
  private readonly roomProjects: Map<string, {
    projectData: any;
    projectName: string;
    uploadedBy: string;
    uploadedAt: Date;
  }> = new Map();

  constructor(basePath: string = path.join(process.cwd(), 'record-audio')) {
    this.basePath = basePath;
  }

  /**
   * Get the storage path for a user's projects
   */
  private getUserPath(userId: string): string {
    return path.join(this.basePath, userId);
  }

  /**
   * Get the storage path for a specific project
   */
  private getProjectPath(userId: string, projectId: string): string {
    return path.join(this.getUserPath(userId), projectId);
  }

  /**
   * Ensure directory exists
   */
  private async ensureDirectory(dirPath: string): Promise<void> {
    try {
      await fs.access(dirPath);
    } catch {
      await fs.mkdir(dirPath, { recursive: true });
    }
  }

  /**
   * Save project files to disk
   * Structure: {userId}/{projectId}/project.json and {userId}/{projectId}/audio/
   */
  async saveProjectFiles(
    userId: string,
    projectId: string,
    projectData: {
      projectJson: string;
      audioFiles?: Array<{ fileName: string; buffer: Buffer }>;
    }
  ): Promise<void> {
    const projectPath = this.getProjectPath(userId, projectId);
    const audioPath = path.join(projectPath, 'audio');

    // Ensure directories exist
    await this.ensureDirectory(projectPath);
    await this.ensureDirectory(audioPath);

    // Save project.json
    const projectJsonPath = path.join(projectPath, 'project.json');
    await fs.writeFile(projectJsonPath, projectData.projectJson, 'utf-8');

    // Save audio files if any
    if (projectData.audioFiles && projectData.audioFiles.length > 0) {
      for (const audioFile of projectData.audioFiles) {
        const audioFilePath = path.join(audioPath, audioFile.fileName);
        await fs.writeFile(audioFilePath, audioFile.buffer);
      }
    }
  }

  /**
   * Load project files from disk
   */
  async loadProjectFiles(
    userId: string,
    projectId: string
  ): Promise<{
    projectJson: string;
    audioFiles: Array<{ fileName: string; buffer: Buffer }>;
  }> {
    const projectPath = this.getProjectPath(userId, projectId);
    const audioPath = path.join(projectPath, 'audio');

    // Load project.json
    const projectJsonPath = path.join(projectPath, 'project.json');
    const projectJson = await fs.readFile(projectJsonPath, 'utf-8');

    // Load audio files
    const audioFiles: Array<{ fileName: string; buffer: Buffer }> = [];
    try {
      const audioFilesList = await fs.readdir(audioPath);
      for (const fileName of audioFilesList) {
        const audioFilePath = path.join(audioPath, fileName);
        const buffer = await fs.readFile(audioFilePath);
        audioFiles.push({ fileName, buffer });
      }
    } catch (error) {
      // Audio directory might not exist, that's okay
      console.log(`No audio files found for project ${projectId}`);
    }

    return { projectJson, audioFiles };
  }

  /**
   * Delete project files from disk
   */
  async deleteProjectFiles(userId: string, projectId: string): Promise<void> {
    const projectPath = this.getProjectPath(userId, projectId);
    try {
      await fs.rm(projectPath, { recursive: true, force: true });
    } catch (error) {
      console.error(`Failed to delete project files: ${error}`);
      // Don't throw, just log - the database record will be deleted anyway
    }
  }

  /**
   * Check if project files exist
   */
  async projectFilesExist(userId: string, projectId: string): Promise<boolean> {
    const projectPath = this.getProjectPath(userId, projectId);
    const projectJsonPath = path.join(projectPath, 'project.json');
    try {
      await fs.access(projectJsonPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Save project in memory for a room (used by ProjectController)
   * This is for active room projects, not saved user projects
   */
  saveProject(roomId: string, projectData: any, uploadedBy: string): void {
    this.roomProjects.set(roomId, {
      projectData,
      projectName: projectData.metadata?.name || 'Untitled Project',
      uploadedBy,
      uploadedAt: new Date(),
    });
  }

  /**
   * Get project from memory for a room (used by ProjectController)
   * This is for active room projects, not saved user projects
   */
  getProject(roomId: string): {
    projectData: any;
    projectName: string;
    uploadedBy: string;
    uploadedAt: Date;
  } | null {
    return this.roomProjects.get(roomId) || null;
  }

  /**
   * Delete project from memory for a room
   */
  deleteRoomProject(roomId: string): void {
    this.roomProjects.delete(roomId);
  }
}

export const projectStorageService = new ProjectStorageService();
