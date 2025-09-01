import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

export interface FrontendHTTPSConfig {
  backendHTTPSUrl: string;
  certificatePath: string;
  keyPath: string;
  mkcertCompatible: boolean;
  viteHTTPSConfig?: {
    key: string;
    cert: string;
  };
}

/**
 * Configuration helper for frontend HTTPS testing with mkcert
 * Ensures frontend can connect to HTTPS backend for WebRTC testing
 */
export class FrontendHTTPSConfigManager {
  private backendPort: number;
  private certificatesPath: string;

  constructor(backendPort: number, certificatesPath: string = '.ssl') {
    this.backendPort = backendPort;
    this.certificatesPath = certificatesPath;
  }

  /**
   * Generate configuration for frontend HTTPS testing
   */
  generateFrontendConfig(): FrontendHTTPSConfig {
    const certPath = join(process.cwd(), this.certificatesPath, 'server.crt');
    const keyPath = join(process.cwd(), this.certificatesPath, 'server.key');

    const config: FrontendHTTPSConfig = {
      backendHTTPSUrl: `https://localhost:${this.backendPort}`,
      certificatePath: certPath,
      keyPath: keyPath,
      mkcertCompatible: this.checkMkcertCompatibility()
    };

    // Add Vite HTTPS configuration if certificates exist
    if (existsSync(certPath) && existsSync(keyPath)) {
      config.viteHTTPSConfig = {
        key: keyPath,
        cert: certPath
      };
    }

    return config;
  }

  /**
   * Check if mkcert is available and certificates are compatible
   */
  private checkMkcertCompatibility(): boolean {
    try {
      const { execSync } = require('child_process');
      execSync('mkcert -version', { stdio: 'pipe' });
      
      // Check if certificates exist and are mkcert-generated
      const certPath = join(process.cwd(), this.certificatesPath, 'server.crt');
      if (existsSync(certPath)) {
        const certContent = readFileSync(certPath, 'utf8');
        // mkcert certificates typically have specific characteristics
        return certContent.includes('localhost') || certContent.includes('127.0.0.1');
      }
      
      return true; // mkcert is available
    } catch (error) {
      return false;
    }
  }

  /**
   * Generate Vite configuration for HTTPS development
   */
  generateViteConfig(): string {
    const config = this.generateFrontendConfig();
    
    if (!config.viteHTTPSConfig) {
      return `
// Vite HTTPS configuration not available
// Please ensure SSL certificates exist at ${config.certificatePath}
export default {
  server: {
    https: false,
    proxy: {
      '/socket.io': {
        target: '${config.backendHTTPSUrl}',
        changeOrigin: true,
        secure: false // Allow self-signed certificates
      }
    }
  }
}`;
    }

    return `
import { defineConfig } from 'vite'
import { readFileSync } from 'fs'

export default defineConfig({
  server: {
    https: {
      key: readFileSync('${config.viteHTTPSConfig.key}'),
      cert: readFileSync('${config.viteHTTPSConfig.cert}')
    },
    host: 'localhost',
    port: 5173,
    proxy: {
      '/socket.io': {
        target: '${config.backendHTTPSUrl}',
        changeOrigin: true,
        secure: false, // Allow self-signed certificates in development
        ws: true // Enable WebSocket proxying
      }
    }
  },
  define: {
    // Ensure WebRTC works with HTTPS
    'process.env.BACKEND_URL': '"${config.backendHTTPSUrl}"',
    'process.env.HTTPS_ENABLED': 'true'
  }
})`;
  }

  /**
   * Generate Jest configuration for HTTPS testing
   */
  generateJestConfig(): string {
    const config = this.generateFrontendConfig();

    return `
module.exports = {
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['<rootDir>/src/test/setup.ts'],
  testEnvironmentOptions: {
    url: '${config.backendHTTPSUrl}',
    // Configure jsdom to handle HTTPS
    resources: 'usable',
    runScripts: 'dangerously'
  },
  globals: {
    'process.env': {
      BACKEND_URL: '${config.backendHTTPSUrl}',
      HTTPS_ENABLED: 'true',
      NODE_TLS_REJECT_UNAUTHORIZED: '0' // Allow self-signed certificates in tests
    }
  },
  // Mock WebRTC APIs for testing
  setupFiles: ['<rootDir>/src/test/webrtc-mock.ts']
}`;
  }

