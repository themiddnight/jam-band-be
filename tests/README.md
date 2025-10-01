# Testing Structure for Jam Band Backend

This document outlines the comprehensive testing framework implemented for the Jam Band backend application. The testing structure is designed to ensure that new features don't break existing functionality and that the application maintains high quality and reliability.

## Testing Architecture

### Directory Structure

```
tests/
├── helpers/           # Test helper classes and utilities
│   ├── TestEnvironment.ts
│   ├── MockFactory.ts
│   └── TestLogger.ts
├── fixtures/          # Test data and fixtures
│   └── testData.ts
├── utils/             # Testing utility functions
│   └── TestUtils.ts
├── unit/              # Unit tests
│   └── services/
├── integration/       # Integration tests
│   └── room-management.test.ts
├── e2e/               # End-to-end tests
│   └── application.test.ts
├── regression/        # Regression tests
│   └── core-functionality.test.ts
└── setup.ts           # Global test setup
```

### Test Types

#### 1. Unit Tests (`tests/unit/`)
- Test individual functions and methods in isolation
- Use mocked dependencies
- Fast execution
- High coverage of edge cases

**Example:**
```typescript
describe('RoomService - Unit Tests', () => {
  it('should create a room with valid data', () => {
    const result = roomService.createRoom('Test Room', 'user', 'user123');
    expect(result.room.name).toBe('Test Room');
  });
});
```

#### 2. Integration Tests (`tests/integration/`)
- Test multiple components working together
- Use real services but controlled environment
- Test API contracts and data flow

**Example:**
```typescript
describe('Room Management Integration', () => {
  it('should create room and manage user lifecycle', async () => {
    const roomData = roomService.createRoom('Test Room', 'owner', 'owner123');
    const addResult = roomService.addUserToRoom(roomData.room.id, newUser);
    expect(addResult).toBe(true);
  });
});
```

#### 3. End-to-End Tests (`tests/e2e/`)
- Test complete user workflows
- Test actual API endpoints
- Simulate real user interactions

#### 4. Regression Tests (`tests/regression/`)
- **Critical for new feature development**
- Ensure existing functionality continues to work
- Run automatically when adding new features
- Cover core business logic and API contracts

## Test Utilities and Helpers

### TestEnvironment
Manages test environment setup and cleanup:
```typescript
const testEnv = new TestEnvironment();
await testEnv.setup();
// Test code here
await testEnv.cleanup();
```

### MockFactory
Creates consistent mock objects:
```typescript
const mockUser = testUtils.mocks.createUser({ role: 'performer' });
const mockRoom = testUtils.mocks.createRoom({ isPrivate: true });
```

### TestLogger
Controls console output during tests:
```typescript
testUtils.logger.suppressConsole(); // Hide logs during tests
testUtils.logger.enableConsoleForTest(); // Show logs for debugging
```

## Running Tests

### Basic Commands
```bash
# Run all tests
npm test

# Run specific test types
npm run test:unit           # Unit tests only
npm run test:integration    # Integration tests only
npm run test:e2e           # End-to-end tests only
npm run test:regression    # Regression tests only

# Run all test types in sequence
npm run test:all

# Development commands
npm run test:watch         # Watch mode
npm run test:coverage      # With coverage report
npm run test:changed       # Only changed files
```

### Continuous Integration
```bash
npm run test:ci            # CI optimized run
```

## Adding Tests for New Features

### 1. Before Adding a New Feature
Run regression tests to establish baseline:
```bash
npm run test:regression
```

### 2. During Feature Development
Write tests in this order:

1. **Unit Tests** - Test individual functions
```typescript
// tests/unit/services/NewFeatureService.test.ts
describe('NewFeatureService', () => {
  it('should handle new functionality', () => {
    // Test implementation
  });
});
```

2. **Integration Tests** - Test feature integration
```typescript
// tests/integration/new-feature.test.ts
describe('New Feature Integration', () => {
  it('should work with existing systems', () => {
    // Test integration
  });
});
```

