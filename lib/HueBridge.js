// homebridge-hue/lib/HueBridge.js
// Copyright © 2016-2019 Erik Baauw. All rights reserved.
//
// Homebridge plugin for Philips Hue and/or deCONZ.
//
// HueBridge provides support for Philips Hue bridges and dresden elektronik
// deCONZ gateways.
//
// Todo:
// - Support rules in separate accessories.

'use strict'

const deferred = require('deferred')
const os = require('os')
const request = require('request')
const semver = require('semver')
const util = require('util')
const WebSocket = require('ws')

const HueAccessoryModule = require('./HueAccessory')
const HueSensorModule = require('./HueSensor')
const HueScheduleModule = require('./HueSchedule')
const HueAccessory = HueAccessoryModule.HueAccessory
const HueSensor = HueSensorModule.HueSensor
const HueSchedule = HueScheduleModule.HueSchedule

module.exports = {
  setHomebridge: setHomebridge,
  HueBridge: HueBridge
}

// ===== Homebridge ============================================================

let Service
let Characteristic
let my

function setHomebridge (homebridge, _my, _eve) {
  HueAccessoryModule.setHomebridge(homebridge, _my, _eve)
  HueScheduleModule.setHomebridge(homebridge, _my)
  Service = homebridge.hap.Service
  Characteristic = homebridge.hap.Characteristic
  my = _my
}

// ===== HueBridge =============================================================

function HueBridge (platform, host) {
  this.log = platform.log
  this.platform = platform
  this.host = host.split(':')[0]
  this.name = this.platform.maskHost(host)
  this.url = 'http://' + host + '/api'
  this.type = 'bridge'
  this.defaultTransitiontime = 0.4
  this.state = {
    heartrate: this.platform.config.heartrate,
    transitiontime: this.defaultTransitiontime,
    request: 0,
    lights: 0,
    groups: 0,
    group0: 0,
    sensors: 0,
    schedules: 0,
    rules: 0
  }
  this.serviceList = []
  this.lights = {}
  this.groups = {}
  this.sensors = {}
  this.schedules = {}
  this.rules = {}
}

HueBridge.prototype.getServices = function () {
  this.log.info('%s: %d services', this.name, this.serviceList.length)
  return this.serviceList
}

HueBridge.prototype.accessories = function () {
  this.accessoryMap = {}
  this.accessoryList = []
  return this.getConfig()
    .then((obj) => {
      return this.exposeBridge(obj)
    }).then(() => {
      return this.createUser()
    }).then(() => {
      return this.getFullState()
    }).then((state) => {
      this.fullState = state
      return this.exposeResources(state)
    }).catch((err) => {
      if (err.message !== 'unknown bridge') {
        this.log.error('%s:', this.name, err)
      }
    }).then(() => {
      this.log.info('%s: %d accessories', this.name, this.accessoryList.length)
      return this.accessoryList
    })
}

HueBridge.prototype.getConfig = function () {
  const d = deferred()

  this._request('get', '/config').then((obj) => {
    d.resolve(obj)
  }).catch((err) => {
    if (err.message) {
      this.log.error('%s: %s', this.name, err.message)
    }
    setTimeout(() => {
      d.resolve(this.getConfig())
    }, 15000)
  })
  return d.promise
}

HueBridge.prototype.getInfoService = function () {
  return this.infoService
}

