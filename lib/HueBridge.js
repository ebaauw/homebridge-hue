// homebridge-hue/lib/HueBridge.js
// Copyright © 2016-2020 Erik Baauw. All rights reserved.
//
// Homebridge plugin for Philips Hue and/or deCONZ.
//
// HueBridge provides support for Philips Hue bridges and dresden elektronik
// deCONZ gateways.
//
// Todo:
// - Support rules in separate accessories.

'use strict'

const homebridgeLib = require('homebridge-lib')
const os = require('os')
const semver = require('semver')
const util = require('util')
const WebSocket = require('ws')

const HueAccessoryModule = require('./HueAccessory')
const HueScheduleModule = require('./HueSchedule')
const HueAccessory = HueAccessoryModule.HueAccessory
const HueClient = require('./HueClient')
const HueSchedule = HueScheduleModule.HueSchedule

module.exports = {
  setHomebridge: setHomebridge,
  HueBridge: HueBridge
}

const formatError = homebridgeLib.CommandLineTool.formatError

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

const repeaterTypes = [
  'Range extender', // Trådfri repeater, XBee
  'Configuration tool' // RaspBee, ConBee, ConBee II
]

function HueBridge (platform, host) {
  this.log = platform.log
  this.platform = platform
  this.host = host
  this.hostname = host.split(':')[0]
  this.name = this.platform.maskHost(this.hostname)
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

HueBridge.prototype.accessories = async function () {
  this.accessoryMap = {}
  this.accessoryList = []
  try {
    const obj = await this.getConfig()
    if (this.platform.bridgeMap[obj.bridgeid] != null) {
      this.log.warn(
        '%s: already exposed as %s', this.name,
        this.platform.maskHost(this.platform.bridgeMap[obj.bridgeid].host)
      )
      this.heartbeat = () => {}
      return this.accessoryList
    }
    this.platform.bridgeMap[obj.bridgeid] = this
    await this.exposeBridge(obj)
    await this.createUser()
    const state = await this.getFullState()
    await this.exposeResources(state)
  } catch (error) {
    if (error.message !== 'unknown bridge') {
      this.log.error('%s: %s', this.name, formatError(error))
    }
  }
  this.log.info('%s: %d accessories', this.name, this.accessoryList.length)
  return this.accessoryList
}

HueBridge.prototype.getConfig = async function () {
  if (this.hueClient == null) {
    this.hueClient = new HueClient({
      host: this.host,
      timeout: this.platform.config.timeout
    })
  }
  try {
    const obj = await this.hueClient.config()
    delete this.hueClient
    return obj
  } catch (error) {
    this.log.error('%s: %s - retrying in 15s', this.name, formatError(error))
    await homebridgeLib.timeout(15000)
    return this.getConfig()
  }
}

HueBridge.prototype.getInfoService = function () {
  return this.infoService
}

HueBridge.prototype.exposeBridge = async function (obj) {
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
  if (this.model == null) {
    this.model = 'Tasmota'
  }
  this.philips = 'Philips'
  const recommendedVersion = this.platform.packageJson.engines[obj.modelid]
  switch (this.model) {
    case 'BSB001': // Philips Hue v1 (round) bridge;
      this.config.parallelRequests = 3
      this.config.nativeHomeKitLights = false
      this.config.nativeHomeKitSensors = false
      /* falls through */
    case 'BSB002': // Philips Hue v2 (square) bridge;
      this.isHue = true
      this.manufacturer = this.philips
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
      if (semver.gte(this.version, '1.36.0')) {
        this.philips = 'Signify Netherlands B.V.'
      }
      this.config.link = semver.lt(this.version, '1.31.0')
      this.config.linkbutton = this.platform.config.linkbutton == null
        ? this.config.link
        : this.platform.config.linkbutton
      break
    case 'deCONZ': // deCONZ rest api
      if (obj.bridgeid === '0000000000000000') {
        this.log.info(
          '%s: RaspBee/ConBee not yet initialised - wait 1 minute', obj.name
        )
        await homebridgeLib.timeout(60000)
        obj = await this.getConfig()
        return this.exposeBridge(obj)
      }
      this.isDeconz = true
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
    case 'Tasmota':
      this.manufacturer = 'Sonoff'
      this.idString = util.format(
        '%s: %s %s v%s, api v%s', this.name, this.manufacturer,
        this.model, obj.swversion, obj.apiversion
      )
      this.version = obj.apiversion
      this.config.nativeHomeKitLights = false
      this.config.nativeHomeKitSensors = false
      this.username = 'homebridgehue'
      break
    default:
      this.log.warn(
        '%s: warning: ignoring unknown bridge/gateway %j',
        this.name, obj
      )
      throw new Error('unknown bridge')
  }
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
  if (this.isHue || this.isDeconz) {
    this.service.getCharacteristic(my.Characteristics.Restart)
      .updateValue(false)
      .on('set', this.setRestart.bind(this))
  }
  if (this.config.linkbutton) {
    this.state.linkbutton = false
    if (this.config.link) {
      this.state.hkLink = 0
      this.service.getCharacteristic(my.Characteristics.Link)
        .updateValue(this.state.hkLink)
        .on('set', this.setLink.bind(this))
    }
    this.switchService = new Service.StatelessProgrammableSwitch(this.name)
    this.serviceList.push(this.switchService)
    this.switchService
      .getCharacteristic(Characteristic.ProgrammableSwitchEvent)
      .setProps({
        minValue: Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS,
        maxValue: Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS
      })
  }
  this.accessoryList.push(this)
}

HueBridge.prototype.createUser = async function () {
  if (this.username) {
    return
  }
  try {
    const devicetype = ('homebridge-hue#' + os.hostname().split('.')[0])
      .slice(0, 40)
    const obj = await this.request('post', '/', { devicetype: devicetype })
    this.username = obj[0].success.username
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
    delete this.hueClient
    return
  } catch (error) {
    const s = this.isDeconz
      ? 'unlock gateway'
      : 'press link button on the bridge'
    this.log.info('%s: %s to create a user - retrying in 15s', this.name, s)
    await homebridgeLib.timeout(15000)
    return this.createUser()
  }
}

HueBridge.prototype.getFullState = async function () {
  const state = await this.request('get', '/')
  const group0 = await this.request('get', '/groups/0')
  state.groups[0] = group0
  if (state.resourcelinks == null) {
    const resourcelinks = await this.request('get', '/resourcelinks')
    state.resourcelinks = resourcelinks
  }
  this.fullState = state
  return state
}

HueBridge.prototype.exposeResources = async function (obj) {
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
  this.splitlight = {}
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
        case 'splitlight':
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
          this.log.info(
            '%s: gateway not yet initialised - wait 1 minute', this.name
          )
          await homebridgeLib.timeout(60000)
          const state = await this.getFullState()
          return this.exposeResources(state)
        }
        if (list === 'multiclip') {
          if (
            type !== 'sensors' || (
              obj[type][id].type.substring(0, 4) !== 'CLIP' &&
              obj[type][id].type !== 'Daylight'
            )
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
              .match(/(..:..:..:..:..:..:..:..)-..(:?-....)?/)
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
        } else if (list === 'splitlight') {
          if (type !== 'lights') {
            this.log.warn(
              '%s: /resourcelinks/%d: %s: ignoring unsupported splitlight resource',
              this.name, key, resource
            )
            continue
          }
          this.splitlight[id] = true
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
  if (this.isHue && this.platform.config.scenes) {
    for (const id in obj.groups) {
      obj.groups[id].scenes = []
    }
    for (const key in obj.scenes) {
      const scene = obj.scenes[key]
      const id = scene.group == null ? 0 : scene.group
      this.log.debug('%s: /scenes/%s: group: %d', this.name, key, id)
      obj.groups[id].scenes.push({ id: key, name: scene.name })
    }
  }
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
  this.log.debug('%s: %d groups', this.name, this.state.groups)
  if (this.obj.websocketport) {
    this.listen()
  }
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
          sensor.manufacturername === this.philips ||
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
  obj.manufacturername = obj.manufacturername.replace(/\//g, '')
  let serialNumber = this.serialNumber + '-' + id
  if (obj.type[0] === 'Z') {
    const uniqueid = obj.uniqueid == null ? '' : obj.uniqueid
    const a = uniqueid.match(/(..:..:..:..:..:..:..:..)-..(:?-....)?/)
    if (a != null) {
      // ZigBee sensor
      serialNumber = a[1].replace(/:/g, '').toUpperCase()
      if (this.platform.config.hueMotionTemperatureHistory) {
        // Separate accessory for Hue motion sensor's temperature.
        if (
          obj.manufacturername === this.philips &&
          (obj.modelid === 'SML001' || obj.modelid === 'SML002')
        ) {
          // Hue motion sensor.
          if (obj.type === 'ZHATemperature' || obj.type === 'ZLLTemperature') {
            serialNumber += '-T'
          }
        } else if (
          obj.manufacturername === 'Samjin' && obj.modelid === 'multi'
        ) {
          // Samsung SmartThings multupurpose sensor.
          if (obj.type === 'ZHATemperature') {
            serialNumber += '-T'
          } else if (obj.type === 'ZHAVibration') {
            serialNumber += '-V'
          }
        }
      }
      if (
        obj.manufacturername === 'Develco Products AS' &&
        (obj.modelid === 'SMSZB-120' || obj.modelid === 'HESZB-120')
      ) {
        // Develco smoke sensor.
        if (obj.type === 'ZHATemperature') {
          serialNumber += '-T'
        }
      }
    }
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
          (light.capabilities == null && light.manufacturername === this.philips)
        )
      ) {
        this.log.debug('%s: /lights/%d: exposed by bridge %j', this.name, id, light)
      } else if (
        repeaterTypes.includes(light.type) ||
        (light.type === 'Unknown' && light.manufacturername === 'dresden elektronik')
      ) {
        this.log.debug('%s: /lights/%d: ignore repeater %j', this.name, id, light)
      } else {
        this.exposeLight(id, light)
      }
    }
  }
}

