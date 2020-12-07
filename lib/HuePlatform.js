// homebridge-hue/lib/HuePlatform.js
// Copyright © 2016-2020 Erik Baauw. All rights reserved.
//
// Homebridge plugin for Philips Hue and/or deCONZ.
//
// HuePlatform provides the platform for support Philips Hue bridges and
// connected devices.  The platform provides discovery of bridges and setting
// up a heartbeat to poll the bridges.
//
// Todo:
// - Dynamic homebridge accessories.
// - Store user (bridge password) in context of homebridge accessory for bridge.

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

function toIntBetween (value, minValue, maxValue, defaultValue) {
  const n = Number(value)
  if (isNaN(n) || n !== Math.floor(n) || n < minValue || n > maxValue) {
    return defaultValue
  }
  return n
}

function minVersion (range) {
  let s = range.split(' ')[0]
  while (s) {
    if (semver.valid(s)) {
      break
    }
    s = s.substring(1)
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

const formatError = homebridgeLib.CommandLineTool.formatError

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

  this.config = {
    anyOn: true,
    brightnessAdjustment: 1,
    effects: true,
    excludeSensorTypes: {},
    forceHttp: false,
    groups: false,
    group0: false,
    heartrate: 5,
    hosts: [],
    lights: false,
    lowBattery: 25,
    nativeHomeKitLights: true,
    nativeHomeKitSensors: true,
    nupnp: true,
    resetTimeout: 500,
    resource: true,
    rooms: false,
    rules: false,
    schedules: false,
    sensors: false,
    timeout: 5,
    users: {},
    waitTimeResend: 300,
    waitTimeUpdate: 20,
    wallSwitch: false
  }
  for (const key in configJson) {
    const value = configJson[key]
    switch (key.toLowerCase()) {
      case 'anyon':
        this.config.anyOn = !!value
        break
      case 'brightnessadjustment':
        this.config.brightnessAdjustment = toIntBetween(
          value, 10, 100, 100
        ) / 100
        break
      case 'effects':
        this.config.effects = !!value
        break
      case 'excludesensortypes':
        if (Array.isArray(value)) {
          for (const type of value) {
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
        } else {
          this.log.warn(
            'config.json: %s: warning: ignoring non-array value', key
          )
        }
        break
      case 'forceeveweather':
        this.config.forceEveWeather = !!value
        break
      case 'forcehttp':
        this.config.forceHttp = !!value
        break
      case 'groups':
        this.config.groups = !!value
        break
      case 'group0':
        this.config.group0 = !!value
        break
      case 'heartrate':
        this.config.heartrate = toIntBetween(
          value, 1, 30, this.config.heartrate
        )
        break
      case 'host':
        this.log.warn(
          'config.json: warning: %s: deprecated, please use hosts', key
        )
        // fallsthrough
      case 'hosts':
        if (typeof value === 'string') {
          if (value !== '') {
            this.config.hosts.push(value)
          }
        } else if (Array.isArray(value)) {
          for (const host of value) {
            if (typeof host === 'string' && host !== '') {
              this.config.hosts.push(host)
            }
          }
        } else {
          this.log.warn(
            'config.json: warning: %s: ignoring non-array, non-string value %j',
            key, value
          )
        }
        break
      case 'huedimmerrepeat':
        this.config.hueDimmerRepeat = !!value
        break
      case 'huemotiontemperaturehistory':
        this.config.hueMotionTemperatureHistory = !!value
        break
      case 'lights':
        this.config.lights = !!value
        break
      case 'linkbutton':
        this.config.linkbutton = !!value
        break
      case 'lowbattery':
        this.config.lowBattery = toIntBetween(
          value, 0, 100, this.config.lowBattery
        )
        break
      case 'name':
        this.name = value
        break
      case 'nativehomekitlights':
        this.config.nativeHomeKitLights = !!value
        break
      case 'nativehomekitsensors':
        this.config.nativeHomeKitSensors = !!value
        break
      case 'nupnp':
        this.config.nupnp = !!value
        break
      case 'parallelrequests':
        this.config.parallelRequests = toIntBetween(
          value, 1, 30, this.config.parallelRequests
        )
        break
      case 'platform':
        break
      case 'resettimeout':
        this.config.resetTimeout = toIntBetween(
          value, 10, 2000, this.config.resetTimeout
        )
        break
      case 'resource':
        this.config.resource = !!value
        break
      case 'rooms':
        this.config.rooms = !!value
        break
      case 'rules':
        this.config.rules = !!value
        break
      case 'scenes':
        this.config.scenes = !!value
        break
      case 'scenesasswitch':
        this.config.scenesAsSwitch = !!value
        break
      case 'schedules':
        this.config.schedules = !!value
        break
      case 'sensors':
        this.config.sensors = !!value
        break
      case 'timeout':
        this.config.timeout = toIntBetween(
          value, 5, 30, this.config.timeout
        )
        break
      case 'users':
        this.config.users = value
        break
      case 'waittimeresend':
        this.config.waitTimeResend = toIntBetween(
          value, 100, 1000, this.config.waitTimeResend
        )
        break
      case 'waittimeupdate':
        this.config.waitTimeUpdate = toIntBetween(
          value, 0, 500, this.config.waitTimeUpdate
        )
        break
      case 'wallswitch':
        this.config.wallSwitch = !!value
        break
      default:
        this.log.warn('config.json: warning: %s: ignoring unknown key', key)
        break
    }
  }
  this.hueDiscovery = new HueDiscovery({
    forceHttp: this.config.forceHttp,
    timeout: this.config.timeout,
    nupnp: this.config.nupnp
  })
  this.bridgeMap = {}
  this.bridges = []
  this.identify()
}

HuePlatform.prototype.accessories = async function (callback) {
  const accessoryList = []

  try {
    const npmClient = new homebridgeLib.HttpClient({
      https: !this.config.forceHttp,
      host: 'registry.npmjs.org',
      json: true
    })
    npmClient.on('request', (id, method, resource, body, url) => {
      this.log.debug('npm registry: request %d: %s %s', id, method, resource)
    })
    npmClient.on('response', (id, code, message, body) => {
      this.log.debug('npm registry: request %d: %d %s', id, code, message)
    })
    npmClient.on('error', (error, id, method, resource, body) => {
      this.log('npm registry: request %d: %s %s', id, method, resource)
      this.log.warn(
        'warning: npm registry: request %d: communication error: %s',
        id, formatError(error)
      )
    })
    const response = await npmClient.get(
      '/' + packageJson.name + '/latest', { Accept: 'application/json' }
    )
    if (response != null && response.body != null && response.body.version != null) {
      const latest = response.body.version
      if (latest !== packageJson.version) {
        this.log.warn('warning: latest version: %s v%s', packageJson.name, latest)
      } else {
        this.log.debug('latest version: %s v%s', packageJson.name, latest)
      }
    }
  } catch (error) {
    this.log.warn('warning: npm registry: communication error: %s', formatError(error))
  }

  const usernames = []
  for (const bridgeId in this.configJson.users) {
    usernames.push(this.configJson.users[bridgeId])
  }
  this.log.debug(
    'config.json: %s',
    this.maskUsernames(usernames, this.maskConfigJson(this.configJson))
  )

  try {
    const jobs = []
    for (const host of await this.findBridges()) {
      const bridge = new HueBridge(this, host)
      this.bridges.push(bridge)
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
  for (const bridge of this.bridges) {
    bridge.heartbeat(beat)
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
      'warning: not using recommended node version v%s LTS',
      minVersion(packageJson.engines.node)
    )
  }
  // if (this.api.serverVersion !== minVersion(packageJson.engines.homebridge)) {
  //   this.log.warn(
  //     'warning: not using recommended homebridge version v%s',
  //     minVersion(packageJson.engines.homebridge)
  //   )
  // }
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
  for (const bridge of this.bridges) {
    const state = bridge.fullState
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
  if (typeof configJson.host === 'string') {
    json.host = this.maskHost(configJson.host)
  } else if (Array.isArray(configJson.host)) {
    for (const id in configJson.host) {
      json.host[id] = this.maskHost(configJson.host[id])
    }
  }
  if (typeof configJson.hosts === 'string') {
    json.hosts = this.maskHost(configJson.hosts)
  } else if (Array.isArray(configJson.hosts)) {
    for (const id in configJson.hosts) {
      json.hosts[id] = this.maskHost(configJson.hosts[id])
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
    const list = []
    for (const host of this.config.hosts) {
      list.push(host)
    }
    return list
  }
  try {
    this.log.info('searching bridges and gateways')
    const map = await this.hueDiscovery.discover()
    const hosts = []
    for (const host in map) {
      this.log.debug(
        'found bridge %s at %s', map[host].toUpperCase(), this.maskHost(host)
      )
      hosts.push(host)
    }
    if (hosts.length > 0) {
      return hosts
    }
    this.log.info('no bridges or gateways found - retrying in 30 seconds')
    await homebridgeLib.timeout(30000)
    return this.findBridges()
  } catch (error) {
    this.log.error(formatError(error))
  }
}
