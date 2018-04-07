// homebridge-hue/lib/HuePlatform.js
// Copyright © 2016-2018 Erik Baauw. All rights reserved.
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

const deferred = require('deferred')
const dgram = require('dgram')
const fs = require('fs')
const request = require('request')
const semver = require('semver')
const zlib = require('zlib')

const homebridgeHueUtils = require('homebridge-hue-utils')
const MyHomeKitTypes = homebridgeHueUtils.MyHomeKitTypes
const EveHomeKitTypes = homebridgeHueUtils.EveHomeKitTypes
const HueBridgeModule = require('./HueBridge')
const HueBridge = HueBridgeModule.HueBridge
const packageJson = require('../package.json')

module.exports = {
  HuePlatform: HuePlatform,
  setHomebridge: setHomebridge
}

// Parse a UPnP message into an object
function upnpParseMessage (message) {
  const obj = {}
  const lines = message.toString().split('\r\n')
  if (lines && lines[0]) {
    obj.status = lines[0]
    for (const line of lines) {
      const fields = line.split(': ')
      if (fields.length === 2) {
        obj[fields[0].toLowerCase()] = fields[1]
      }
    }
  }
  return obj
}

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

// ===== Homebridge ============================================================

let homebridgeVersion

function setHomebridge (homebridge) {
  homebridgeVersion = homebridge.serverVersion
  const my = new MyHomeKitTypes(homebridge)
  const eve = new EveHomeKitTypes(homebridge)

  HueBridgeModule.setHomebridge(homebridge, my, eve)
}

// ===== HuePlatform ===========================================================