HueBridge.prototype.exposeLight = function (id, obj) {
  if (obj.manufacturername != null) {
    obj.manufacturername = obj.manufacturername.replace(/\//g, '')
  }
  let serialNumber = this.serialNumber + '-L' + id
  const uniqueid = obj.uniqueid == null ? '' : obj.uniqueid
  const a = uniqueid.match(/(..:..:..:..:..:..:..:..)-(..)(:?-....)?/)
  if (a != null && this.model !== 'HA-Bridge') {
    serialNumber = a[1].replace(/:/g, '').toUpperCase()
    if (this.splitlight[id]) {
      serialNumber += '-' + a[2].toUpperCase()
    }
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
      '%s: error: /schedules/%d: %j\n%s', this.name, id, obj, formatError(e)
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
      '%s: error: /rules/%d: %j\n%s', this.name, id, obj, formatError(e)
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
}

// ===== WebSocket =============================================================

HueBridge.prototype.listen = function () {
  const wsURL = 'ws://' + this.hostname + ':' + this.obj.websocketport + '/'
  this.ws = new WebSocket(wsURL)

  this.ws.on('open', () => {
    this.log.debug(
      '%s: listening on websocket ws://%s:%d/', this.name,
      this.platform.maskHost(this.hostname), this.obj.websocketport
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
          if (obj.attr !== undefined) {
            this.log.debug('%s: attr changed event: %j', a.name, obj.attr)
            a.checkAttr(obj.attr, true)
          }
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
      this.log.error('%s: websocket error %s', this.name, formatError(e))
    }
  })

  this.ws.on('error', (error) => {
    this.log.error(
      '%s: websocket communication error %s', this.name, formatError(error)
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

HueBridge.prototype.heartbeat = async function (beat) {
  if (beat % this.state.heartrate === 0 && this.request) {
    this.service.getCharacteristic(my.Characteristics.LastUpdated)
      .updateValue(String(new Date()).substring(0, 24))
    try {
      await this.heartbeatConfig(beat)
      await this.heartbeatSensors(beat)
      await this.heartbeatLights(beat)
      await this.heartbeatGroup0(beat)
      await this.heartbeatGroups(beat)
      await this.heartbeatSchedules(beat)
      await this.heartbeatRules(beat)
    } catch (error) {
      this.log.error('%s: heartbeat error: %s', this.name, formatError(error))
    }
  }
  if (beat % 600 === 0 && this.request) {
    try {
      for (const id in this.sensors) {
        this.sensors[id].addEntry()
      }
    } catch (error) {
      this.log.error('%s: heartbeat error:', this.name, formatError(error))
    }
  }
}

HueBridge.prototype.heartbeatSensors = async function (beat) {
  if (this.state.sensors === 0) {
    return
  }
  const sensors = await this.request('get', '/sensors')
  for (const id in sensors) {
    const a = this.sensors[id]
    if (a) {
      a.heartbeat(beat, sensors[id])
    }
  }
}

HueBridge.prototype.heartbeatConfig = async function (beat) {
  if (!this.config.linkbutton) {
    return
  }
  const config = await this.request('get', '/config')
  if (config.linkbutton !== this.state.linkbutton) {
    this.log.debug(
      '%s: %s linkbutton changed from %s to %s', this.name, this.type,
      this.state.linkbutton, config.linkbutton
    )
    this.state.linkbutton = config.linkbutton
    if (this.state.linkbutton) {
      this.log(
        '%s: homekit linkbutton single press', this.switchService.displayName
      )
      this.switchService.updateCharacteristic(
        Characteristic.ProgrammableSwitchEvent,
        Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS
      )
      if (this.config.link) {
        await this.request('put', '/config', { linkbutton: false })
        this.state.linkbutton = false
      }
    } else if (this.config.link) {
      const hkLink = 0
      if (hkLink !== this.state.hkLink) {
        this.log(
          '%s: set homekit link from %s to %s', this.name,
          this.state.hkLink, hkLink
        )
        this.state.hkLink = hkLink
        this.service
          .updateCharacteristic(my.Characteristics.Link, this.state.hkLink)
      }
    }
  }
}

HueBridge.prototype.heartbeatLights = async function (beat) {
  if (this.state.lights === 0) {
    return
  }
  const lights = await this.request('get', '/lights')
  for (const id in lights) {
    const a = this.lights[id]
    if (a) {
      a.heartbeat(beat, lights[id])
    }
  }
}

HueBridge.prototype.heartbeatGroups = async function (beat) {
  if (this.state.groups - this.state.group0 === 0) {
    return
  }
  const groups = await this.request('get', '/groups')
  for (const id in groups) {
    const a = this.groups[id]
    if (a) {
      a.heartbeat(beat, groups[id])
    }
  }
}

HueBridge.prototype.heartbeatGroup0 = async function (beat) {
  if (this.state.group0 === 0) {
    return
  }
  const group0 = await this.request('get', '/groups/0')
  const a = this.groups[0]
  if (a) {
    a.heartbeat(beat, group0)
  }
}

HueBridge.prototype.heartbeatSchedules = async function (beat) {
  if (this.state.schedules === 0) {
    return
  }
  const schedules = await this.request('get', '/schedules')
  for (const id in schedules) {
    const a = this.schedules[id]
    if (a) {
      a.heartbeat(beat, schedules[id])
    }
  }
}

HueBridge.prototype.heartbeatRules = async function (beat) {
  if (this.state.rules === 0) {
    return
  }
  const rules = await this.request('get', '/rules')
  for (const id in rules) {
    const a = this.rules[id]
    if (a) {
      a.heartbeat(beat, rules[id])
    }
  }
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

HueBridge.prototype.setLink = function (link, callback) {
  link = link ? 1 : 0
  if (link === this.state.hkLink) {
    return callback()
  }
  this.log.info(
    '%s: homekit link changed from %s to %s', this.name,
    this.state.hkLink, link
  )
  this.state.hkLink = link
  const newValue = !!link
  this.request('put', '/config', { linkbutton: newValue }).then(() => {
    this.state.linkbutton = newValue
    return callback()
  }).catch((error) => {
    return callback(error)
  })
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

HueBridge.prototype.setRestart = function (restart, callback) {
  if (!restart) {
    return callback()
  }
  this.log.info('%s: restart', this.name)
  let method = 'put'
  let path = '/config'
  let body = { reboot: true }
  if (this.isDeconz) {
    method = 'post'
    path = '/config/restartapp'
    body = undefined
  }
  this.request(method, path, body).then((obj) => {
    setTimeout(() => {
      this.service.setCharacteristic(my.Characteristics.Restart, false)
    }, this.platform.config.resetTimeout)
    return callback()
  }).catch((error) => {
    return callback(error)
  })
}

HueBridge.prototype.identify = function (callback) {
  this.log.info('%s: identify', this.name)
  this.platform.identify()
  this.log.info(this.idString)
  callback()
}

// ===== Bridge Communication ==================================================

// Send request to bridge / gateway.
HueBridge.prototype.request = async function (method, resource, body) {
  if (this.hueClient == null) {
    const options = {
      bridgeid: this.serialNumber,
      forceHttp: this.platform.config.forceHttp,
      host: this.host,
      keepAlive: true,
      maxSockets: this.platform.config.parallelRequests || this.config.parallelRequests,
      timeout: this.platform.config.timeout
    }
    if (this.username !== '') {
      options.username = this.username
    }
    this.hueClient = new HueClient(options)
    await this.hueClient.connect()
  }
  const requestNumber = ++this.state.request
  let requestMsg
  requestMsg = util.format(
    '%s: %s request %d: %s %s', this.name, this.type,
    requestNumber, method, resource
  )
  if (body != null) {
    requestMsg = util.format('%s %j', requestMsg, body)
  }
  this.log.debug(requestMsg)
  try {
    let warning
    const response = await this.hueClient._request(method, resource, body)
    if (Array.isArray(response)) {
      for (const id in response) {
        const e = response[id].error
        if (e != null) {
          if (!warning) {
            warning = true
            this.log.warn(requestMsg)
          }
          this.log.warn(
            '%s: %s request %d: error %d %s', this.name, this.type,
            requestNumber, e.type, e.description
          )
        }
      }
    }
    if (!warning) {
      this.log.debug(
        '%s: %s request %d: ok', this.name, this.type, requestNumber
      )
    }
    return response
  } catch (error) {
    if (error.code === 'ECONNRESET' || error.statusCode === 503) {
      this.log.debug(requestMsg)
      this.log.debug(
        '%s: %s communication error: %s - retrying in %dms',
        this.name, this.type, formatError(error), this.platform.config.waitTimeResend
      )
      await homebridgeLib.timeout(this.platform.config.waitTimeResend)
      return this.request(method, resource, body)
    }
    this.log.warn(requestMsg)
    this.log.warn(
      '%s: %s communication error: %s', this.name, this.type, formatError(error)
    )
    throw new Error()
  }
}