HueBridge.prototype.exposeBridge = function (obj) {
  this.name = obj.name
  this.serialNumber = obj.bridgeid
  // jshint -W106
  this.uuid_base = this.serialNumber
  // jshint +W106
  this.username = this.platform.config.users[this.serialNumber] || ''
  this.config = {
    parallelRequests: 10,
    nativeHomeKitLights: this.platform.config.nativeHomeKitLights,
    nativeHomeKitSensors: this.platform.config.nativeHomeKitSensors
  }
  this.model = obj.modelid
  if (
    this.model === 'BSB002' && obj.bridgeid.substring(0, 6) !== '001788' &&
    obj.bridgeid.substring(0, 6) !== 'ECB5FA'
  ) {
    this.model = 'HA-Bridge'
  }
  const recommendedVersion = this.platform.packageJson.engines[obj.modelid]
  switch (this.model) {
    case 'BSB001': // Philips Hue v1 (round) bridge;
      this.config.parallelRequests = 3
      this.config.nativeHomeKitLights = false
      this.config.nativeHomeKitSensors = false
      /* falls through */
    case 'BSB002': // Philips Hue v2 (square) bridge;
      this.manufacturer = 'Philips'
      this.idString = util.format(
        '%s: %s %s %s v%s, api v%s', this.name, this.manufacturer,
        this.model, this.type, obj.swversion, obj.apiversion
      )
      this.log.info(this.idString)
      this.version = obj.apiversion
      if (!semver.satisfies(this.version, recommendedVersion)) {
        this.log.warn(
          '%s: warning: not using recommended Hue bridge api version %s',
          this.name, recommendedVersion
        )
      }
      if (this.platform.config.scenes) {
        this.log.warn('%s: Hue bridge scenes not yet supported', this.name)
      }
      break
    case 'deCONZ': // deCONZ rest api
      if (obj.bridgeid === '0000000000000000') {
        const d = deferred()
        this.log.info(
          '%s: RaspBee/ConBee not yet initialised - wait 1 minute', obj.name
        )
        setTimeout(() => {
          d.resolve(
            this.getConfig().then((obj) => {
              return this.exposeBridge(obj)
            })
          )
        }, 60000)
        return d.promise
      }
      this.manufacturer = 'dresden elektronik'
      this.type = 'gateway'
      this.version = obj.swversion
      this.config.nativeHomeKitLights = false
      this.config.nativeHomeKitSensors = false
      this.idString = util.format(
        '%s: %s %s %s v%s, api v%s', this.name, this.manufacturer,
        this.model, this.type, obj.swversion, obj.apiversion
      )
      this.log.info(this.idString)
      if (!semver.satisfies(this.version, recommendedVersion)) {
        this.log.warn(
          '%s: warning: not using recommended deCONZ gateway version %s',
          this.name, recommendedVersion
        )
      }
      break
    case 'HA-Bridge':
      this.manufacturer = 'HA-Bridge'
      this.idString = util.format(
        '%s: %s v%s, api v%s', this.name, this.model,
        obj.swversion, obj.apiversion
      )
      this.log.info(this.idString)
      this.version = obj.apiversion
      this.config.nativeHomeKitLights = false
      this.config.nativeHomeKitSensors = false
      break
    default:
      this.log.warn(
        '%s: warning: ignoring unknown bridge/gateway %j',
        this.name, obj
      )
      throw new Error('unknown bridge')
  }
  this.request = deferred.gate(
    this._request,
    this.platform.config.parallelRequests || this.config.parallelRequests
  )
  this.infoService = new Service.AccessoryInformation()
  this.serviceList.push(this.infoService)
  this.infoService
    .updateCharacteristic(Characteristic.Manufacturer, this.manufacturer)
    .updateCharacteristic(Characteristic.Model, this.model)
    .updateCharacteristic(Characteristic.SerialNumber, this.serialNumber)
    .updateCharacteristic(Characteristic.FirmwareRevision, this.version)
  this.obj = obj

  this.service = new my.Services.HueBridge(this.name)
  this.serviceList.push(this.service)
  this.service.getCharacteristic(my.Characteristics.Heartrate)
    .updateValue(this.state.heartrate)
    .on('set', this.setHeartrate.bind(this))
  this.service.getCharacteristic(my.Characteristics.LastUpdated)
    .updateValue(String(new Date()).substring(0, 24))
  this.service.getCharacteristic(my.Characteristics.TransitionTime)
    .updateValue(this.state.transitiontime)
    .on('set', this.setTransitionTime.bind(this))
  this.accessoryList.push(this)
  return deferred(true)
}

