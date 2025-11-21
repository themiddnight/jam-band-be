import { Request, Response } from 'express';
import JSZip from 'jszip';
import fs from 'fs';
import path from 'path';
import { AudioRegionStorageService } from '../../../../services/AudioRegionStorageService';
import { projectStorageService } from '../../../../services/ProjectStorageService';
import { ArrangeRoomStateService } from '../../../../services/ArrangeRoomStateService';
import { loggingService } from '../../../../services/LoggingService';
import { Server as SocketIOServer } from 'socket.io';

export class ProjectController {
  constructor(
    private audioStorage: AudioRegionStorageService,
    private arrangeRoomStateService: ArrangeRoomStateService,
    private io?: SocketIOServer
  ) {}

  /**
   * Upload and distribute a project file to all users in the room
   */
  uploadProject = async (req: Request, res: Response): Promise<void> => {
    const { roomId } = req.params;
    const file = req.file;
    const userId = req.body.userId;
    const username = req.body.username;

    if (!roomId || !file) {
      res.status(400).json({ success: false, message: 'Project file is required' });
      return;
    }

    if (!userId || !username) {
      res.status(400).json({ success: false, message: 'User information is required' });
      return;
    }

    try {
      // 1. Read and extract the .collab zip file
      const zipBuffer = await fs.promises.readFile(file.path);
      const zip = await JSZip.loadAsync(zipBuffer);

      // 2. Extract project.json
      const projectJsonFile = zip.file('project.json');
      if (!projectJsonFile) {
        res.status(400).json({ success: false, message: 'Invalid project file: project.json not found' });
        return;
      }

      const projectJsonText = await projectJsonFile.async('text');
      const projectData = JSON.parse(projectJsonText);

      // 3. Extract and save audio files
      const audioFolder = zip.folder('audio');
      const savedAudioFiles: string[] = [];

      if (audioFolder) {
        const audioFiles = Object.keys(zip.files).filter((filePath) =>
          filePath.startsWith('audio/') && !filePath.endsWith('/')
        );

        for (const audioPath of audioFiles) {
          const audioFile = zip.file(audioPath);
          if (audioFile) {
            const audioBuffer = await audioFile.async('nodebuffer');
            
            // Extract region ID from filename (e.g., "audio/region-123.webm" -> "region-123")
            const fileName = path.basename(audioPath);
            const regionId = fileName.replace(/\.(webm|wav)$/, '');

            // Save to temporary file
            const tempPath = path.join(file.destination, `${Date.now()}-${fileName}`);
            await fs.promises.writeFile(tempPath, audioBuffer);

            try {
              // Save using AudioRegionStorageService (converts to opus)
              const result = await this.audioStorage.saveRegionAudio({
                roomId,
                regionId,
                sourcePath: tempPath,
                originalName: fileName,
              });

              loggingService.logInfo('Audio region saved successfully', {
                roomId,
                regionId,
                filePath: result.filePath,
                sizeBytes: result.sizeBytes,
              });

              savedAudioFiles.push(regionId);

              // Clean up temp file
              await fs.promises.unlink(tempPath).catch(() => {});
            } catch (error) {
              loggingService.logError(error as Error, {
                context: 'ProjectController:uploadProject:saveAudio',
                roomId,
                regionId,
                tempPath,
              });
            }
          }
        }
      }

      // 4. Update audio URLs in project data to point to server
      if (projectData.regions) {
        projectData.regions = projectData.regions.map((region: any) => {
          if (region.type === 'audio' && region.audioFileRef) {
            const regionId = region.id;
            return {
              ...region,
              audioUrl: this.audioStorage.getRegionPlaybackPath(roomId, regionId),
            };
          }
          return region;
        });
      }

      // 5. Clean up old audio files from previous project (if any)
      try {
        const existingState = this.arrangeRoomStateService.getState(roomId);
        if (existingState) {
          const oldAudioRegions = existingState.regions.filter((r: any) => r.type === 'audio');
          loggingService.logInfo('Cleaning up old audio files', {
            roomId,
            oldAudioRegionCount: oldAudioRegions.length,
            oldRegionIds: oldAudioRegions.map((r: any) => r.id),
          });
          for (const region of oldAudioRegions) {
            await this.audioStorage.deleteRegionAudio(roomId, region.id).catch(() => {});
          }
        }
      } catch (error) {
        loggingService.logError(error as Error, {
          context: 'ProjectController:uploadProject:cleanup',
          roomId,
        });
      }

      // 6. Update ArrangeRoomStateService with project data
      const state = this.arrangeRoomStateService.getState(roomId);
      if (!state) {
        this.arrangeRoomStateService.initializeState(roomId);
      }

      // Clear existing state and set new project data
      this.arrangeRoomStateService.updateState(roomId, {
        tracks: projectData.tracks || [],
        regions: projectData.regions || [],
        bpm: projectData.project?.bpm || 120,
        timeSignature: projectData.project?.timeSignature || { numerator: 4, denominator: 4 },
        synthStates: {},
        selectedTrackId: null,
        selectedRegionIds: [],
      });

      // 7. Save project metadata in memory
      projectStorageService.saveProject(roomId, projectData, username);

      // 8. Broadcast project to all users in the room via WebSocket
      if (this.io) {
        // Emit to the room namespace (not /arrange namespace)
        const roomNamespace = this.io.of(`/room/${roomId}`);
        roomNamespace.to(roomId).emit('arrange:project_loaded', {
          projectData,
          uploadedBy: username,
          uploadedAt: new Date().toISOString(),
        });

        loggingService.logInfo('Project broadcasted to room', {
          roomId,
          projectName: projectData.metadata?.name,
          uploadedBy: username,
          audioFilesCount: savedAudioFiles.length,
        });
      }

      // 9. Clean up uploaded file
      await fs.promises.unlink(file.path).catch(() => {});

      res.status(200).json({
        success: true,
        message: 'Project uploaded and distributed successfully',
        projectName: projectData.metadata?.name,
        audioFilesCount: savedAudioFiles.length,
      });
    } catch (error) {
      loggingService.logError(error as Error, {
        context: 'ProjectController:uploadProject',
        roomId,
      });

      // Clean up uploaded file on error
      if (file?.path) {
        await fs.promises.unlink(file.path).catch(() => {});
      }

      res.status(500).json({
        success: false,
        message: 'Failed to upload project',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  /**
   * Get current project for a room
   */
  getProject = async (req: Request, res: Response): Promise<void> => {
    const { roomId } = req.params;

    if (!roomId) {
      res.status(400).json({ success: false, message: 'Room ID is required' });
      return;
    }

    try {
      const project = projectStorageService.getProject(roomId);

      if (!project) {
        res.status(404).json({ success: false, message: 'No project found for this room' });
        return;
      }

      res.status(200).json({
        success: true,
        project: project.projectData,
        metadata: {
          projectName: project.projectName,
          uploadedBy: project.uploadedBy,
          uploadedAt: project.uploadedAt,
        },
      });
    } catch (error) {
      loggingService.logError(error as Error, {
        context: 'ProjectController:getProject',
        roomId,
      });

      res.status(500).json({
        success: false,
        message: 'Failed to get project',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };
}
