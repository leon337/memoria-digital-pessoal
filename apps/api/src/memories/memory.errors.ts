export class MemoryInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MemoryInvariantError';
  }
}

export class MemoryNotFoundError extends Error {
  constructor() {
    super('Memory not found');
    this.name = 'MemoryNotFoundError';
  }
}

export class StaleCorrectionError extends Error {
  constructor(readonly currentFactId: string) {
    super('Memory changed since it was read');
    this.name = 'StaleCorrectionError';
  }
}

export class NoChangeCorrectionError extends Error {
  constructor() {
    super('Correction does not change current memory text');
    this.name = 'NoChangeCorrectionError';
  }
}