HueBridge.prototype.createUser = function () {
  if (this.username) {
    this.url += '/' + this.username
    return deferred(true)
  }
  const d = deferred()
  const devicetype = ('homebridge-hue#' + os.hostname().split('.')[0])
    .substr(0, 40)
  this.request('post', '/', { devicetype: devicetype })
    .then((obj) => {
      this.username = obj[0].success.username
      this.url += '/' + this.username
      let s = '\n'
      s += '  "platforms": [\n'
      s += '    {\n'
      s += '      "platform": "Hue",\n'
      s += '      "users": {\n'
      s += '        "' + this.serialNumber + '": "' + this.username + '"\n'
      s += '      }\n'
      s += '    }\n'
      s += '  ]'
      this.log.info(
        '%s: created user - please edit config.json and restart homebridge%s',
        this.name, s
      )
      d.resolve()
    })
    .catch((err) => {
      if (err.message) {
        this.log.error('%s: %s', err.message)
      }
      this.log.info(
        '%s: press link button on the bridge to create a user', this.name
      )
      setTimeout(() => {
        d.resolve(this.createUser())
      }, 15000)
    })
  return d.promise
}

HueBridge.prototype.getFullState = function () {
  const d = deferred()

  this.request('get', '/').then((obj) => {
    this.request('get', '/groups/0').then((group0) => {
      obj.groups[0] = group0
      if (obj.resourcelinks !== undefined) {
        d.resolve(obj)
      } else {
        this.request('get', '/resourcelinks').then((resourcelinks) => {
          obj.resourcelinks = resourcelinks
          d.resolve(obj)
        })
      }
    })
  })
  return d.promise
}

HueBridge.prototype.retryExposeResources = function () {
  const d = deferred()

  this.log.info(
    '%s: gateway not yet initialised - wait 1 minute', this.name
  )
  setTimeout(() => {
    d.resolve(
      this.getFullState().then((state) => {
        return this.exposeResources(state)
      })
    )
  }, 60000)
  return d.promise
}

