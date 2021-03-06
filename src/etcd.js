const Etcd = require('node-etcd')
const Lock = require('etcd-lock')
const DEFAULT_URL = 'http://localhost:2379'
const LOCK_ID = 'kickerd'
const LOCK_TTL = 5

function applyChange (config, change) {
  let match = false
  const key = getKey(config.prefix, change.node.key)
  const value = change.node.value
  config.sets.forEach(set => {
    if (set.key === key) {
      if (change.action === 'set') {
        set.value = value
      } else if (change.action === 'delete') {
        delete set.value
      }
      match = true
    }
  })
  if (!match && change.action === 'set') {
    config.sets.push({
      key: key,
      value: value,
      type: /['"A-Za-z]/.test(value) ? 'string' : 'number'
    })
  }
}

function applyKeys (config, keys) {
  config.sets.forEach(set => {
    const etcdValue = keys[set.key]
    if (etcdValue) {
      if (!set.type) {
        set.type = /['"A-Za-z:]/.test(etcdValue) ? 'string' : 'number'
      }
      set.value = etcdValue
    }
  })
  return config
}

function fetchConfig (client, config) {
  return new Promise((resolve, reject) => {
    client.get(config.prefix, (err, response) => {
      if (err) {
        reject(err)
      } else {
        const hash = response.node.nodes.reduce((acc, node) => {
          const key = getKey(config.prefix, node.key)
          acc[key] = node.value
          return acc
        }, {})
        applyKeys(config, hash)
        resolve(hash)
      }
    })
  })
}

function getKey (prefix, fullKey) {
  return fullKey.split(prefix)[1].slice(1)
}

function lockRestart (client, config) {
  if (!config.lock) {
    const lock = new Lock(client, `${config.prefix}-lock`, LOCK_ID, config.lockTtl || LOCK_TTL)
    config.lock = lock
  }
  return config.lock
}

function watch (client, config, onChange) {
  const watcher = client.watcher(config.prefix, null, {recursive: true})
  watcher.on('change', (change) => {
    applyChange(config, change)
    onChange(change)
  })
  config.watcher = watcher
}

module.exports = function (options = { url: DEFAULT_URL }) {
  const client = new Etcd(options.url)
  return {
    fetchConfig: fetchConfig.bind(null, client),
    lockRestart: lockRestart.bind(null, client),
    watch: watch.bind(null, client)
  }
}
