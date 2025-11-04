import { EventEmitter } from 'events';
import { DAWAlert, DAWMonitoringService } from './DAWMonitoringService';
import { LoggingService } from './LoggingService';

export interface AlertChannel {
  type: 'email' | 'slack' | 'webhook' | 'sms';
  config: {
    url?: string;
    token?: string;
    recipients?: string[];
    template?: string;
  };
  enabled: boolean;
  severity: ('critical' | 'warning' | 'info')[];
}

export interface AlertRule {
  id: string;
  name: string;
  condition: string;
  threshold: number;
  duration: number; // seconds
  severity: 'critical' | 'warning' | 'info';
  channels: string[];
  enabled: boolean;
  cooldown: number; // seconds between alerts
  lastTriggered?: Date;
}

export interface NotificationTemplate {
  subject: string;
  body: string;
  variables: Record<string, string>;
}

export class DAWAlertingService extends EventEmitter {
  private monitoringService: DAWMonitoringService;
  private logger: LoggingService;
  private channels: Map<string, AlertChannel> = new Map();
  private rules: Map<string, AlertRule> = new Map();
  private templates: Map<string, NotificationTemplate> = new Map();
  private alertHistory: DAWAlert[] = [];
  private isRunning = false;
  private checkInterval: NodeJS.Timeout | undefined;

  constructor(monitoringService: DAWMonitoringService, logger: LoggingService) {
    super();
    this.monitoringService = monitoringService;
    this.logger = logger;
    this.setupDefaultRules();
    this.setupDefaultChannels();
    this.setupDefaultTemplates();
    this.setupEventListeners();
  }

  /**
   * Start the alerting service
   */
  public start(): void {
    if (this.isRunning) return;

    this.isRunning = true;
    this.checkInterval = setInterval(() => {
      this.checkAlertRules();
    }, 10000); // Check every 10 seconds

    this.logger.info('DAW Alerting Service started', {
      service: 'DAWAlertingService'
    });
  }

