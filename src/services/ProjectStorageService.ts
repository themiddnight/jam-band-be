import fs from 'fs/promises';
import path from 'path';
import { config } from '../config/environment';
import { BackblazeStorageAdapter } from './storage/BackblazeStorageAdapter';
import { loggingService } from './LoggingService';
import type { StorageAdapter } from './storage/StorageAdapter';

/**
 * Service for managing saved project files on disk or cloud storage
 * Stores projects in /record-audio/{userId}/{projectId}/ (local) or projects/{userId}/{projectId}/ (Backblaze)
 * Also manages in-memory project storage for active rooms
 */
export class ProjectStorageService {
  private readonly basePath: string;
  private readonly storageAdapter: StorageAdapter | null;
  // In-memory storage for active room projects (roomId -> project data)
  private readonly roomProjects: Map<string, {
    projectData: any;
    projectName: string;
    uploadedBy: string;
    uploadedAt: Date;
  }> = new Map();

  constructor(basePath: string = path.join(process.cwd(), 'record-audio')) {
    this.basePath = basePath;

    // Initialize Backblaze adapter if enabled
    if (config.storage.backblaze?.enabled) {
      try {
        this.storageAdapter = new BackblazeStorageAdapter();
      } catch (error) {
        console.error('Failed to initialize Backblaze storage, falling back to local storage', error);
        this.storageAdapter = null;
      }
    } else {
      this.storageAdapter = null;
    }
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
   * Get the storage key for a project file in Backblaze
   */
  private getProjectKey(userId: string, projectId: string, fileName: string): string {
    return `projects/${userId}/${projectId}/${fileName}`;
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
   * Save project files to disk or cloud storage
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
    if (this.storageAdapter) {
      // Use Backblaze storage
      const projectJsonKey = this.getProjectKey(userId, projectId, 'project.json');
      await this.storageAdapter.saveFile(
        projectJsonKey,
        Buffer.from(projectData.projectJson, 'utf-8'),
        'application/json'
      );

      // Save audio files if any
      if (projectData.audioFiles && projectData.audioFiles.length > 0) {
        for (const audioFile of projectData.audioFiles) {
          const audioKey = this.getProjectKey(userId, projectId, `audio/${audioFile.fileName}`);
          await this.storageAdapter.saveFile(
            audioKey,
            audioFile.buffer,
            'application/octet-stream'
          );
        }
      }
    } else {
      // Fallback to local storage
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
  }

  /**
   * Load project files from disk or cloud storage
   */
  async loadProjectFiles(
    userId: string,
    projectId: string
  ): Promise<{
    projectJson: string;
    audioFiles: Array<{ fileName: string; buffer: Buffer }>;
  }> {
    if (this.storageAdapter) {
      // Use Backblaze storage
      const projectJsonKey = this.getProjectKey(userId, projectId, 'project.json');
      const projectJsonBuffer = await this.storageAdapter.getFile(projectJsonKey);

      if (!projectJsonBuffer) {
        throw new Error(`Project not found: ${projectId}`);
      }

      const projectJson = projectJsonBuffer.toString('utf-8');

      // Load audio files
      const audioFiles: Array<{ fileName: string; buffer: Buffer }> = [];
      const audioPrefix = this.getProjectKey(userId, projectId, 'audio/');
      const audioKeys = await this.storageAdapter.listFiles(audioPrefix);

      for (const key of audioKeys) {
        const buffer = await this.storageAdapter.getFile(key);
        if (buffer) {
          const fileName = key.replace(audioPrefix, '');
          audioFiles.push({ fileName, buffer });
        }
      }

      return { projectJson, audioFiles };
    } else {
      // Fallback to local storage
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
      } catch {
        // Audio directory might not exist, that's okay
        console.log(`No audio files found for project ${projectId}`);
      }

      return { projectJson, audioFiles };
    }
  }

  /**
   * Delete all old project files including all versions (used when updating/saving over existing project)
   * This deletes project.json and all audio files, including all versions in Backblaze
   * 
   * NOTE: For Backblaze buckets configured with "Keep only the last version" lifecycle setting,
   * this method is not necessary as old versions are automatically cleaned up when new files are uploaded.
   * This method is primarily useful for local storage or manual cleanup scenarios.
   */
  async deleteAllOldProjectFiles(userId: string, projectId: string): Promise<void> {
    if (this.storageAdapter) {
      // Use Backblaze storage - delete all files and versions with prefix
      const prefix = `projects/${userId}/${projectId}/`;
      
      try {
        // Use listFileVersions to get both regular files and delete markers
        const backblazeAdapter = this.storageAdapter as any;
        if (backblazeAdapter.listFileVersions) {
          const fileVersions = await backblazeAdapter.listFileVersions(prefix);
          
          if (fileVersions.length === 0) {
            loggingService.logInfo('No old project files or versions found to delete in Backblaze', {
              userId,
              projectId,
              prefix,
            });
            return;
          }

          loggingService.logInfo('Deleting all old project files and versions from Backblaze', {
            userId,
            projectId,
            totalVersions: fileVersions.length,
            deleteMarkers: fileVersions.filter((v: { key: string; versionId?: string; isDeleteMarker?: boolean }) => v.isDeleteMarker).length,
            regularFiles: fileVersions.filter((v: { key: string; versionId?: string; isDeleteMarker?: boolean }) => !v.isDeleteMarker).length,
          });

          // Delete all versions including delete markers
          const deleteResults = await Promise.allSettled(
            fileVersions.map((fileVersion: { key: string; versionId?: string; isDeleteMarker?: boolean }) => 
              backblazeAdapter.deleteFileVersion(fileVersion.key, fileVersion.versionId)
            )
          );

          // Check for failures
          const failures = deleteResults.filter((r) => r.status === 'rejected');
          if (failures.length > 0) {
            loggingService.logError(
              new Error(`Failed to delete ${failures.length} file version(s) from Backblaze`),
              {
                context: 'ProjectStorageService',
                userId,
                projectId,
                totalVersions: fileVersions.length,
                failedCount: failures.length,
                errors: failures
                  .map((failure) => failure.reason)
                  .filter(Boolean),
              }
            );
          } else {
            loggingService.logInfo('Successfully deleted all old project files and versions from Backblaze', {
              userId,
              projectId,
              totalVersions: fileVersions.length,
            });
          }
        } else {
          // Fallback to regular listFiles if listFileVersions is not available
          const files = await this.storageAdapter.listFiles(prefix);
          
          if (files.length === 0) {
            loggingService.logInfo('No old project files found to delete in Backblaze', {
              userId,
              projectId,
              prefix,
            });
            return;
          }

          loggingService.logInfo('Deleting all old project files from Backblaze', {
            userId,
            projectId,
            fileCount: files.length,
            files: files.map((filePath: string) => path.basename(filePath)),
          });

          // Delete all files
          const deleteResults = await Promise.allSettled(
            files.map((fileKey: string) => this.storageAdapter!.deleteFile(fileKey))
          );

          // Check for failures
          const failures = deleteResults.filter(
            (result: PromiseSettledResult<unknown>): result is PromiseRejectedResult => result.status === 'rejected'
          );
          if (failures.length > 0) {
            const errorReasons = failures
              .map((failure: PromiseRejectedResult) => failure.reason)
              .filter((reason: unknown): reason is unknown => Boolean(reason));
            loggingService.logError(
              new Error(`Failed to delete ${failures.length} file(s) from Backblaze`),
              {
                context: 'ProjectStorageService',
                userId,
                projectId,
                totalFiles: files.length,
                failedCount: failures.length,
                errors: errorReasons,
              }
            );
          } else {
            loggingService.logInfo('Successfully deleted all old project files from Backblaze', {
              userId,
              projectId,
              fileCount: files.length,
            });
          }
        }
      } catch (error) {
        loggingService.logError(
          error instanceof Error ? error : new Error('Failed to delete old project files from Backblaze'),
          { context: 'ProjectStorageService', userId, projectId, prefix }
        );
        // Don't throw - continue with saving new files
      }
    } else {
      // Fallback to local storage - delete entire project directory
      const projectPath = this.getProjectPath(userId, projectId);
      try {
        // Check if directory exists
        try {
          await fs.access(projectPath);
        } catch {
          // Directory doesn't exist, nothing to delete
          loggingService.logInfo('No old project files found to delete in local storage (directory does not exist)', {
            userId,
            projectId,
            path: projectPath,
          });
          return;
        }

        // Delete entire project directory (will be recreated when saving)
        await fs.rm(projectPath, { recursive: true, force: true });
        
        loggingService.logInfo('Successfully deleted all old project files from local storage', {
          userId,
          projectId,
          path: projectPath,
        });
      } catch (error) {
        loggingService.logError(
          error instanceof Error ? error : new Error('Failed to delete old project files from local storage'),
          { context: 'ProjectStorageService', userId, projectId, path: projectPath }
        );
        // Don't throw - continue with saving new files
      }
    }
  }

  /**
   * Delete old audio files from a project (used when updating/saving over existing project)
   * @deprecated Use deleteAllOldProjectFiles instead to delete all files including versions
   */
  async deleteOldAudioFiles(userId: string, projectId: string): Promise<void> {
    if (this.storageAdapter) {
      // Use Backblaze storage - delete all audio files
      const audioPrefix = this.getProjectKey(userId, projectId, 'audio/');
      
      try {
        const audioKeys = await this.storageAdapter.listFiles(audioPrefix);
        
        if (audioKeys.length === 0) {
          loggingService.logInfo('No old audio files found to delete in Backblaze', {
            userId,
            projectId,
            prefix: audioPrefix,
          });
          return;
        }

        loggingService.logInfo('Deleting old audio files from Backblaze', {
          userId,
          projectId,
          fileCount: audioKeys.length,
          files: audioKeys.map((filePath: string) => path.basename(filePath)),
        });

        // Delete all audio files
        const deleteResults = await Promise.allSettled(
          audioKeys.map((fileKey: string) => this.storageAdapter!.deleteFile(fileKey))
        );

        // Check for failures
        const failures = deleteResults.filter(
          (result: PromiseSettledResult<unknown>): result is PromiseRejectedResult => result.status === 'rejected'
        );
        if (failures.length > 0) {
          const errorReasons = failures
            .map((failure: PromiseRejectedResult) => failure.reason)
            .filter((reason: unknown): reason is unknown => Boolean(reason));
          loggingService.logError(
            new Error(`Failed to delete ${failures.length} old audio file(s) from Backblaze`),
            {
              context: 'ProjectStorageService',
              userId,
              projectId,
              totalFiles: audioKeys.length,
              failedCount: failures.length,
              errors: errorReasons,
            }
          );
        } else {
          loggingService.logInfo('Successfully deleted all old audio files from Backblaze', {
            userId,
            projectId,
            fileCount: audioKeys.length,
          });
        }
      } catch (error) {
        loggingService.logError(
          error instanceof Error ? error : new Error('Failed to delete old audio files from Backblaze'),
          { context: 'ProjectStorageService', userId, projectId, prefix: audioPrefix }
        );
        // Don't throw - continue with saving new files
      }
    } else {
      // Fallback to local storage
      const audioPath = path.join(this.getProjectPath(userId, projectId), 'audio');
      try {
        const files = await fs.readdir(audioPath);
        if (files.length === 0) {
          loggingService.logInfo('No old audio files found to delete in local storage', {
            userId,
            projectId,
            path: audioPath,
          });
          return;
        }

        loggingService.logInfo('Deleting old audio files from local storage', {
          userId,
          projectId,
          fileCount: files.length,
          files,
        });

        // Delete all audio files
        await Promise.all(
          files.map((fileName) => 
            fs.unlink(path.join(audioPath, fileName))
          )
        );

        loggingService.logInfo('Successfully deleted all old audio files from local storage', {
          userId,
          projectId,
          fileCount: files.length,
        });
      } catch (error: any) {
        // If directory doesn't exist, that's okay (no old files to delete)
        if (error.code !== 'ENOENT') {
          loggingService.logError(
            error instanceof Error ? error : new Error('Failed to delete old audio files from local storage'),
            { context: 'ProjectStorageService', userId, projectId, path: audioPath }
          );
        }
        // Don't throw - continue with saving new files
      }
    }
  }

  /**
   * Delete project files from disk or cloud storage
   */
  async deleteProjectFiles(userId: string, projectId: string): Promise<void> {
    if (this.storageAdapter) {
      // Use Backblaze storage - delete all files with prefix including delete markers
      const prefix = `projects/${userId}/${projectId}/`;
      
      try {
        // Use listFileVersions to get both regular files and delete markers
        const backblazeAdapter = this.storageAdapter as any;
        if (backblazeAdapter.listFileVersions) {
          const fileVersions = await backblazeAdapter.listFileVersions(prefix);
          
          if (fileVersions.length === 0) {
            loggingService.logInfo('No files or versions found to delete in Backblaze', {
              userId,
              projectId,
              prefix,
            });
            return;
          }

          loggingService.logInfo('Deleting project files and versions from Backblaze', {
            userId,
            projectId,
            totalVersions: fileVersions.length,
            deleteMarkers: fileVersions.filter((v: { key: string; versionId?: string; isDeleteMarker?: boolean }) => v.isDeleteMarker).length,
            regularFiles: fileVersions.filter((v: { key: string; versionId?: string; isDeleteMarker?: boolean }) => !v.isDeleteMarker).length,
          });

          // Delete all versions including delete markers
          const deleteResults = await Promise.allSettled(
            fileVersions.map((fileVersion: { key: string; versionId?: string; isDeleteMarker?: boolean }) => 
              backblazeAdapter.deleteFileVersion(fileVersion.key, fileVersion.versionId)
            )
          );

          // Check for failures
          const failures = deleteResults.filter((r) => r.status === 'rejected');
          if (failures.length > 0) {
            loggingService.logError(
              new Error(`Failed to delete ${failures.length} file version(s) from Backblaze`),
              {
                context: 'ProjectStorageService',
                userId,
                projectId,
                totalVersions: fileVersions.length,
                failedCount: failures.length,
                errors: failures.map((f) => 
                  f.status === 'rejected' ? f.reason : null
                ).filter(Boolean),
              }
            );
          } else {
            loggingService.logInfo('Successfully deleted all project files and versions from Backblaze', {
              userId,
              projectId,
              totalVersions: fileVersions.length,
            });
          }
        } else {
          // Fallback to regular listFiles if listFileVersions is not available
          const files = await this.storageAdapter.listFiles(prefix);
          
          if (files.length === 0) {
            loggingService.logInfo('No files found to delete in Backblaze', {
              userId,
              projectId,
              prefix,
            });
            return;
          }

          loggingService.logInfo('Deleting project files from Backblaze', {
            userId,
            projectId,
            fileCount: files.length,
            files: files.map((filePath: string) => path.basename(filePath)),
          });

          // Delete all files
          const deleteResults = await Promise.allSettled(
            files.map((fileKey: string) => this.storageAdapter!.deleteFile(fileKey))
          );

          // Check for failures
          const failures = deleteResults.filter(
            (result: PromiseSettledResult<unknown>): result is PromiseRejectedResult => result.status === 'rejected'
          );
          if (failures.length > 0) {
            const errorReasons = failures
              .map((failure: PromiseRejectedResult) => failure.reason)
              .filter((reason: unknown): reason is unknown => Boolean(reason));
            loggingService.logError(
              new Error(`Failed to delete ${failures.length} file(s) from Backblaze`),
              {
                context: 'ProjectStorageService',
                userId,
                projectId,
                totalFiles: files.length,
                failedCount: failures.length,
                errors: errorReasons,
              }
            );
          } else {
            loggingService.logInfo('Successfully deleted all project files from Backblaze', {
              userId,
              projectId,
              fileCount: files.length,
            });
          }
        }
      } catch (error) {
        loggingService.logError(
          error instanceof Error ? error : new Error('Failed to list files for deletion in Backblaze'),
          { context: 'ProjectStorageService', userId, projectId, prefix }
        );
        // Don't throw - continue with database deletion
      }
    } else {
      // Fallback to local storage
      const projectPath = this.getProjectPath(userId, projectId);
      try {
        await fs.rm(projectPath, { recursive: true, force: true });
        loggingService.logInfo('Successfully deleted project files from local storage', {
          userId,
          projectId,
          path: projectPath,
        });
      } catch (error) {
        loggingService.logError(
          error instanceof Error ? error : new Error('Failed to delete project files from local storage'),
          { context: 'ProjectStorageService', userId, projectId, path: projectPath }
        );
        // Don't throw, just log - the database record will be deleted anyway
      }
    }
  }

  /**
   * Check if project files exist
   */
  async projectFilesExist(userId: string, projectId: string): Promise<boolean> {
    if (this.storageAdapter) {
      // Use Backblaze storage
      const projectJsonKey = this.getProjectKey(userId, projectId, 'project.json');
      return await this.storageAdapter.fileExists(projectJsonKey);
    } else {
      // Fallback to local storage
      const projectPath = this.getProjectPath(userId, projectId);
      const projectJsonPath = path.join(projectPath, 'project.json');
      try {
        await fs.access(projectJsonPath);
        return true;
      } catch {
        return false;
      }
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
