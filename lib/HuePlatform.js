// homebridge-hue/lib/HuePlatform.js
// Copyright © 2016-2021 Erik Baauw. All rights reserved.
//
// Homebridge plugin for Philips Hue and/or deCONZ.

'use strict'

const fs = require('fs').promises
const semver = require('semver')
const zlib = require('zlib')

const homebridgeLib = require('homebridge-lib')
const HueBridgeModule = require('./HueBridge')
const HueBridge = HueBridgeModule.HueBridge
const HueDiscovery = require('../lib/HueDiscovery')
const packageJson = require('../package.json')

module.exports = HuePlatform

function minVersion (range) {
  let s = range.split(' ')[0]
  while (s) {
    if (semver.valid(s)) {
      break
    }
    s = s.slice(1)
  }
  return s || undefined
}

async function gzip (data) {
  return new Promise((resolve, reject) => {
    zlib.gzip(data, (error, result) => {
      if (error) {
        return reject(error)
      }
      resolve(result)
    })
  })
}

const formatError = homebridgeLib.formatError

let alreadyInConfigJson

// ===== HuePlatform ===========================================================

function HuePlatform (log, configJson, homebridge) {
  this.log = log
  this.api = homebridge
  this.packageJson = packageJson
  this.configJson = configJson
  const my = new homebridgeLib.MyHomeKitTypes(homebridge)
  const eve = new homebridgeLib.EveHomeKitTypes(homebridge)
  HueBridgeModule.setHomebridge(homebridge, my, eve)
  homebridge.on('shutdown', () => { this._shuttingDown = true })
  process.on('exit', () => { this.log('goodbye') })
  this.identify()

  const usernames = []
  for (const bridgeId in this.configJson.users) {
    usernames.push(this.configJson.users[bridgeId])
  }
  this.log.debug(
    'config.json: %s',
    this.maskUsernames(usernames, this.maskConfigJson(this.configJson))
  )

  this.config = {
    anyOn: true,
    brightnessAdjustment: 100,
    effects: true,
    excludeSensorTypes: [],
    forceHttp: false,
    heartrate: 5,
    hosts: [],
    lowBattery: 25,
    nativeHomeKitLights: true,
    nativeHomeKitSensors: true,
    resetTimeout: 500,
    resource: true,
    timeout: 5,
    users: {},
    waitTimePut: 50,
    waitTimePutGroup: 1000,
    waitTimeResend: 300,
    waitTimeUpdate: 20
  }
  const optionParser = new homebridgeLib.OptionParser(this.config, true)
  optionParser
    .stringKey('name')
    .stringKey('platform')
    .boolKey('anyOn')
    .intKey('brightnessAdjustment', 10, 100)
    .boolKey('configuredName')
    .boolKey('effects')
    .arrayKey('excludeSensorTypes')
    .boolKey('forceEveWeather')
    .boolKey('forceHttp')
    .boolKey('groups')
    .boolKey('group0')
    .intKey('heartrate', 1, 30)
    .arrayKey('hosts')
    .boolKey('hueDimmerRepeat')
    .boolKey('hueMotionTemperatureHistory')
    .boolKey('lights')
    .boolKey('linkButton')
    .intKey('lowBattery', 0, 100)
    .boolKey('nativeHomeKitLights')
    .boolKey('nativeHomeKitSensors')
    .boolKey('noResponse')
    .intKey('parallelRequests', 1, 30)
    .boolKey('resetTimeout', 10, 2000)
    .boolKey('resource')
    .boolKey('rooms')
    .boolKey('rules')
    .boolKey('scenes')
    .boolKey('scenesAsSwitch')
    .boolKey('schedules')
    .boolKey('sensors')
    .boolKey('stealth')
    .intKey('timeout', 5, 30)
    .objectKey('users')
    .intKey('waitTimePut', 0, 50)
    .intKey('waitTimePutGroup', 0, 1000)
    .intKey('waitTimeResend', 100, 1000)
    .intKey('waitTimeUpdate', 0, 500)
    .boolKey('wallSwitch')
    .on('userInputError', (error) => {
      this.log.warn('config.json: %s', formatError(error))
    })
  try {
    optionParser.parse(configJson)
    this.config.brightnessAdjustment /= 100
    const excludeSensorTypes = this.config.excludeSensorTypes
    this.config.excludeSensorTypes = {}
    for (const type of excludeSensorTypes) {
      this.config.excludeSensorTypes[type] = true
      switch (type) {
        case 'ZLLPresence':
          this.config.excludeSensorTypes.ZHAPresence = true
          break
        case 'ZLLLightLevel':
          this.config.excludeSensorTypes.ZHALightLevel = true
          break
        case 'ZLLTemperature':
          this.config.excludeSensorTypes.ZHATemperature = true
          break
        case 'ZLLRelativeRotary':
          this.config.excludeSensorTypes.ZHARelativeRotary = true
          break
        case 'ZLLSwitch':
          this.config.excludeSensorTypes.ZHASwitch = true
          break
        default:
          break
      }
    }
  } catch (error) {
    this.log.error(error)
    process.kill(process.pid, 'SIGTERM')
    return
  }

  this.log.debug(
    'config: %s',
    this.maskUsernames(usernames, this.maskConfigJson(this.config))
  )

  this.hueDiscovery = new HueDiscovery({
    forceHttp: this.config.forceHttp,
    timeout: this.config.timeout
  })
  this.hueDiscovery
    .on('error', (error) => {
      this.log(
        '%s: request %d: %s %s', this.maskHost(error.request.name),
        error.request.id, error.request.method, error.request.resource
      )
      this.log.warn(
        '%s: request %d: %s', error.request.name, error.request.id,
        formatError(error)
      )
    })
    .on('request', (request) => {
      this.log.debug(
        '%s: request %d: %s %s', this.maskHost(request.name),
        request.id, request.method, request.resource
      )
    })
    .on('response', (response) => {
      this.log.debug(
        '%s: request %d: %d %s', this.maskHost(response.request.name),
        response.request.id, response.statusCode, response.statusMessage
      )
    })
    .on('found', (name, id, address) => {
      this.log.debug('%s: found %s at %s', name, id, this.maskHost(address))
    })
    .on('searching', (host) => {
      this.log.debug('upnp: listening on %s', host)
    })
    .on('searchDone', () => { this.log.debug('upnp: search done') })

  this.bridgeMap = {}
}

