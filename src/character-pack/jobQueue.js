export function createJobQueue({ concurrency = 2 } = {}) {
  const limit = Math.max(1, Number(concurrency) || 1)
  const pending = []
  let active = 0

  const drain = () => {
    while (active < limit && pending.length) {
      const item = pending.shift()
      active++
      let result
      try {
        result = item.task()
      } catch (error) {
        result = Promise.reject(error)
      }
      Promise.resolve(result)
        .catch(item.onError)
        .finally(() => {
          active--
          drain()
        })
    }
  }

  return {
    enqueue(task, onError = () => {}) {
      pending.push({ task, onError })
      drain()
    },
    stats() {
      return { active, queued: pending.length, concurrency: limit }
    },
  }
}
