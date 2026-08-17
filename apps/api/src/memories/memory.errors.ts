export class MemoryInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MemoryInvariantError';
  }
}