HuePlatform.prototype.accessories = async function (callback) {
  const accessoryList = []

  if (alreadyInConfigJson) {
    this.log.error('config.json: duplicate entry for Hue platform\nTHIS WILL CAUSE HOMEBRDIGE TO FAIL IN FUTURE VERSIONS OF HOMEBRIDGE HUE')
    this.log.warn('config.json: ignore duplicate entry for Hue platform')
    return callback(accessoryList)
  }
  alreadyInConfigJson = true

  try {
    const jobs = []
    const foundBridges = await this.findBridges()
    for (const host in foundBridges) {
      if (this.bridgeMap[foundBridges[host].bridgeid] != null) {
        this.log.warn(
          '%s: %s already found under %s', this.maskHost(host),
          foundBridges[host].bridgeid,
          this.maskHost(this.bridgeMap[foundBridges[host].bridgeid].host)
        )
        continue
      }
      const bridge = new HueBridge(this, host, foundBridges[host])
      this.bridgeMap[foundBridges[host].bridgeid] = bridge
      jobs.push(bridge.accessories())
    }
    const accessoriesList = await Promise.all(jobs)
    for (const accessories of accessoriesList) {
      for (const accessory of accessories) {
        accessoryList.push(accessory)
      }
    }
    await this.dump()
  } catch (error) {
    this.log.error(formatError(error))
  }

  if (accessoryList.length > 0) {
    // Setup heartbeat.
    this._heartbeatStart = new Date()
    setTimeout(() => { this._beat(-1) }, 1000)
  }

  try {
    callback(accessoryList)
  } catch (error) {
    this.log.error('homebridge: error: %s', formatError(error))
  }

  if (this.config.stealth) {
    return
  }

  try {
    const npmRegistry = new homebridgeLib.HttpClient({
      https: true,
      host: 'registry.npmjs.org',
      json: true,
      maxSockets: 1
    })
    npmRegistry
      .on('error', (error) => {
        this.log(
          'npm registry: request %d: %s %s', error.request.id,
          error.request.method, error.request.resource
        )
        this.log.warn(
          'npm registry: request %d: %s', error.request.id, formatError(error)
        )
      })
      .on('request', (request) => {
        this.log.debug(
          'npm registry: request %d: %s %s', request.id,
          request.method, request.resource
        )
      })
      .on('response', (response) => {
        this.log.debug(
          'npm registry: request %d: %d %s', response.request.id,
          response.statusCode, response.statusMessage
        )
      })
    const { body } = await npmRegistry.get(
      '/' + packageJson.name + '/latest', { Accept: 'application/json' }
    )
    if (body != null && body.version != null) {
      if (body.version !== packageJson.version) {
        this.log.warn(
          'warning: latest version: %s v%s', packageJson.name, body.version
        )
      } else {
        this.log.debug(
          'latest version: %s v%s', packageJson.name, body.version
        )
      }
    }
  } catch (error) {
    if (error.request == null) {
      this.log.error(formatError(error))
    }
  }
}

