type Listener = (value: string | null) => void;
type Job = { key: string; path: string; listeners: Set<Listener>; epoch: number };

/** One queue across panes; queued work disappears when its last visible consumer leaves. */
export function createThumbnailQueue(load: (path: string) => Promise<string | null>) {
  const cache = new Map<string, string | null>();
  const jobs = new Map<string, Job>();
  const pending: Job[] = [];
  let active = 0;
  let epoch = 0;
  function pump() {
    while (active < 2 && pending.length) {
      const job = pending.shift()!;
      if (!job.listeners.size) { jobs.delete(job.key); continue; }
      active++;
      void load(job.path).catch(() => null).then((value) => {
        if (job.epoch === epoch) {
          cache.set(job.key, value);
          if (cache.size > 128) cache.delete(cache.keys().next().value!);
        }
        for (const listener of job.listeners) listener(value);
      }).finally(() => {
        if (jobs.get(job.key) === job) jobs.delete(job.key);
        active--;
        pump();
      });
    }
  }
  return {
    clear() { cache.clear(); epoch++; },
    request(key: string, path: string, listener: Listener) {
      key = `${epoch}:${key}`;
      if (cache.has(key)) {
        const value = cache.get(key)!;
        cache.delete(key);
        cache.set(key, value);
        listener(value);
        return () => {};
      }
      let job = jobs.get(key);
      if (!job) {
        job = { key, path, listeners: new Set(), epoch };
        jobs.set(key, job);
        pending.push(job);
      }
      job.listeners.add(listener);
      pump();
      return () => {
        job.listeners.delete(listener);
        const index = pending.indexOf(job);
        if (!job.listeners.size && index >= 0) {
          pending.splice(index, 1);
          jobs.delete(key);
        }
      };
    },
  };
}