  /**
   * Stop the alerting service
   */
  public stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = undefined;
    }
    this.isRunning = false;

    this.logger.info('DAW Alerting Service stopped', {
      service: 'DAWAlertingService'
    });
  }

  /**
   * Add alert channel
   */
  public addChannel(id: string, channel: AlertChannel): void {
    this.channels.set(id, channel);
    this.logger.info('Alert channel added', {
      channelId: id,
      type: channel.type,
      service: 'DAWAlertingService'
    });
  }

  /**
   * Add alert rule
   */
  public addRule(rule: AlertRule): void {
    this.rules.set(rule.id, rule);
    this.logger.info('Alert rule added', {
      ruleId: rule.id,
      name: rule.name,
      condition: rule.condition,
      service: 'DAWAlertingService'
    });
  }

  /**
   * Send alert through configured channels
   */
  public async sendAlert(alert: DAWAlert): Promise<void> {
    const applicableRules = Array.from(this.rules.values())
      .filter(rule => rule.enabled && rule.severity === alert.type);

    for (const rule of applicableRules) {
      // Check cooldown
      if (rule.lastTriggered) {
        const timeSinceLastAlert = Date.now() - rule.lastTriggered.getTime();
        if (timeSinceLastAlert < rule.cooldown * 1000) {
          continue; // Skip due to cooldown
        }
      }

      // Send to configured channels
      for (const channelId of rule.channels) {
        const channel = this.channels.get(channelId);
        if (channel && channel.enabled && channel.severity.includes(alert.type)) {
          try {
            await this.sendToChannel(channel, alert, rule);
            rule.lastTriggered = new Date();
          } catch (error) {
            this.logger.error('Failed to send alert to channel', {
              channelId,
              alertId: alert.id,
              error: error instanceof Error ? error.message : 'Unknown error',
              service: 'DAWAlertingService'
            });
          }
        }
      }
    }

    this.alertHistory.push(alert);
    this.emit('alertSent', alert);
  }

  /**
   * Test alert channel
   */
  public async testChannel(channelId: string): Promise<boolean> {
    const channel = this.channels.get(channelId);
    if (!channel) {
      throw new Error(`Channel ${channelId} not found`);
    }

    const testAlert: DAWAlert = {
      id: 'test_alert',
      type: 'info',
      category: 'system',
      message: 'This is a test alert from DAW Alerting Service',
      timestamp: new Date(),
      metadata: { test: true }
    };

    try {
      await this.sendToChannel(channel, testAlert);
      this.logger.info('Alert channel test successful', {
        channelId,
        service: 'DAWAlertingService'
      });
      return true;
    } catch (error) {
      this.logger.error('Alert channel test failed', {
        channelId,
        error: error instanceof Error ? error.message : 'Unknown error',
        service: 'DAWAlertingService'
      });
      return false;
    }
  }

  /**
   * Get alert statistics
   */
  public getAlertStatistics(timeRange: { start: Date; end: Date }): {
    total: number;
    byType: Record<string, number>;
    byCategory: Record<string, number>;
    resolved: number;
    averageResolutionTime: number;
  } {
    const filteredAlerts = this.alertHistory.filter(
      alert => alert.timestamp >= timeRange.start && alert.timestamp <= timeRange.end
    );

    const byType = this.groupBy(filteredAlerts, 'type');
    const byCategory = this.groupBy(filteredAlerts, 'category');
    const resolved = filteredAlerts.filter(alert => alert.resolved).length;

    // Calculate average resolution time
    const resolvedAlerts = filteredAlerts.filter(alert => alert.resolved && alert.resolvedAt);
    const totalResolutionTime = resolvedAlerts.reduce((sum, alert) => {
      if (alert.resolvedAt) {
        return sum + (alert.resolvedAt.getTime() - alert.timestamp.getTime());
      }
      return sum;
    }, 0);
    const averageResolutionTime = resolvedAlerts.length > 0 
      ? totalResolutionTime / resolvedAlerts.length 
      : 0;

    return {
      total: filteredAlerts.length,
      byType,
      byCategory,
      resolved,
      averageResolutionTime
    };
  }

  /**
   * Configure notification templates
   */
  public setTemplate(type: string, template: NotificationTemplate): void {
    this.templates.set(type, template);
  }

  /**
   * Get active alert rules
   */
  public getActiveRules(): AlertRule[] {
    return Array.from(this.rules.values()).filter(rule => rule.enabled);
  }

  /**
   * Get configured channels
   */
  public getChannels(): AlertChannel[] {
    return Array.from(this.channels.values());
  }

  private setupEventListeners(): void {
    this.monitoringService.on('alert', (alert: DAWAlert) => {
      this.sendAlert(alert);
    });
  }

  private setupDefaultRules(): void {
    const defaultRules: AlertRule[] = [
      {
        id: 'high_audio_latency',
        name: 'High Audio Latency',
        condition: 'audio_latency > threshold',
        threshold: 100,
        duration: 120,
        severity: 'warning',
        channels: ['email', 'slack'],
        enabled: true,
        cooldown: 300
      },
      {
        id: 'critical_audio_latency',
        name: 'Critical Audio Latency',
        condition: 'audio_latency > threshold',
        threshold: 200,
        duration: 60,
        severity: 'critical',
        channels: ['email', 'slack', 'sms'],
        enabled: true,
        cooldown: 180
      },
      {
        id: 'high_cpu_usage',
        name: 'High CPU Usage',
        condition: 'cpu_usage > threshold',
        threshold: 85,
        duration: 300,
        severity: 'warning',
        channels: ['email', 'slack'],
        enabled: true,
        cooldown: 600
      },
      {
        id: 'critical_memory_usage',
        name: 'Critical Memory Usage',
        condition: 'memory_usage > threshold',
        threshold: 90,
        duration: 180,
        severity: 'critical',
        channels: ['email', 'slack', 'webhook'],
        enabled: true,
        cooldown: 300
      },
      {
        id: 'collaboration_failures',
        name: 'Collaboration Sync Failures',
        condition: 'sync_failures > threshold',
        threshold: 10,
        duration: 60,
        severity: 'critical',
        channels: ['email', 'slack'],
        enabled: true,
        cooldown: 240
      }
    ];

    defaultRules.forEach(rule => this.rules.set(rule.id, rule));
  }

  private setupDefaultChannels(): void {
    // Email channel
    this.channels.set('email', {
      type: 'email',
      config: {
        recipients: ['admin@jamband.com', 'ops@jamband.com']
      },
      enabled: false, // Disabled by default, requires configuration
      severity: ['critical', 'warning']
    });

    // Slack channel
    this.channels.set('slack', {
      type: 'slack',
      config: {
        url: process.env.SLACK_WEBHOOK_URL || '',
        template: 'slack_alert'
      },
      enabled: !!process.env.SLACK_WEBHOOK_URL,
      severity: ['critical', 'warning', 'info']
    });

    // Webhook channel
    this.channels.set('webhook', {
      type: 'webhook',
      config: {
        url: process.env.ALERT_WEBHOOK_URL || '',
        template: 'webhook_alert'
      },
      enabled: !!process.env.ALERT_WEBHOOK_URL,
      severity: ['critical', 'warning']
    });
  }

  private setupDefaultTemplates(): void {
    this.templates.set('email_alert', {
      subject: 'DAW Alert: {{alert.type}} - {{alert.message}}',
      body: `
        Alert Details:
        - Type: {{alert.type}}
        - Category: {{alert.category}}
        - Message: {{alert.message}}
        - Timestamp: {{alert.timestamp}}
        - Metadata: {{alert.metadata}}
        
        Please investigate and resolve this issue promptly.
      `,
      variables: {}
    });

    this.templates.set('slack_alert', {
      subject: '',
      body: `{
        "text": "DAW Alert: {{alert.type}}",
        "attachments": [{
          "color": "{{alert.type === 'critical' ? 'danger' : 'warning'}}",
          "fields": [
            {"title": "Message", "value": "{{alert.message}}", "short": false},
            {"title": "Category", "value": "{{alert.category}}", "short": true},
            {"title": "Timestamp", "value": "{{alert.timestamp}}", "short": true}
          ]
        }]
      }`,
      variables: {}
    });

    this.templates.set('webhook_alert', {
      subject: '',
      body: `{
        "alert": {
          "id": "{{alert.id}}",
          "type": "{{alert.type}}",
          "category": "{{alert.category}}",
          "message": "{{alert.message}}",
          "timestamp": "{{alert.timestamp}}",
          "metadata": {{alert.metadata}}
        }
      }`,
      variables: {}
    });
  }

  private async sendToChannel(channel: AlertChannel, alert: DAWAlert, rule?: AlertRule): Promise<void> {
    const template = this.templates.get(`${channel.type}_alert`);
    if (!template) {
      throw new Error(`No template found for channel type: ${channel.type}`);
    }

    const message = this.renderTemplate(template, { alert, rule });

    switch (channel.type) {
      case 'email':
        await this.sendEmail(channel, message, alert);
        break;
      case 'slack':
        await this.sendSlack(channel, message);
        break;
      case 'webhook':
        await this.sendWebhook(channel, message);
        break;
      case 'sms':
        await this.sendSMS(channel, alert);
        break;
      default:
        throw new Error(`Unsupported channel type: ${channel.type}`);
    }
  }

  private async sendEmail(channel: AlertChannel, message: { subject: string; body: string }, alert: DAWAlert): Promise<void> {
    // Email implementation would go here
    // This is a placeholder for actual email service integration
    this.logger.info('Email alert sent', {
      recipients: channel.config.recipients,
      subject: message.subject,
      alertId: alert.id,
      service: 'DAWAlertingService'
    });
  }

  private async sendSlack(channel: AlertChannel, message: { body: string }): Promise<void> {
    if (!channel.config.url) {
      throw new Error('Slack webhook URL not configured');
    }

    const response = await fetch(channel.config.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: message.body
    });

    if (!response.ok) {
      throw new Error(`Slack webhook failed: ${response.statusText}`);
    }
  }

  private async sendWebhook(channel: AlertChannel, message: { body: string }): Promise<void> {
    if (!channel.config.url) {
      throw new Error('Webhook URL not configured');
    }

    const response = await fetch(channel.config.url, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': channel.config.token ? `Bearer ${channel.config.token}` : ''
      },
      body: message.body
    });

    if (!response.ok) {
      throw new Error(`Webhook failed: ${response.statusText}`);
    }
  }

  private async sendSMS(channel: AlertChannel, alert: DAWAlert): Promise<void> {
    // SMS implementation would go here
    // This is a placeholder for actual SMS service integration
    this.logger.info('SMS alert sent', {
      recipients: channel.config.recipients,
      message: alert.message,
      alertId: alert.id,
      service: 'DAWAlertingService'
    });
  }

  private renderTemplate(template: NotificationTemplate, context: any): { subject: string; body: string } {
    const renderString = (str: string): string => {
      return str.replace(/\{\{([^}]+)\}\}/g, (match, path) => {
        const value = this.getNestedValue(context, path.trim());
        return value !== undefined ? String(value) : match;
      });
    };

    return {
      subject: renderString(template.subject),
      body: renderString(template.body)
    };
  }

  private getNestedValue(obj: any, path: string): any {
    return path.split('.').reduce((current, key) => {
      return current && current[key] !== undefined ? current[key] : undefined;
    }, obj);
  }

  private checkAlertRules(): void {
    // This would implement rule evaluation logic
    // For now, it's a placeholder that would check metrics against rules
    const systemHealth = this.monitoringService.getSystemHealth();
    
    // Example rule checking (would be more sophisticated in practice)
    if (systemHealth.systemMetrics) {
      const cpuUsage = systemHealth.systemMetrics.serverCpuUsage;
      if (cpuUsage > 85) {
        this.monitoringService.createAlert(
          'warning',
          'system',
          `High CPU usage detected: ${cpuUsage}%`,
          { cpuUsage }
        );
      }
    }
  }

  private groupBy<T>(array: T[], key: keyof T): Record<string, number> {
    return array.reduce((acc, item) => {
      const value = String(item[key]);
      acc[value] = (acc[value] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
  }
}