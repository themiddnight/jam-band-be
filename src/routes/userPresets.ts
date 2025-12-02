import { Router, type Router as RouterType } from 'express';
import { PresetType } from '@prisma/client';
import { authenticateToken, AuthRequest } from '../domains/auth/infrastructure/middleware/authMiddleware';
import { requireRegistered } from '../domains/auth/infrastructure/middleware/guestLimitations';
import { prisma } from '../domains/auth/infrastructure/db/prisma';

const router: RouterType = Router();

// Get all user presets (optionally filtered by type)
// @ts-expect-error - Type compatibility issue with Express middleware
router.get('/presets', authenticateToken, requireRegistered, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const { type } = req.query;
    const where: any = { userId: req.user.id };
    
    if (type && Object.values(PresetType).includes(type as PresetType)) {
      where.presetType = type;
    }

    const presets = await prisma.userPreset.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
    });

    res.json({ presets });
  } catch {
    res.status(500).json({ error: 'Failed to fetch presets' });
  }
});

// Save a new preset
// @ts-expect-error - Type compatibility issue with Express middleware
router.post('/presets', authenticateToken, requireRegistered, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const { presetType, name, data } = req.body;

    if (!presetType || !name || !data) {
      res.status(400).json({ error: 'presetType, name, and data are required' });
      return;
    }

    if (!Object.values(PresetType).includes(presetType)) {
      res.status(400).json({ error: 'Invalid preset type' });
      return;
    }

    const preset = await prisma.userPreset.create({
      data: {
        userId: req.user.id,
        presetType: presetType as PresetType,
        name,
        data,
      },
    });

    res.status(201).json({ preset });
  } catch {
    res.status(500).json({ error: 'Failed to save preset' });
  }
});

// Update a preset
// @ts-expect-error - Type compatibility issue with Express middleware
router.put('/presets/:id', authenticateToken, requireRegistered, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const { id } = req.params;
    if (!id) {
      res.status(400).json({ error: 'Preset ID required' });
      return;
    }

    const { name, data } = req.body;

    // Verify preset belongs to user
    const existing = await prisma.userPreset.findFirst({
      where: { id: id, userId: req.user.id },
    });

    if (!existing) {
      res.status(404).json({ error: 'Preset not found' });
      return;
    }

    const preset = await prisma.userPreset.update({
      where: { id: id },
      data: {
        ...(name && { name }),
        ...(data && { data }),
      },
    });

    res.json({ preset });
  } catch {
    res.status(500).json({ error: 'Failed to update preset' });
  }
});

// Delete a preset
// @ts-expect-error - Type compatibility issue with Express middleware
router.delete('/presets/:id', authenticateToken, requireRegistered, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const { id } = req.params;
    if (!id) {
      res.status(400).json({ error: 'Preset ID required' });
      return;
    }

    // Verify preset belongs to user
    const existing = await prisma.userPreset.findFirst({
      where: { id: id, userId: req.user.id },
    });

    if (!existing) {
      res.status(404).json({ error: 'Preset not found' });
      return;
    }

    await prisma.userPreset.delete({
      where: { id: id },
    });

    res.json({ message: 'Preset deleted' });
  } catch {
    res.status(500).json({ error: 'Failed to delete preset' });
  }
});

// Get user settings
// @ts-expect-error - Type compatibility issue with Express middleware
router.get('/settings', authenticateToken, requireRegistered, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const { type } = req.query;
    const where: any = { userId: req.user.id };
    
    if (type) {
      where.settingsType = type;
    }

    const settings = await prisma.userSettings.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
    });

    res.json({ settings });
  } catch {
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

// Update user settings
// @ts-expect-error - Type compatibility issue with Express middleware
router.put('/settings', authenticateToken, requireRegistered, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const { settingsType, data } = req.body;

    if (!settingsType || !data) {
      res.status(400).json({ error: 'settingsType and data are required' });
      return;
    }

    const settings = await prisma.userSettings.upsert({
      where: { userId: req.user.id },
      update: {
        settingsType,
        data,
      },
      create: {
        userId: req.user.id,
        settingsType,
        data,
      },
    });

    res.json({ settings });
  } catch {
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

// Update feedback state (submitted or dismissed)
// @ts-expect-error - Type compatibility issue with Express middleware
router.put('/feedback-state', authenticateToken, requireRegistered, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const { action } = req.body; // 'submitted' or 'dismissed'

    if (!action || !['submitted', 'dismissed'].includes(action)) {
      res.status(400).json({ error: 'action must be either "submitted" or "dismissed"' });
      return;
    }

    const updateData: any = {};
    if (action === 'submitted') {
      updateData.feedbackSubmittedAt = new Date();
    } else if (action === 'dismissed') {
      updateData.feedbackDismissedAt = new Date();
    }

    const user = await prisma.user.update({
      where: { id: req.user.id },
      data: updateData,
      select: {
        id: true,
        feedbackSubmittedAt: true,
        feedbackDismissedAt: true,
      },
    });

    res.json({ user });
  } catch (error) {
    console.error('Failed to update feedback state:', error);
    res.status(500).json({ error: 'Failed to update feedback state' });
  }
});

// Get feedback state
// @ts-expect-error - Type compatibility issue with Express middleware
router.get('/feedback-state', authenticateToken, requireRegistered, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        id: true,
        feedbackSubmittedAt: true,
        feedbackDismissedAt: true,
      },
    });

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    res.json({
      feedbackSubmittedAt: user.feedbackSubmittedAt,
      feedbackDismissedAt: user.feedbackDismissedAt,
    });
  } catch (error) {
    console.error('Failed to get feedback state:', error);
    res.status(500).json({ error: 'Failed to get feedback state' });
  }
});

export default router;