function HuePlatform (log, configJson, api) {
  this.log = log
  this.api = api
  this.packageJson = packageJson
  this.configJson = configJson
  this.config = {
    excludeSensorTypes: {},
    groups: false,
    group0: false,
    heartrate: 5,
    hosts: [],
    lights: false,
    linkbutton: true,
    lowBattery: 25,
    nativeHomeKitLights: true,
    nativeHomeKitSensors: true,
    nupnp: true,
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
      case 'resource':
        this.config.resource = !!value
        break
      case 'rooms':
        this.config.rooms = !!value
        break
      case 'rules':
        this.config.rules = !!value
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
  this.bridgeMap = {}
  this.bridges = []
  this.identify()
}

HuePlatform.prototype.accessories = function (callback) {
  let accessoryList = []

  this.request(
    'npm registry', 'https://registry.npmjs.org/', packageJson.name
  ).then((response) => {
    if (
      response && response['dist-tags'] &&
      response['dist-tags'].latest !== packageJson.version
    ) {
      this.log.warn(
        'warning: lastest version: %s v%s', packageJson.name,
        response['dist-tags'].latest
      )
    }
  }).catch((err) => {
    this.log.error(err)
  }).then(() => {
    const usernames = []
    for (const bridgeId in this.configJson.users) {
      usernames.push(this.configJson.users[bridgeId])
    }
    this.log.debug(
      'config.json: %s',
      this.maskUsernames(usernames, this.maskConfigJson(this.configJson))
    )
    return this.findBridges().map((host) => {
      const bridge = new HueBridge(this, host)
      this.bridges.push(bridge)
      return bridge.accessories()
    }).map((list) => {
      for (const a of list) {
        accessoryList.push(a)
      }
    })
  }).then(() => {
    return this.dump()
  }).then(() => {
    if (accessoryList.length > 0) {
      // Setup heartbeat.
      let beat = -1
      setInterval(() => {
        beat += 1
        beat %= 7 * 24 * 3600
        for (const bridge of this.bridges) {
          bridge.heartbeat(beat)
        }
      }, 1000)
    }
    while (accessoryList.length > 99) {
      const a = accessoryList.pop()
      this.log.error('too many accessories, ignoring %s', a.name)
    }
    callback(accessoryList)
  }).catch((err) => {
    this.log.error(err)
    callback(accessoryList) // Not going to help if error was thrown by callback().
  })
}

// ===== Troubleshooting =======================================================

HuePlatform.prototype.identify = function () {
  this.log.info(
    '%s v%s, node %s, homebridge v%s', packageJson.name,
    packageJson.version, process.version, homebridgeVersion
  )
  if (semver.clean(process.version) !== minVersion(packageJson.engines.node)) {
    this.log.warn(
      'warning: not using recommended node version v%s LTS',
      minVersion(packageJson.engines.node)
    )
  }
  if (homebridgeVersion !== minVersion(packageJson.engines.homebridge)) {
    this.log.warn(
      'warning: not using recommended homebridge version v%s',
      minVersion(packageJson.engines.homebridge)
    )
  }
}

HuePlatform.prototype.dump = function () {
  let d = deferred()
  let usernames = []
  let obj = {
    versions: {
      node: process.version,
      homebridge: 'v' + homebridgeVersion
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
    zlib.gzip(this.maskUsernames(usernames, obj), (err, data) => {
      if (err) {
        this.log.error('cannot create %s: error %s', filename, err.code)
        return d.resolve(true)
      }
      fs.writeFile(filename, data, (err) => {
        if (err) {
          this.log.error('cannot create %s: error %s', filename, err.code)
          return d.resolve(true)
        }
        this.log.info('masked debug info dumped to %s', filename)
        d.resolve(true)
      })
    })
  } catch (err) {
    this.log.error(err)
    d.resolve(true)
  }
  return d.promise
}

HuePlatform.prototype.maskHost = function (host) {
  const elt = host.split('.')
  return elt.length === 4 && host !== '127.0.0.1'
    ? [elt[0], '***', '***', elt[3]].join('.') : host
}

HuePlatform.prototype.maskConfigJson = function (configJson) {
  let json = {}
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
HuePlatform.prototype.findBridges = function () {
  if (this.config.hosts.length > 0) {
    const list = []
    for (const host of this.config.hosts) {
      list.push(host)
    }
    return deferred(list)
  }
  const d = deferred()
  deferred(
    this.upnpSearch(),
    this.meethueSearch(), this.deconzSearch(), this.deconzSearch(true)
  ).then((lists) => {
    const map = {}
    for (const list of lists) {
      for (const ip of list) {
        map[ip] = true
      }
    }
    const bridges = Object.keys(map)
    if (bridges.length > 0) {
      return d.resolve(bridges)
    }
    this.log.info('no bridges found - retrying in 30 seconds')
    setTimeout(() => {
      this.log.info('searching bridges')
      d.resolve(this.findBridges())
    }, 30000)
  }).catch((err) => {
    this.log.error(err)
  })
  return d.promise
}

// Get Hue bridges from meethue portal.
HuePlatform.prototype.meethueSearch = function () {
  if (!this.config.nupnp) {
    return deferred([])
  }
  const name = 'meethue portal'
  const d = deferred()
  const list = []
  this.request(name, 'https://www.meethue.com/', 'api/nupnp')
    .then((responseBody) => {
      if (Array.isArray(responseBody)) {
        for (const bridge of responseBody) {
          this.log.debug(
            '%s: found bridge %s at %s', name,
            bridge.id.toUpperCase(), this.maskHost(bridge.internalipaddress)
          )
          list.push(bridge.internalipaddress)
        }
      }
      d.resolve(list)
    }).catch((e) => {
      this.log.error('%s:', name, e)
      d.resolve([])
    })
  return d.promise
}

// Get deCONZ gateways from dresden appspot.
HuePlatform.prototype.deconzSearch = function (ipv6) {
  if (!this.config.nupnp) {
    return deferred([])
  }
  const name = 'dresden appspot ' + (ipv6 ? 'ipv6' : 'ipv4')
  const d = deferred()
  const list = []
  this.request(
    name, 'https://dresden-light.appspot.com/', 'discover', ipv6
  ).then((responseBody) => {
    if (Array.isArray(responseBody)) {
      for (const bridge of responseBody) {
        this.log.debug(
          '%s: found gateway %s at %s', name,
          bridge.id.toUpperCase(), this.maskHost(bridge.internalipaddress)
        )
        list.push(bridge.internalipaddress)
      }
    }
    d.resolve(list)
  }).catch((e) => {
    this.log.error('%s:', name, e)
    d.resolve([])
  })
  return d.promise
}

// Do a UPnP search for Hue bridges.
HuePlatform.prototype.upnpSearch = function () {
  const d = deferred()
  const list = []
  const map = {}
  const upnp = {
    ipaddress: '239.255.255.250',
    port: 1900
  }
  const socket = dgram.createSocket('udp4')
  const request = Buffer.from([
    'M-SEARCH * HTTP/1.1',
    'HOST: ' + upnp.ipaddress + ':' + upnp.port,
    'MAN: "ssdp:discover"',
    'MX: ' + this.config.timeout,
    'ST: upnp:rootdevice',
    ''
  ].join('\r\n'))
  socket.on('message', (message, rinfo) => {
    const response = upnpParseMessage(message)
    if (
      response.status === 'HTTP/1.1 200 OK' &&
      response.st && response.st === 'upnp:rootdevice' &&
      (response['hue-bridgeid'] || response['gwid.phoscon.de'])
    ) {
      const ipaddress = rinfo.address
      const bridgeid = response['hue-bridgeid'] || response['gwid.phoscon.de']
      if (!map[ipaddress]) {
        this.log.debug(
          'upnp search: found bridge %s at %s', bridgeid,
          this.maskHost(ipaddress)
        )
        map[ipaddress] = bridgeid
        list.push(ipaddress)
      }
    }
  })
  socket.on('error', (err) => {
    this.log.error('upnp search: error %s', err.code)
    socket.close()
    d.resolve(list)
  })
  socket.on('listening', () => {
    this.log.debug(
      'upnp search: searching at %s:%d for %d seconds',
      upnp.ipaddress, upnp.port, this.config.timeout
    )
    setTimeout(() => {
      socket.close()
      this.log.debug('upnp search: done')
      d.resolve(list)
    }, 1000 * this.config.timeout)
  })
  socket.send(
    request, 0, request.length, upnp.port, upnp.ipaddress
  )
  return d.promise
}

// Get resource from url.
HuePlatform.prototype.request = function (site, url, resource, ipv6) {
  const d = deferred()
  const requestObj = {
    method: 'GET',
    url: url + resource,
    timeout: 1000 * this.config.timeout,
    json: true
  }
  requestObj.family = ipv6 ? 6 : 4
  this.log.debug('%s: get /%s', site, resource)
  request(requestObj, (err, response, responseBody) => {
    if (err) {
      this.log.error('%s: communication error %s on %s', site, err.code, url)
      return d.resolve(null)
    }
    if (response.statusCode !== 200) {
      this.log.error(
        '%s: status %s %s', site, response.statusCode, response.statusMessage
      )
      return d.resolve(null)
    }
    this.log.debug('%s: get /%s ok', site, resource)
    return d.resolve(responseBody)
  })
  return d.promise
}