HueBridge.prototype.exposeResources = function (obj) {
  const whitelist = {
    groups: {},
    lights: {},
    sensors: {},
    schedules: {},
    rules: {}
  }
  this.blacklist = {
    groups: {},
    lights: {},
    sensors: {},
    schedules: {},
    rules: {}
  }
  this.multiclip = {}
  this.multilight = {}
  this.outlet = {
    groups: {},
    lights: {}
  }
  this.valve = {}
  this.wallswitch = {}
  this.obj = obj.config
  for (const key in obj.resourcelinks) {
    const link = obj.resourcelinks[key]
    if (link.name === 'homebridge-hue' && link.links && link.description) {
      const list = link.description.toLowerCase()
      switch (list) {
        case 'blacklist':
        case 'lightlist':
        case 'multiclip':
        case 'multilight':
        case 'outlet':
        case 'valve':
        case 'wallswitch':
        case 'whitelist':
          break
        default:
          this.log.warn(
            '%s: /resourcelinks/%d: ignoring unknown description %s',
            this.name, key, link.description
          )
          continue
      }
      this.log.debug(
        '%s: /resourcelinks/%d: %d %s entries', this.name, key,
        link.links.length, list
      )
      let accessory
      for (const resource of link.links) {
        const type = resource.split('/')[1]
        const id = resource.split('/')[2]
        if (!whitelist[type]) {
          this.log.warn(
            '%s: /resourcelinks/%d: %s: ignoring unsupported resource',
            this.name, key, resource
          )
          continue
        }
        if (list === 'blacklist') {
          this.blacklist[type][id] = true
          continue
        }
        if (obj[type][id] === undefined) {
          this.log(
            '%s: /resourcelinks/%d: %s: not available', this.name, key,
            resource
          )
          return this.retryExposeResources()
        }
        if (list === 'multiclip') {
          if (
            type !== 'sensors' || obj[type][id].type.substring(0, 4) !== 'CLIP'
          ) {
            this.log.warn(
              '%s: /resourcelinks/%d: %s: ignoring unsupported multiclip resource',
              this.name, key, resource
            )
            continue
          }
          if (this.multiclip[id] != null) {
            this.log.warn(
              '%s: /resourcelinks/%d: %s: ignoring duplicate multiclip resource',
              this.name, key, resource
            )
            continue
          }
          this.multiclip[id] = key
          if (accessory == null) {
            // First resource
            const serialNumber = this.serialNumber + '-' + id
            accessory = new HueAccessory(this, serialNumber, true)
            this.accessoryMap[serialNumber] = accessory
          }
          accessory.addSensorResource(id, obj[type][id], false)
        } else if (list === 'multilight') {
          if (type !== 'lights') {
            this.log.warn(
              '%s: /resourcelinks/%d: %s: ignoring unsupported multilight resource',
              this.name, key, resource
            )
            continue
          }
          if (this.multilight[id] != null) {
            this.log.warn(
              '%s: /resourcelinks/%d: %s: ignoring duplicate multilight resource',
              this.name, key, resource
            )
            continue
          }
          this.multilight[id] = key
          if (accessory == null) {
            // First resource
            const a = obj[type][id].uniqueid
              .match(/(..:..:..:..:..:..:..:..)-..(-....)?/)
            const serialNumber = a[1].replace(/:/g, '').toUpperCase()
            accessory = new HueAccessory(this, serialNumber, true)
            this.accessoryMap[serialNumber] = accessory
          }
          accessory.addLightResource(id, obj[type][id])
        } else if (list === 'outlet') {
          if (type !== 'groups' && type !== 'lights') {
            this.log.warn(
              '%s: /resourcelinks/%d: %s: ignoring unsupported outlet resource',
              this.name, key, resource
            )
            continue
          }
          this.outlet[type][id] = true
        } else if (list === 'valve') {
          if (type !== 'lights') {
            this.log.warn(
              '%s: /resourcelinks/%d: %s: ignoring unsupported valve resource',
              this.name, key, resource
            )
            continue
          }
          this.valve[id] = true
        } else if (list === 'wallswitch') {
          if (type !== 'lights') {
            this.log.warn(
              '%s: /resourcelinks/%d: %s: ignoring unsupported wallswitch resource',
              this.name, key, resource
            )
            continue
          }
          this.wallswitch[id] = true
        } else if (list === 'whitelist') {
          whitelist[type][id] = true
        }
      }
    }
  }
  this.log.debug(
    '%s: %s: %s %s %s "%s"', this.name, this.serialNumber,
    this.manufacturer, this.model, this.type, this.name
  )
  for (const id in whitelist.groups) {
    this.exposeGroup(id, obj.groups[id])
  }
  this.exposeGroups(obj.groups)
  for (const id in whitelist.lights) {
    this.exposeLight(id, obj.lights[id])
  }
  this.exposeLights(obj.lights)
  for (const id in whitelist.sensors) {
    this.exposeSensor(id, obj.sensors[id])
  }
  this.exposeSensors(obj.sensors)
  for (const id in whitelist.schedules) {
    this.exposeSchedule(id, obj.schedules[id])
  }
  this.exposeSchedules(obj.schedules)
  for (const id in whitelist.rules) {
    this.exposeRule(id, obj.rules[id])
  }
  this.exposeRules(obj.rules)
  for (const id in this.accessoryMap) {
    const accessoryList = this.accessoryMap[id].expose()
    for (const accessory of accessoryList) {
      this.accessoryList.push(accessory)
    }
  }
  this.state.sensors = Object.keys(this.sensors).length
  this.log.debug('%s: %d sensors', this.name, this.state.sensors)
  this.state.lights = Object.keys(this.lights).length
  this.log.debug('%s: %d lights', this.name, this.state.lights)
  this.state.groups = Object.keys(this.groups).length
  this.state.group0 = this.groups[0] !== undefined ? 1 : 0
  this.state.schedules = Object.keys(this.schedules).length
  this.log.debug('%s: %d schedules', this.name, this.state.schedules)
  this.state.rules = Object.keys(this.rules).length
  this.log.debug('%s: %d rules', this.name, this.state.rules)
  this.log.debug(
    '%s: %d groups', this.name, this.state.groups
  )
  if (this.obj.websocketport) {
    this.listen()
  }
  return deferred(true)
}

