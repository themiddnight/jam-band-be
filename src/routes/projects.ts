import { Router, Response, type Router as RouterType } from 'express';
import { projectStorageService } from '../services/ProjectStorageService';
import { audioCompressionService } from '../services/AudioCompressionService';
import { authenticateToken, AuthRequest } from '../domains/auth/infrastructure/middleware/authMiddleware';
import { prisma } from '../domains/auth/infrastructure/db/prisma';
import { getProjectLimit, isProjectLimitReached, UserType } from '../constants/projectLimits';

const router: RouterType = Router();

/**
 * GET /api/projects
 * Get all saved projects for the authenticated user
 */
// @ts-expect-error - Type compatibility issue with Express middleware
router.get('/', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const projects = await prisma.savedProject.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        name: true,
        roomType: true,
        metadata: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    res.json({ projects });
    return;
  } catch (error) {
    console.error('Error fetching projects:', error);
    res.status(500).json({ error: 'Failed to fetch projects' });
  }
});

/**
 * GET /api/projects/:id
 * Get a specific project by ID
 */
// @ts-expect-error - Type compatibility issue with Express middleware
router.get('/:id', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    const projectId = req.params.id;

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    if (!projectId) {
      res.status(400).json({ error: 'Project ID required' });
      return;
    }

    const project = await prisma.savedProject.findFirst({
      where: {
        id: projectId,
        userId, // Ensure user owns this project
      },
    });

    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    // Load project files from disk
    try {
      const { projectJson, audioFiles } = await projectStorageService.loadProjectFiles(
        userId,
        projectId
      );

      // Parse project JSON
      const projectData = JSON.parse(projectJson);

      // Convert audio files to base64 for transmission
      const audioFilesBase64 = audioFiles.map((file) => ({
        fileName: file.fileName,
        data: file.buffer.toString('base64'),
      }));

      res.json({
        project: {
          id: project.id,
          name: project.name,
          roomType: project.roomType,
          metadata: project.metadata,
          createdAt: project.createdAt,
          updatedAt: project.updatedAt,
        },
        projectData,
        audioFiles: audioFilesBase64,
      });
      return;
    } catch (fileError) {
      console.error('Error loading project files:', fileError);
      res.status(500).json({ error: 'Failed to load project files' });
      return;
    }
  } catch (error) {
    console.error('Error fetching project:', error);
    res.status(500).json({ error: 'Failed to fetch project' });
    return;
  }
});

/**
 * POST /api/projects
 * Save a new project
 */
// @ts-expect-error - Type compatibility issue with Express middleware
router.post('/', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { name, roomType, projectData, metadata, audioFiles } = req.body;

    // Validate input
    if (!name || !roomType || !projectData) {
      res.status(400).json({ error: 'Missing required fields: name, roomType, projectData' });
      return;
    }

    if (roomType !== 'perform' && roomType !== 'arrange') {
      res.status(400).json({ error: 'Invalid roomType. Must be "perform" or "arrange"' });
      return;
    }

    // Check project limit based on user type
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { userType: true },
    });

    const userType = (user?.userType as UserType) || UserType.REGISTERED;
    const existingProjects = await prisma.savedProject.findMany({
      where: { userId },
    });

    if (isProjectLimitReached(existingProjects.length, userType)) {
      const limit = getProjectLimit(userType);
      res.status(403).json({
        error: 'Project limit reached',
        message: `You can only save up to ${limit === Infinity ? 'unlimited' : limit} project${limit > 1 ? 's' : ''}. Please delete an existing project first.`,
        projects: existingProjects.map((p: { id: string; name: string; roomType: string; createdAt: Date; updatedAt: Date }) => ({
          id: p.id,
          name: p.name,
          roomType: p.roomType,
          createdAt: p.createdAt,
          updatedAt: p.updatedAt,
        })),
      });
      return;
    }

    // Create project record
    const project = await prisma.savedProject.create({
      data: {
        userId,
        name: name.trim(),
        roomType,
        projectData: projectData as any,
        metadata: metadata || {},
      },
    });

    // Save project files to disk
    try {
      const projectJson = JSON.stringify(projectData, null, 2);
      
      // Convert base64 to buffers
      const audioFilesBuffers =
        audioFiles?.map((file: { fileName: string; data: string }) => ({
          fileName: file.fileName,
          buffer: Buffer.from(file.data, 'base64'),
        })) || [];

      // Compress audio files to Opus/WebM format (320kbps)
      const compressedAudioFiles = audioFilesBuffers.length > 0
        ? await audioCompressionService.compressAudioFiles(audioFilesBuffers)
        : [];

      await projectStorageService.saveProjectFiles(userId, project.id, {
        projectJson,
        audioFiles: compressedAudioFiles,
      });
    } catch (fileError) {
      console.error('Error saving project files:', fileError);
      // Delete the database record if file save fails
      await prisma.savedProject.delete({ where: { id: project.id } });
      res.status(500).json({ error: 'Failed to save project files' });
      return;
    }

    res.status(201).json({
      project: {
        id: project.id,
        name: project.name,
        roomType: project.roomType,
        metadata: project.metadata,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
      },
    });
    return;
  } catch (error) {
    console.error('Error saving project:', error);
    res.status(500).json({ error: 'Failed to save project' });
    return;
  }
});