HuePlatform.prototype._beat = function (beat) {
  beat += 1
  const drift = new Date() - this._heartbeatStart - 1000 * (beat + 1)
  if (this._shuttingDown) {
    this.log.debug('last heartbeat %d, drift %d', beat, drift)
    return
  }
  if (drift < -250 || drift > 250) {
    this.log.warn('heartbeat %d, drift %d', beat, drift)
  }
  setTimeout(() => { this._beat(beat) }, 1000 - drift)
  for (const bridgeid in this.bridgeMap) {
    this.bridgeMap[bridgeid].heartbeat(beat)
  }
}

// ===== Troubleshooting =======================================================

HuePlatform.prototype.identify = function () {
  this.log.info(
    '%s v%s, node %s, homebridge v%s', packageJson.name,
    packageJson.version, process.version, this.api.serverVersion
  )
  if (semver.clean(process.version) !== minVersion(packageJson.engines.node)) {
    this.log.warn(
      'warning: recommended version: node v%s LTS',
      minVersion(packageJson.engines.node)
    )
  }
  if (this.api.serverVersion !== minVersion(packageJson.engines.homebridge)) {
    this.log.warn(
      'warning: recommended version: homebridge v%s',
      minVersion(packageJson.engines.homebridge)
    )
  }
}

HuePlatform.prototype.dump = async function () {
  const usernames = []
  const obj = {
    versions: {
      node: process.version,
      homebridge: 'v' + this.api.serverVersion
    },
    config: this.maskConfigJson(this.configJson),
    bridges: []
  }
  for (const bridgeId in this.configJson.users) {
    usernames.push(this.configJson.users[bridgeId])
  }
  obj.versions[packageJson.name] = 'v' + packageJson.version
  for (const bridgeid in this.bridgeMap) {
    const state = this.bridgeMap[bridgeid].fullState
    if (state !== undefined && state.config !== undefined) {
      state.config.ipaddress = this.maskHost(state.config.ipaddress)
      state.config.gateway = this.maskHost(state.config.gateway)
      if (state.config.proxyaddress !== 'none') {
        state.config.proxyaddress = this.maskHost(state.config.proxyaddress)
      }
      for (const username in state.config.whitelist) {
        usernames.push(username)
      }
    }
    obj.bridges.push(state)
  }
  const filename = this.api.user.storagePath() + '/' +
                   packageJson.name + '.json.gz'
  try {
    const data = await gzip(this.maskUsernames(usernames, obj))
    await fs.writeFile(filename, data)
    this.log.info('masked debug info dumped to %s', filename)
  } catch (error) {
    this.log.error('error: %s: %s', filename, formatError(error))
  }
}

HuePlatform.prototype.maskHost = function (host = '') {
  const elt = host.split('.')
  return elt.length === 4 && host !== '127.0.0.1'
    ? [elt[0], '***', '***', elt[3]].join('.')
    : host
}

HuePlatform.prototype.maskConfigJson = function (configJson) {
  const json = {}
  Object.assign(json, configJson)
  if (configJson.hosts != null) {
    json.hosts = []
    for (const host of configJson.hosts) {
      json.hosts.push(this.maskHost(host))
    }
  }
  return json
}

HuePlatform.prototype.maskUsernames = function (usernames, json) {
  let s = JSON.stringify(json)
  let i = 0
  for (const username of usernames) {
    i += 1
    const regexp = RegExp(username, 'g')
    let mask = username.replace(/./g, '*')
    mask = (mask + i).slice(-username.length)
    s = s.replace(regexp, mask)
  }
  return s
}

// ===== Bridge Discovery ======================================================

// Return promise to list of ipaddresses of found Hue bridges.
HuePlatform.prototype.findBridges = async function () {
  if (this.config.hosts.length > 0) {
    const map = {}
    for (const host of this.config.hosts) {
      try {
        map[host] = await this.hueDiscovery.config(host)
      } catch (error) {
        this.log.error('%s: not found - retrying in 30s', host)
        await homebridgeLib.timeout(30000)
        return this.findBridges()
      }
    }
    return map
  }
  try {
    this.log.info(
      'searching bridges and gateways%s',
      this.config.stealth ? ' (stealth mode)' : ''
    )
    const map = await this.hueDiscovery.discover(this.config.stealth)
    if (Object.keys(map).length > 0) {
      return map
    }
    this.log.info('no bridges or gateways found - retrying in 30s')
    await homebridgeLib.timeout(30000)
    return this.findBridges()
  } catch (error) {
    this.log.error(formatError(error))
  }
}
