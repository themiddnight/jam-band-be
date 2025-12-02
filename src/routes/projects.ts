import { Router, Request, Response } from 'express';
import { projectStorageService } from '../services/ProjectStorageService';
import { authenticateToken, AuthRequest } from '../domains/auth/infrastructure/middleware/authMiddleware';
import { prisma } from '../domains/auth/infrastructure/db/prisma';

const router = Router();

const MAX_PROJECTS_PER_USER = 2;

/**
 * GET /api/projects
 * Get all saved projects for the authenticated user
 */
router.get('/', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
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
  } catch (error) {
    console.error('Error fetching projects:', error);
    res.status(500).json({ error: 'Failed to fetch projects' });
  }
});

/**
 * GET /api/projects/:id
 * Get a specific project by ID
 */
router.get('/:id', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    const projectId = req.params.id;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const project = await prisma.savedProject.findFirst({
      where: {
        id: projectId,
        userId, // Ensure user owns this project
      },
    });

    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
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
    } catch (fileError) {
      console.error('Error loading project files:', fileError);
      res.status(500).json({ error: 'Failed to load project files' });
    }
  } catch (error) {
    console.error('Error fetching project:', error);
    res.status(500).json({ error: 'Failed to fetch project' });
  }
});

/**
 * POST /api/projects
 * Save a new project
 */
router.post('/', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { name, roomType, projectData, metadata, audioFiles } = req.body;

    // Validate input
    if (!name || !roomType || !projectData) {
      return res.status(400).json({ error: 'Missing required fields: name, roomType, projectData' });
    }

    if (roomType !== 'perform' && roomType !== 'arrange') {
      return res.status(400).json({ error: 'Invalid roomType. Must be "perform" or "arrange"' });
    }

    // Check project limit
    const existingProjects = await prisma.savedProject.findMany({
      where: { userId },
    });

    if (existingProjects.length >= MAX_PROJECTS_PER_USER) {
      return res.status(403).json({
        error: 'Project limit reached',
        message: `You can only save up to ${MAX_PROJECTS_PER_USER} projects. Please delete an existing project first.`,
        projects: existingProjects.map((p) => ({
          id: p.id,
          name: p.name,
          roomType: p.roomType,
          createdAt: p.createdAt,
          updatedAt: p.updatedAt,
        })),
      });
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
      const audioFilesBuffers =
        audioFiles?.map((file: { fileName: string; data: string }) => ({
          fileName: file.fileName,
          buffer: Buffer.from(file.data, 'base64'),
        })) || [];

      await projectStorageService.saveProjectFiles(userId, project.id, {
        projectJson,
        audioFiles: audioFilesBuffers,
      });
    } catch (fileError) {
      console.error('Error saving project files:', fileError);
      // Delete the database record if file save fails
      await prisma.savedProject.delete({ where: { id: project.id } });
      return res.status(500).json({ error: 'Failed to save project files' });
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
  } catch (error) {
    console.error('Error saving project:', error);
    res.status(500).json({ error: 'Failed to save project' });
  }
});

/**
 * PUT /api/projects/:id
 * Update an existing project (save over)
 */
router.put('/:id', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    const projectId = req.params.id;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { projectData, audioFiles } = req.body;

    // Validate input
    if (!projectData) {
      return res.status(400).json({ error: 'Missing required field: projectData' });
    }

    // Check if project exists and user owns it
    const project = await prisma.savedProject.findFirst({
      where: {
        id: projectId,
        userId,
      },
    });

    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
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
      const projectJson = JSON.stringify(projectData, null, 2);
      const audioFilesBuffers =
        audioFiles?.map((file: { fileName: string; data: string }) => ({
          fileName: file.fileName,
          buffer: Buffer.from(file.data, 'base64'),
        })) || [];

      await projectStorageService.saveProjectFiles(userId, projectId, {
        projectJson,
        audioFiles: audioFilesBuffers,
      });
    } catch (fileError) {
      console.error('Error updating project files:', fileError);
      return res.status(500).json({ error: 'Failed to update project files' });
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
  } catch (error) {
    console.error('Error updating project:', error);
    res.status(500).json({ error: 'Failed to update project' });
  }
});

/**
 * DELETE /api/projects/:id
 * Delete a project
 */
router.delete('/:id', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    const projectId = req.params.id;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Check if project exists and user owns it
    const project = await prisma.savedProject.findFirst({
      where: {
        id: projectId,
        userId,
      },
    });

    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    // Delete project files from disk
    await projectStorageService.deleteProjectFiles(userId, projectId);

    // Delete project record
    await prisma.savedProject.delete({
      where: { id: projectId },
    });

    res.json({ message: 'Project deleted successfully' });
  } catch (error) {
    console.error('Error deleting project:', error);
    res.status(500).json({ error: 'Failed to delete project' });
  }
});

export default router;