HueBridge.prototype.exposeSensors = function (sensors) {
  if (this.platform.config.sensors) {
    for (const id in sensors) {
      const sensor = sensors[id]
      if (this.sensors[id]) {
        this.log.debug('%s: /sensors/%d: whitelisted', this.name, id)
      } else if (this.blacklist.sensors[id]) {
        this.log.debug('%s: /sensors/%d: blacklisted', this.name, id)
      } else if (this.multiclip[id] != null) {
        // already exposed
      } else if (
        this.config.nativeHomeKitSensors && sensor.type[0] === 'Z' && (
          sensor.manufacturername === 'Philips' ||
          sensor.manufacturername === 'PhilipsFoH'
        )
      ) {
        this.log.debug('%s: /sensors/%d: exposed by bridge', this.name, id)
      } else if (
        this.platform.config.excludeSensorTypes[sensor.type] || (
          sensor.type.substring(0, 4) === 'CLIP' &&
          this.platform.config.excludeSensorTypes.CLIP
        )
      ) {
        this.log.debug(
          '%s: /sensors/%d: %s excluded', this.name, id, sensor.type
        )
      } else if (
        sensor.name === '_dummy' || sensor.uniqueid === '_dummy'
      ) {
        this.log.debug(
          '%s: /sensors/%d: ignoring dummy sensor', this.name, id
        )
      } else {
        this.exposeSensor(id, sensor)
      }
    }
  }
}

HueBridge.prototype.exposeSensor = function (id, obj) {
  let serialNumber = this.serialNumber + '-' + id
  if (obj.type[0] === 'Z') {
    const uniqueid = obj.uniqueid == null ? '' : obj.uniqueid
    const a = uniqueid.match(/(..:..:..:..:..:..:..:..)-..(-....)?/)
    if (a != null) {
      // ZigBee sensor
      serialNumber = a[1].replace(/:/g, '').toUpperCase()
      if (
        this.platform.config.hueMotionTemperatureHistory &&
        obj.manufacturername === 'Philips' && obj.modelid === 'SML001' &&
        (obj.type === 'ZHATemperature' || obj.type === 'ZLLTemperature')
      ) {
        // Separate accessory for Hue motion sensor's temperature.
        serialNumber += '-T'
      }
    }
  }
  if (
    obj.manufacturername === 'Philips' && obj.modelid === 'PHDL00' &&
    obj.type === 'Daylight' && obj.name === 'Daylight'
  ) {
    // Built-in Daylight sensor
    this.log.debug(
      '%s: /sensors/%d: %s "%s"', this.name, id, obj.type, obj.name
    )
    try {
      this.bridge = this
      const sensor = new HueSensor(this, id, obj)
      if (sensor.service) {
        this.sensors[id] = sensor
        for (const service of sensor.serviceList) {
          this.serviceList.push(service)
        }
      }
    } catch (e) {
      this.log.error('%s: error: /sensors/%d: %j\n', this.name, id, obj, e)
    }
    return
  }
  if (
    obj.manufacturername === 'homebridge-hue' &&
    obj.modelid === obj.type &&
    obj.uniqueid.split('-')[1] === id
  ) {
    // Combine multiple CLIP sensors into one accessory.
    this.log.error(
      '%s: /sensors/%d: error: old multiCLIP setup has been deprecated',
      this.name, id
    )
  }
  let accessory = this.accessoryMap[serialNumber]
  if (accessory == null) {
    accessory = new HueAccessory(this, serialNumber)
    this.accessoryMap[serialNumber] = accessory
  }
  accessory.addSensorResource(id, obj)
}

HueBridge.prototype.exposeLights = function (lights) {
  if (this.platform.config.lights) {
    for (const id in lights) {
      const light = lights[id]
      if (this.lights[id]) {
        this.log.debug('%s: /lights/%d: whitelisted', this.name, id)
      } else if (this.blacklist.lights[id]) {
        this.log.debug('%s: /lights/%d: blacklisted', this.name, id)
      } else if (this.multilight[id]) {
        // Already exposed.
      } else if (
        this.config.nativeHomeKitLights && (
          (light.capabilities != null && light.capabilities.certified) ||
          (light.capabilities == null && light.manufacturername === 'Philips')
        )
      ) {
        this.log.debug('%s: /lights/%d: exposed by bridge %j', this.name, id, light)
      } else {
        this.exposeLight(id, light)
      }
    }
  }
}

