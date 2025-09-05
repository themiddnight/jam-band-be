import { DomainEvent } from '../DomainEvent';
import { InMemoryEventBus } from '../InMemoryEventBus';
import { EventHandler } from '../EventBus';

// Test event classes
class TestEvent extends DomainEvent {
  constructor(aggregateId: string, public readonly data: string) {
    super(aggregateId);
  }
}

class AnotherTestEvent extends DomainEvent {
  constructor(aggregateId: string, public readonly value: number) {
    super(aggregateId);
  }
}

describe('InMemoryEventBus', () => {
  let eventBus: InMemoryEventBus;

  beforeEach(() => {
    eventBus = new InMemoryEventBus();
  });

  describe('subscribe and publish', () => {
    it('should call handler when event is published', async () => {
      const handler = jest.fn();
      const event = new TestEvent('test-id', 'test-data');

      eventBus.subscribe(TestEvent, handler);
      await eventBus.publish(event);

      expect(handler).toHaveBeenCalledWith(event);
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('should call multiple handlers for the same event type', async () => {
      const handler1 = jest.fn();
      const handler2 = jest.fn();
      const event = new TestEvent('test-id', 'test-data');

      eventBus.subscribe(TestEvent, handler1);
      eventBus.subscribe(TestEvent, handler2);
      await eventBus.publish(event);

      expect(handler1).toHaveBeenCalledWith(event);
      expect(handler2).toHaveBeenCalledWith(event);
    });

    it('should not call handlers for different event types', async () => {
      const testHandler = jest.fn();
      const anotherHandler = jest.fn();
      const event = new TestEvent('test-id', 'test-data');

      eventBus.subscribe(TestEvent, testHandler);
      eventBus.subscribe(AnotherTestEvent, anotherHandler);
      await eventBus.publish(event);

      expect(testHandler).toHaveBeenCalledWith(event);
      expect(anotherHandler).not.toHaveBeenCalled();
    });

    it('should handle async handlers', async () => {
      const asyncHandler: EventHandler<TestEvent> = async (event) => {
        await new Promise(resolve => setTimeout(resolve, 10));
        // Handler completed
      };
      const spy = jest.fn(asyncHandler);
      const event = new TestEvent('test-id', 'test-data');

      eventBus.subscribe(TestEvent, spy);
      await eventBus.publish(event);

      expect(spy).toHaveBeenCalledWith(event);
    });
  });

  describe('publishAll', () => {
    it('should publish multiple events', async () => {
      const handler1 = jest.fn();
      const handler2 = jest.fn();
      const event1 = new TestEvent('test-id-1', 'test-data-1');
      const event2 = new AnotherTestEvent('test-id-2', 42);

      eventBus.subscribe(TestEvent, handler1);
      eventBus.subscribe(AnotherTestEvent, handler2);
      await eventBus.publishAll([event1, event2]);

      expect(handler1).toHaveBeenCalledWith(event1);
      expect(handler2).toHaveBeenCalledWith(event2);
    });

    it('should handle empty event array', async () => {
      await expect(eventBus.publishAll([])).resolves.toBeUndefined();
    });
  });

  describe('unsubscribe', () => {
    it('should remove handler when unsubscribed', async () => {
      const handler = jest.fn();
      const event = new TestEvent('test-id', 'test-data');

      eventBus.subscribe(TestEvent, handler);
      eventBus.unsubscribe(TestEvent, handler);
      await eventBus.publish(event);

      expect(handler).not.toHaveBeenCalled();
    });

    it('should only remove the specific handler', async () => {
      const handler1 = jest.fn();
      const handler2 = jest.fn();
      const event = new TestEvent('test-id', 'test-data');

      eventBus.subscribe(TestEvent, handler1);
      eventBus.subscribe(TestEvent, handler2);
      eventBus.unsubscribe(TestEvent, handler1);
      await eventBus.publish(event);

      expect(handler1).not.toHaveBeenCalled();
      expect(handler2).toHaveBeenCalledWith(event);
    });

    it('should handle unsubscribing non-existent handler gracefully', () => {
      const handler = jest.fn();
      
      expect(() => {
        eventBus.unsubscribe(TestEvent, handler);
      }).not.toThrow();
    });
  });

  describe('utility methods', () => {
    it('should return correct handler count', () => {
      const handler1 = jest.fn();
      const handler2 = jest.fn();

      expect(eventBus.getHandlerCount(TestEvent)).toBe(0);

      eventBus.subscribe(TestEvent, handler1);
      expect(eventBus.getHandlerCount(TestEvent)).toBe(1);

      eventBus.subscribe(TestEvent, handler2);
      expect(eventBus.getHandlerCount(TestEvent)).toBe(2);

      eventBus.unsubscribe(TestEvent, handler1);
      expect(eventBus.getHandlerCount(TestEvent)).toBe(1);
    });

    it('should clear all handlers', async () => {
      const handler1 = jest.fn();
      const handler2 = jest.fn();
      const event1 = new TestEvent('test-id', 'test-data');
      const event2 = new AnotherTestEvent('test-id', 42);

      eventBus.subscribe(TestEvent, handler1);
      eventBus.subscribe(AnotherTestEvent, handler2);
      
      eventBus.clearAllHandlers();
      
      await eventBus.publish(event1);
      await eventBus.publish(event2);

      expect(handler1).not.toHaveBeenCalled();
      expect(handler2).not.toHaveBeenCalled();
      expect(eventBus.getHandlerCount(TestEvent)).toBe(0);
      expect(eventBus.getHandlerCount(AnotherTestEvent)).toBe(0);
    });
  });

  describe('error handling', () => {
    it('should handle errors in event handlers', async () => {
      const errorHandler = jest.fn(() => {
        throw new Error('Handler error');
      });
      const goodHandler = jest.fn();
      const event = new TestEvent('test-id', 'test-data');

      eventBus.subscribe(TestEvent, errorHandler);
      eventBus.subscribe(TestEvent, goodHandler);

      // Should reject due to handler error
      await expect(eventBus.publish(event)).rejects.toThrow('Handler error');
      
      // Both handlers should have been called
      expect(errorHandler).toHaveBeenCalledWith(event);
      expect(goodHandler).toHaveBeenCalledWith(event);
    });

    it('should handle async errors in event handlers', async () => {
      const asyncErrorHandler = jest.fn(async () => {
        throw new Error('Async handler error');
      });
      const event = new TestEvent('test-id', 'test-data');

      eventBus.subscribe(TestEvent, asyncErrorHandler);

      await expect(eventBus.publish(event)).rejects.toThrow('Async handler error');
      expect(asyncErrorHandler).toHaveBeenCalledWith(event);
    });
  });
});