3. **Regression Tests** - Ensure no breaking changes
```typescript
// Add to tests/regression/core-functionality.test.ts
describe('New Feature Regression', () => {
  it('should not break existing room creation', () => {
    // Test existing functionality still works
  });
});
```

### 3. After Feature Implementation
Run comprehensive test suite:
```bash
npm run test:all
```

## Best Practices

### 1. Test Organization
- **One test file per service/module**
- **Descriptive test names** that explain what's being tested
- **Group related tests** using `describe` blocks
- **Use consistent naming** conventions

### 2. Test Data
- **Use fixtures** for consistent test data
- **Create factory functions** for generating test objects
- **Avoid hard-coded values** where possible

### 3. Assertions
- **Use specific assertions** rather than generic ones
- **Test both positive and negative cases**
- **Include edge cases and error conditions**
- **Verify side effects** and state changes

### 4. Performance Testing
```typescript
it('should perform within acceptable limits', async () => {
  await testUtils.measurePerformance('operation_name', async () => {
    // Your operation here
  });
});
```

### 5. Mock Management
- **Clear mocks** between tests
- **Use typed mocks** for better type safety
- **Mock external dependencies** consistently

## Configuration

### Jest Configuration
The project uses multiple Jest projects for different test types:

```javascript
// jest.config.js
projects: [
  {
    displayName: 'unit',
    testMatch: ['<rootDir>/tests/unit/**/*.test.ts'],
    testTimeout: 10000,
  },
  {
    displayName: 'integration', 
    testMatch: ['<rootDir>/tests/integration/**/*.test.ts'],
    testTimeout: 30000,
  },
  // ... more projects
]
```

### Coverage Thresholds
```javascript
coverageThreshold: {
  global: {
    branches: 70,
    functions: 70,
    lines: 70,
    statements: 70
  }
}
```

## Debugging Tests

### 1. Enable Console Output
```typescript
beforeEach(() => {
  testUtils.logger.enableConsoleForTest();
});
```

### 2. Isolate Failing Tests
```bash
npm test -- --testPathPattern="specific-test-file"
npm test -- --testNamePattern="specific test name"
```

### 3. Debug with Node Inspector
```bash
node --inspect-brk node_modules/.bin/jest --runInBand
```

## Common Patterns

### 1. Testing Async Operations
```typescript
it('should handle async operations', async () => {
  await testUtils.waitFor(() => condition, 5000);
  // Test async result
});
```

### 2. Testing Error Conditions
```typescript
it('should handle errors gracefully', async () => {
  await expect(service.methodThatThrows()).rejects.toThrow('Expected error');
});
```

### 3. Testing Performance
```typescript
it('should meet performance requirements', async () => {
  const start = performance.now();
  await service.performOperation();
  const duration = performance.now() - start;
  expect(duration).toBeLessThan(100); // 100ms
});
```

## Maintenance

### Regular Tasks
1. **Review and update** test fixtures monthly
2. **Check coverage reports** and improve low-coverage areas  
3. **Update performance thresholds** as the application grows
4. **Refactor common test patterns** into utilities
5. **Remove obsolete tests** for deprecated features

### When Adding Dependencies
1. **Mock external services** appropriately
2. **Update test setup** if needed
3. **Test integration points** thoroughly
4. **Document new testing patterns**

## Integration with CI/CD

The testing structure supports:
- **Parallel test execution** for faster CI runs
- **Test result reporting** in multiple formats
- **Coverage reporting** with configurable thresholds
- **Regression detection** for breaking changes

Example CI configuration:
```yaml
test:
  script:
    - npm run test:unit
    - npm run test:integration  
    - npm run test:regression
  coverage: '/Coverage: \d+\.\d+%/'
```

This testing framework ensures that your Jam Band backend remains stable and reliable as you add new features, providing confidence that existing functionality won't break when you introduce changes.