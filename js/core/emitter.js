/** Dependency-free pub/sub. Handlers are isolated: one throwing never stops the rest. */
export function createEmitter() {
  const listeners = new Map();

  return {
    on(type, handler) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(handler);
      return () => this.off(type, handler);
    },
    off(type, handler) {
      listeners.get(type)?.delete(handler);
    },
    emit(type, payload) {
      const set = listeners.get(type);
      if (!set) return;
      for (const handler of [...set]) {
        try {
          handler(payload);
        } catch (error) {
          console.error(`[emitter] handler for "${type}" threw`, error);
        }
      }
    },
  };
}