HueBridge.prototype.exposeLight = function (id, obj) {
  let serialNumber = this.serialNumber + '-L' + id
  const uniqueid = obj.uniqueid == null ? '' : obj.uniqueid
  const a = uniqueid.match(/(..:..:..:..:..:..:..:..)-..(-....)?/)
  if (a != null && this.model !== 'HA-Bridge') {
    serialNumber = a[1].replace(/:/g, '').toUpperCase()
  }
  let accessory = this.accessoryMap[serialNumber]
  if (accessory == null) {
    accessory = new HueAccessory(this, serialNumber)
    this.accessoryMap[serialNumber] = accessory
  }
  accessory.addLightResource(id, obj)
}

HueBridge.prototype.exposeGroups = function (groups) {
  if (this.platform.config.groups) {
    for (const id in groups) {
      const group = groups[id]
      if (this.groups[id]) {
        this.log.debug('%s: /groups/%d: whitelisted', this.name, id)
      } else if (this.blacklist.groups[id]) {
        this.log.debug('%s: /groups/%d: blacklisted', this.name, id)
      } else if (group.type === 'Room' && !this.platform.config.rooms) {
        this.log.debug(
          '%s: /groups/%d: %s excluded', this.name, id, group.type
        )
      } else if (id === '0' && !this.platform.config.group0) {
        this.log.debug('%s: /groups/%d: group 0 excluded', this.name, id)
      } else {
        this.exposeGroup(id, group)
      }
    }
  }
}

HueBridge.prototype.exposeGroup = function (id, obj) {
  const serialNumber = this.serialNumber + '-G' + id
  let accessory = this.accessoryMap[serialNumber]
  if (accessory == null) {
    accessory = new HueAccessory(this, serialNumber)
    this.accessoryMap[serialNumber] = accessory
  }
  accessory.addGroupResource(id, obj)
}

HueBridge.prototype.exposeSchedules = function (schedules) {
  if (this.platform.config.schedules) {
    for (const id in schedules) {
      if (this.schedules[id]) {
        this.log.debug('%s: /schedules/%d: whitelisted', this.name, id)
      } else if (this.blacklist.schedules[id]) {
        this.log.debug('%s: /schedules/%d: blacklisted', this.name, id)
      } else {
        this.exposeSchedule(id, schedules[id])
      }
    }
  }
}

HueBridge.prototype.exposeSchedule = function (id, obj) {
  this.log.debug(
    '%s: /schedules/%d: "%s"', this.name, id, obj.name
  )
  try {
    this.schedules[id] = new HueSchedule(this, id, obj)
    // this.accessoryList.push(this.schedules[id]);
    if (this.serviceList.length < 99) {
      this.serviceList.push(this.schedules[id].service)
    }
  } catch (e) {
    this.log.error(
      '%s: error: /schedules/%d: %j\n', this.name, id, obj, e
    )
  }
}

HueBridge.prototype.exposeRules = function (rules) {
  if (this.platform.config.rules) {
    for (const id in rules) {
      if (this.rules[id]) {
        this.log.debug('%s: /rules/%d: whitelisted', this.name, id)
      } else if (this.blacklist.rules[id]) {
        this.log.debug('%s: /rules/%d: blacklisted', this.name, id)
      } else {
        this.exposeRule(id, rules[id])
      }
    }
  }
}

HueBridge.prototype.exposeRule = function (id, obj) {
  this.log.debug('%s: /rules/%d: "%s"', this.name, id, obj.name)
  try {
    this.rules[id] = new HueSchedule(this, id, obj, 'rule')
    // this.accessoryList.push(this.rules[id]);
    if (this.serviceList.length < 99) {
      this.serviceList.push(this.rules[id].service)
    }
  } catch (e) {
    this.log.error(
      '%s: error: /rules/%d: %j\n', this.name, id, obj, e
    )
  }
}