  /**
   * Generate WebRTC mock for frontend testing
   */
  generateWebRTCMock(): string {
    return `
// WebRTC Mock for HTTPS testing
// This ensures WebRTC APIs work in test environment with HTTPS

// Mock RTCPeerConnection
global.RTCPeerConnection = class MockRTCPeerConnection {
  constructor(config) {
    this.localDescription = null;
    this.remoteDescription = null;
    this.iceConnectionState = 'new';
    this.connectionState = 'new';
    this.signalingState = 'stable';
    this.onicecandidate = null;
    this.onconnectionstatechange = null;
    this.oniceconnectionstatechange = null;
    this.onsignalingstatechange = null;
    this.ontrack = null;
    this.ondatachannel = null;
  }

  async createOffer() {
    return {
      type: 'offer',
      sdp: 'mock-https-offer-sdp'
    };
  }

  async createAnswer() {
    return {
      type: 'answer',
      sdp: 'mock-https-answer-sdp'
    };
  }

  async setLocalDescription(description) {
    this.localDescription = description;
    this.signalingState = 'have-local-offer';
  }

  async setRemoteDescription(description) {
    this.remoteDescription = description;
    this.signalingState = 'stable';
    this.iceConnectionState = 'connected';
    this.connectionState = 'connected';
  }

  addIceCandidate(candidate) {
    return Promise.resolve();
  }

  addTrack(track, stream) {
    return {
      track,
      streams: [stream]
    };
  }

  removeTrack(sender) {
    // Mock implementation
  }

  createDataChannel(label, options) {
    return {
      label,
      readyState: 'open',
      send: jest.fn(),
      close: jest.fn(),
      onopen: null,
      onclose: null,
      onmessage: null,
      onerror: null
    };
  }

  close() {
    this.connectionState = 'closed';
    this.iceConnectionState = 'closed';
  }
};

// Mock MediaDevices
global.navigator.mediaDevices = {
  getUserMedia: jest.fn().mockResolvedValue({
    getTracks: () => [{
      kind: 'audio',
      enabled: true,
      stop: jest.fn()
    }],
    getAudioTracks: () => [{
      kind: 'audio',
      enabled: true,
      stop: jest.fn()
    }],
    getVideoTracks: () => []
  }),
  enumerateDevices: jest.fn().mockResolvedValue([
    {
      deviceId: 'default',
      kind: 'audioinput',
      label: 'Default Microphone',
      groupId: 'default'
    }
  ])
};

// Mock AudioContext for HTTPS audio testing
global.AudioContext = class MockAudioContext {
  constructor() {
    this.state = 'running';
    this.sampleRate = 44100;
    this.currentTime = 0;
    this.destination = {
      channelCount: 2,
      channelCountMode: 'explicit',
      channelInterpretation: 'speakers'
    };
  }

  createMediaStreamSource(stream) {
    return {
      connect: jest.fn(),
      disconnect: jest.fn()
    };
  }

  createGain() {
    return {
      gain: { value: 1 },
      connect: jest.fn(),
      disconnect: jest.fn()
    };
  }

  createAnalyser() {
    return {
      fftSize: 2048,
      frequencyBinCount: 1024,
      getByteFrequencyData: jest.fn(),
      getByteTimeDomainData: jest.fn(),
      connect: jest.fn(),
      disconnect: jest.fn()
    };
  }

  resume() {
    return Promise.resolve();
  }

  suspend() {
    return Promise.resolve();
  }

  close() {
    return Promise.resolve();
  }
};

// Ensure HTTPS is properly configured for tests
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
`;
  }

  /**
   * Validate that frontend can connect to HTTPS backend
   */
  async validateFrontendConnection(): Promise<{
    canConnect: boolean;
    httpsWorking: boolean;
    webrtcCompatible: boolean;
    error?: string;
  }> {
    const config = this.generateFrontendConfig();

    try {
      // Test basic HTTPS connection
      const https = require('https');
      const agent = new https.Agent({
        rejectUnauthorized: false // Allow self-signed certificates
      });

      const canConnect = await new Promise<boolean>((resolve) => {
        const req = https.get(`${config.backendHTTPSUrl}/health`, { agent }, (res) => {
          resolve(res.statusCode === 200);
        });
        
        req.on('error', () => resolve(false));
        req.setTimeout(5000, () => {
          req.destroy();
          resolve(false);
        });
      });

      return {
        canConnect,
        httpsWorking: canConnect,
        webrtcCompatible: config.mkcertCompatible,
      };
    } catch (error) {
      return {
        canConnect: false,
        httpsWorking: false,
        webrtcCompatible: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Generate complete test setup instructions
   */
  generateTestSetupInstructions(): string {
    const config = this.generateFrontendConfig();

    return `
# HTTPS Testing Setup Instructions

## Backend HTTPS Configuration
- Backend URL: ${config.backendHTTPSUrl}
- Certificate Path: ${config.certificatePath}
- Key Path: ${config.keyPath}
- mkcert Compatible: ${config.mkcertCompatible ? 'Yes' : 'No'}

## Frontend Setup

### 1. Install mkcert (if not already installed)
\`\`\`bash
# macOS
brew install mkcert

# Linux
sudo apt install libnss3-tools
wget -O mkcert https://github.com/FiloSottile/mkcert/releases/latest/download/mkcert-v*-linux-amd64
chmod +x mkcert
sudo mv mkcert /usr/local/bin/
\`\`\`

### 2. Generate certificates (if needed)
\`\`\`bash
mkcert -install
mkcert localhost 127.0.0.1
\`\`\`

### 3. Configure Vite for HTTPS
Create or update \`vite.config.ts\`:
${this.generateViteConfig()}

### 4. Update Jest configuration
Update \`jest.config.js\`:
${this.generateJestConfig()}

### 5. Create WebRTC mock
Create \`src/test/webrtc-mock.ts\`:
${this.generateWebRTCMock()}

## Running Tests

### Start backend with HTTPS
\`\`\`bash
cd jam-band-be
npm run start:dev
\`\`\`

### Start frontend with HTTPS
\`\`\`bash
cd jam-band-fe
npm run dev
\`\`\`

### Run tests
\`\`\`bash
npm run test
\`\`\`

## Troubleshooting

1. **Certificate errors**: Ensure mkcert is installed and certificates are generated
2. **Connection refused**: Check that backend is running on HTTPS
3. **WebRTC failures**: Verify that both frontend and backend use HTTPS
4. **Browser security**: Accept self-signed certificates in browser for testing
`;
  }
}