/**
 * PUT /api/projects/:id
 * Update an existing project (save over)
 */
// @ts-expect-error - Type compatibility issue with Express middleware
router.put('/:id', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    const projectId = req.params.id;

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    if (!projectId) {
      res.status(400).json({ error: 'Project ID required' });
      return;
    }

    const { projectData, audioFiles } = req.body;

    // Validate input
    if (!projectData) {
      res.status(400).json({ error: 'Missing required field: projectData' });
      return;
    }

    // Check if project exists and user owns it
    const project = await prisma.savedProject.findFirst({
      where: {
        id: projectId,
        userId,
      },
    });

    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    // Update project record
    const updatedProject = await prisma.savedProject.update({
      where: { id: projectId },
      data: {
        projectData: projectData as any,
        updatedAt: new Date(),
      },
    });

    // Update project files on disk
    try {
      // Note: Backblaze bucket is configured to keep only the latest version,
      // so old versions are automatically cleaned up when new files are uploaded
      const projectJson = JSON.stringify(projectData, null, 2);
      
      // Convert base64 to buffers
      const audioFilesBuffers =
        audioFiles?.map((file: { fileName: string; data: string }) => ({
          fileName: file.fileName,
          buffer: Buffer.from(file.data, 'base64'),
        })) || [];

      // Compress audio files to Opus/WebM format (320kbps)
      const compressedAudioFiles = audioFilesBuffers.length > 0
        ? await audioCompressionService.compressAudioFiles(audioFilesBuffers)
        : [];

      await projectStorageService.saveProjectFiles(userId, projectId, {
        projectJson,
        audioFiles: compressedAudioFiles,
      });
    } catch (fileError) {
      console.error('Error updating project files:', fileError);
      res.status(500).json({ error: 'Failed to update project files' });
      return;
    }

    res.json({
      project: {
        id: updatedProject.id,
        name: updatedProject.name,
        roomType: updatedProject.roomType,
        metadata: updatedProject.metadata,
        createdAt: updatedProject.createdAt,
        updatedAt: updatedProject.updatedAt,
      },
    });
    return;
  } catch (error) {
    console.error('Error updating project:', error);
    res.status(500).json({ error: 'Failed to update project' });
    return;
  }
});

/**
 * DELETE /api/projects/:id
 * Delete a project
 */
// @ts-expect-error - Type compatibility issue with Express middleware
router.delete('/:id', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    const projectId = req.params.id;

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    if (!projectId) {
      res.status(400).json({ error: 'Project ID required' });
      return;
    }

    // Check if project exists and user owns it
    const project = await prisma.savedProject.findFirst({
      where: {
        id: projectId,
        userId,
      },
    });

    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    // Delete project files from disk
    await projectStorageService.deleteProjectFiles(userId, projectId);

    // Delete project record
    await prisma.savedProject.delete({
      where: { id: projectId },
    });

    res.json({ message: 'Project deleted successfully' });
    return;
  } catch (error) {
    console.error('Error deleting project:', error);
    res.status(500).json({ error: 'Failed to delete project' });
    return;
  }
});

export default router;