HueBridge.prototype.resetTransitionTime = function () {
  if (this.state.resetTimer) {
    return
  }
  this.state.resetTimer = setTimeout(() => {
    this.log.info(
      '%s: reset homekit transition time from %ss to %ss', this.name,
      this.state.transitiontime, this.defaultTransitiontime
    )
    this.state.transitiontime = this.defaultTransitiontime
    this.service.getCharacteristic(my.Characteristics.TransitionTime)
      .updateValue(this.state.transitiontime)
    delete this.state.resetTimer
  }, this.platform.config.waitTimeUpdate)
  return deferred(true)
}

// ===== WebSocket =============================================================

HueBridge.prototype.listen = function () {
  const wsURL = 'ws://' + this.host + ':' + this.obj.websocketport + '/'
  this.ws = new WebSocket(wsURL)

  this.ws.on('open', () => {
    this.log.debug(
      '%s: listening on websocket ws://%s:%d/', this.name,
      this.platform.maskHost(this.host), this.obj.websocketport
    )
  })

  this.ws.on('message', (data, flags) => {
    try {
      const obj = JSON.parse(data)
      if (obj.e === 'changed' && obj.t === 'event') {
        let a
        switch (obj.r) {
          case 'lights':
            a = this.lights[obj.id]
            break
          case 'groups':
            a = this.groups[obj.id]
            break
          case 'sensors':
            a = this.sensors[obj.id]
            break
          default:
            break
        }
        if (a) {
          if (obj.state !== undefined) {
            this.log.debug('%s: state changed event: %j', a.name, obj.state)
            a.checkState(obj.state, true)
          }
          if (obj.config !== undefined) {
            this.log.debug('%s: config changed event: %j', a.name, obj.config)
            a.checkConfig(obj.config, true)
          }
        }
      }
    } catch (e) {
      this.log.error('%s: websocket error %s', this.name, e)
    }
  })

  this.ws.on('error', (error) => {
    this.log.error(
      '%s: websocket communication error %s on %s', this.name,
      error.code, wsURL
    )
  })

  this.ws.on('close', () => {
    this.log.debug(
      '%s: websocket connection closed - retrying in 30 seconds', this.name
    )
    setTimeout(this.listen.bind(this), 30000)
  })
}

// ===== Heartbeat =============================================================

HueBridge.prototype.heartbeat = function (beat) {
  if (beat % this.state.heartrate === 0 && this.request) {
    this.service.getCharacteristic(my.Characteristics.LastUpdated)
      .updateValue(String(new Date()).substring(0, 24))
    this.heartbeatSensors(beat)
      .then(() => {
        return this.heartbeatLights(beat)
      }).then(() => {
        return this.heartbeatGroup0(beat)
      }).then(() => {
        return this.heartbeatGroups(beat)
      }).then(() => {
        return this.heartbeatSchedules(beat)
      }).then(() => {
        return this.heartbeatRules(beat)
      }).catch((err) => {
        if (err instanceof Error && err.message !== '') {
          this.log.error('%s: heartbeat error:', this.name, err)
        }
      })
  }
  if (beat % 600 === 0 && this.request) {
    try {
      for (const id in this.sensors) {
        this.sensors[id].addEntry()
      }
    } catch (err) {
      if (err instanceof Error && err.message !== '') {
        this.log.error('%s: heartbeat error:', this.name, err)
      }
    }
  }
}

HueBridge.prototype.heartbeatSensors = function (beat) {
  if (this.state.sensors === 0) {
    return deferred(true)
  }
  return this.request('get', '/sensors').then((sensors) => {
    for (const id in sensors) {
      const a = this.sensors[id]
      if (a) {
        a.heartbeat(beat, sensors[id])
      }
    }
  })
}

HueBridge.prototype.heartbeatLights = function (beat) {
  if (this.state.lights === 0) {
    return deferred(true)
  }
  return this.request('get', '/lights').then((lights) => {
    for (const id in lights) {
      const a = this.lights[id]
      if (a) {
        a.heartbeat(beat, lights[id])
      }
    }
  })
}

HueBridge.prototype.heartbeatGroups = function (beat) {
  if (this.state.groups - this.state.group0 === 0) {
    return deferred(true)
  }
  return this.request('get', '/groups').then((groups) => {
    for (const id in groups) {
      const a = this.groups[id]
      if (a) {
        a.heartbeat(beat, groups[id])
      }
    }
  })
}

