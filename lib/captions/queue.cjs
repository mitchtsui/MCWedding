'use strict';

class QueueFullError extends Error {
  constructor() {
    super('Translation queue is full');
    this.name = 'QueueFullError';
    this.code = 'queue_full';
  }
}

class BoundedWorkQueue {
  constructor({ concurrency = 2, maxQueued = 24, worker }) {
    if (!Number.isInteger(concurrency) || concurrency < 1) throw new TypeError('concurrency must be positive');
    if (!Number.isInteger(maxQueued) || maxQueued < 1) throw new TypeError('maxQueued must be positive');
    if (typeof worker !== 'function') throw new TypeError('worker must be a function');
    this.concurrency = concurrency;
    this.maxQueued = maxQueued;
    this.worker = worker;
    this.running = 0;
    this.items = [];
    this.idleWaiters = new Set();
    this.closed = false;
  }

  enqueue(value, { priority = 0, key = null, replaceQueued = false } = {}) {
    if (this.closed) return Promise.reject(Object.assign(new Error('Queue is closed'), { code: 'queue_closed' }));
    if (replaceQueued && key !== null) {
      for (let index = this.items.length - 1; index >= 0; index -= 1) {
        const pending = this.items[index];
        if (pending.key === key) {
          this.items.splice(index, 1);
          pending.resolve({ dropped: true, reason: 'superseded' });
        }
      }
    }
    if (this.items.length >= this.maxQueued) return Promise.reject(new QueueFullError());
    return new Promise((resolve, reject) => {
      const item = { value, priority, key, resolve, reject, ordinal: BoundedWorkQueue.ordinal++ };
      this.items.push(item);
      this.items.sort((left, right) => right.priority - left.priority || left.ordinal - right.ordinal);
      this.pump();
    });
  }

  cancelQueued(predicate, reason = 'cancelled') {
    const retained = [];
    for (const item of this.items) {
      if (predicate(item.value)) item.resolve({ dropped: true, reason });
      else retained.push(item);
    }
    this.items = retained;
  }

  close(reason = 'closed') {
    this.closed = true;
    this.cancelQueued(() => true, reason);
    this.resolveIdle();
  }

  get size() {
    return this.items.length;
  }

  pump() {
    while (!this.closed && this.running < this.concurrency && this.items.length) {
      const item = this.items.shift();
      this.running += 1;
      Promise.resolve()
        .then(() => this.worker(item.value))
        .then(item.resolve, item.reject)
        .finally(() => {
          this.running -= 1;
          this.resolveIdle();
          this.pump();
        });
    }
  }

  onIdle() {
    if (this.running === 0 && this.items.length === 0) return Promise.resolve();
    return new Promise(resolve => this.idleWaiters.add(resolve));
  }

  resolveIdle() {
    if (this.running !== 0 || this.items.length !== 0) return;
    for (const resolve of this.idleWaiters) resolve();
    this.idleWaiters.clear();
  }
}
BoundedWorkQueue.ordinal = 0;

class TranslationLanes {
  constructor({ languages, concurrency = 2, maxQueued = 24, worker }) {
    this.lanes = new Map(languages.map(language => [language, new BoundedWorkQueue({
      concurrency,
      maxQueued,
      worker: job => worker(language, job),
    })]));
  }

  enqueue(language, job, options) {
    const lane = this.lanes.get(language);
    if (!lane) return Promise.reject(Object.assign(new Error('Unsupported language'), { code: 'invalid_language' }));
    return lane.enqueue(job, options);
  }

  cancelStale(predicate) {
    for (const lane of this.lanes.values()) lane.cancelQueued(predicate, 'stale_generation');
  }

  close() {
    for (const lane of this.lanes.values()) lane.close();
  }

  onIdle() {
    return Promise.all([...this.lanes.values()].map(lane => lane.onIdle()));
  }
}

module.exports = { BoundedWorkQueue, TranslationLanes, QueueFullError };