HueBridge.prototype.heartbeatGroup0 = function (beat) {
  if (this.state.group0 === 0) {
    return deferred(true)
  }
  return this.request('get', '/groups/0').then((group0) => {
    const a = this.groups[0]
    if (a) {
      a.heartbeat(beat, group0)
    }
  })
}

HueBridge.prototype.heartbeatSchedules = function (beat) {
  if (this.state.schedules === 0) {
    return deferred(true)
  }
  return this.request('get', '/schedules').then((schedules) => {
    for (const id in schedules) {
      const a = this.schedules[id]
      if (a) {
        a.heartbeat(beat, schedules[id])
      }
    }
  })
}

HueBridge.prototype.heartbeatRules = function (beat) {
  if (this.state.rules === 0) {
    return deferred(true)
  }
  return this.request('get', '/rules').then((rules) => {
    for (const id in rules) {
      const a = this.rules[id]
      if (a) {
        a.heartbeat(beat, rules[id])
      }
    }
  })
}

// ===== Homekit Events ========================================================

HueBridge.prototype.setHeartrate = function (rate, callback) {
  if (rate === this.state.heartrate) {
    return callback()
  }
  this.log.info(
    '%s: homekit heartrate changed from %ss to %ss', this.name,
    this.state.heartrate, rate
  )
  this.state.heartrate = rate
  return callback()
}

HueBridge.prototype.setTransitionTime = function (transitiontime, callback) {
  transitiontime = Math.round(transitiontime * 10) / 10
  if (transitiontime === this.state.transitiontime) {
    return callback()
  }
  this.log.info(
    '%s: homekit transition time changed from %ss to %ss', this.name,
    this.state.transitiontime, transitiontime
  )
  this.state.transitiontime = transitiontime
  return callback()
}

HueBridge.prototype.identify = function (callback) {
  this.log.info('%s: identify', this.name)
  this.platform.identify()
  this.log.info(this.idString)
  callback()
}

// ===== Bridge Communication ==================================================

// Send request to bridge / gateway.
HueBridge.prototype._request = function (method, resource, body) {
  const d = deferred()
  const requestObj = {
    method: method,
    url: this.url + (resource === '/' ? '' : resource),
    headers: { Connection: 'keep-alive' },
    timeout: 1000 * this.platform.config.timeout,
    json: true
  }
  const requestNumber = ++this.state.request
  let requestMsg
  requestMsg = util.format(
    '%s: %s request %d: %s %s', this.name, this.type,
    this.state.request, method, resource
  )
  if (body) {
    requestObj.body = body
    requestMsg = util.format('%s %j', requestMsg, body)
  }
  this.log.debug(requestMsg)
  request(requestObj, (err, response, responseBody) => {
    if (err) {
      if (err.code === 'ECONNRESET') {
        this.log.debug(requestMsg)
        this.log.debug(
          '%s: %s communication error %s - retrying in 300ms',
          this.name, this.type, err.code
        )
        setTimeout(() => {
          d.resolve(this._request(method, resource, body))
        }, this.platform.config.waitTimeResend)
        return
      }
      this.log.error(requestMsg)
      this.log.error(
        '%s: %s communication error %s on %s', this.name, this.type,
        err.code, this.platform.maskHost(this.host)
      )
      return d.reject(new Error())
    }
    if (response.statusCode !== 200) {
      this.log.error(requestMsg)
      this.log.error(
        '%s: %s http status %s %s', this.name, this.type,
        response.statusCode, response.statusMessage
      )
      return d.reject(new Error())
    }
    if (Array.isArray(responseBody)) {
      for (const id in responseBody) {
        const e = responseBody[id].error
        if (e) {
          this.log.error(requestMsg)
          this.log.error(
            '%s: %s error %d: %s', this.name, this.type, e.type, e.description
          )
          return d.reject(new Error())
        }
      }
    }
    this.log.debug(
      '%s: %s request %d: ok', this.name, this.type, requestNumber
    )
    return d.resolve(responseBody)
  })
  return d.promise
}
