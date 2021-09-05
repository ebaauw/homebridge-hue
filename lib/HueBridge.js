// homebridge-hue/lib/HueBridge.js
// Copyright © 2016-2021 Erik Baauw. All rights reserved.
//
// Homebridge plugin for Philips Hue and/or deCONZ.

'use strict'

const homebridgeLib = require('homebridge-lib')
const semver = require('semver')
const util = require('util')

const HueAccessoryModule = require('./HueAccessory')
const HueScheduleModule = require('./HueSchedule')
const HueAccessory = HueAccessoryModule.HueAccessory
const HueClient = require('./HueClient')
const HueSchedule = HueScheduleModule.HueSchedule
const WsMonitor = require('./WsMonitor')

module.exports = {
  setHomebridge: setHomebridge,
  HueBridge: HueBridge
}

const formatError = homebridgeLib.formatError

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

function HueBridge (platform, host, bridge) {
  this.log = platform.log
  this.platform = platform
  this.host = host
  this.bridge = bridge
  this.hostname = host.split(':')[0]
  this.name = this.hostname
  this.type = 'bridge'
  this.defaultTransitiontime = 0.4
  this.state = {
    heartrate: this.platform.config.heartrate,
    transitiontime: this.defaultTransitiontime,
    bri: 1,
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

  this.whitelist = {
    lights: {},
    groups: {},
    scenes: {},
    sensors: {},
    schedules: {},
    rules: {}
  }
  this.blacklist = {
    lights: {},
    groups: {},
    scenes: {},
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
  this.switch = {
    groups: {},
    lights: {}
  }
  this.valve = {}
  this.wallswitch = {}
}

HueBridge.prototype.getServices = function () {
  this.log.info('%s: %d services', this.name, this.serviceList.length)
  return this.serviceList
}

HueBridge.prototype.accessories = async function () {
  this.accessoryMap = {}
  this.accessoryList = []
  try {
    await this.exposeBridge()
    await this.createUser()
    const state = await this.getFullState()
    await this.exposeResources(state)
    this.platform.bridgeMap[this.bridge.bridgeid] = this
  } catch (error) {
    if (error.message !== 'unknown bridge') {
      this.log.warn('%s: %s - retrying in 15s', this.name, formatError(error))
      await homebridgeLib.timeout(15000)
      return this.accessories()
    }
  }
  this.log.info('%s: %d accessories', this.name, this.accessoryList.length)
  return this.accessoryList
}

HueBridge.prototype.getInfoService = function () {
  return this.infoService
}

HueBridge.prototype.exposeBridge = async function () {
  this.name = this.bridge.name
  this.serialNumber = this.bridge.bridgeid
  // jshint -W106
  this.uuid_base = this.serialNumber
  // jshint +W106
  this.username = this.platform.config.users[this.serialNumber] || ''
  this.config = {
    parallelRequests: 10,
    nativeHomeKitLights: this.platform.config.nativeHomeKitLights,
    nativeHomeKitSensors: this.platform.config.nativeHomeKitSensors
  }
  this.model = this.bridge.modelid
  if (
    this.model === 'BSB002' && !HueClient.isHueBridgeId(this.bridge.bridgeid)
  ) {
    this.model = 'HA-Bridge'
  }
  if (this.model == null) {
    this.model = 'Tasmota'
  }
  this.philips = 'Philips'
  const recommendedVersion = this.platform.packageJson.engines[this.bridge.modelid]
  switch (this.model) {
    case 'BSB001': // Philips Hue v1 (round) bridge;
      this.config.parallelRequests = 3
      this.config.nativeHomeKitLights = false
      this.config.nativeHomeKitSensors = false
      /* falls through */
    case 'BSB002': // Philips Hue v2 (square) bridge;
      this.isHue = true
      this.version = this.bridge.apiversion
      if (semver.gte(this.version, '1.36.0')) {
        this.philips = 'Signify Netherlands B.V.'
      }
      this.manufacturer = this.philips
      this.idString = util.format(
        '%s: %s %s %s v%s, api v%s', this.name, this.manufacturer,
        this.model, this.type, this.bridge.swversion, this.bridge.apiversion
      )
      this.log.info(this.idString)
      if (!semver.satisfies(this.version, recommendedVersion)) {
        this.log.warn(
          '%s: warning: not using recommended Hue bridge api version %s',
          this.name, recommendedVersion
        )
      }
      this.config.link = semver.lt(this.version, '1.31.0')
      break
    case 'deCONZ': // deCONZ rest api
      if (this.bridge.bridgeid === '0000000000000000') {
        this.log.info(
          '%s: RaspBee/ConBee not yet initialised - wait 1 minute', this.bridge.name
        )
        await homebridgeLib.timeout(60000)
        this.bridge = await this.platform.hueDiscovery.config(this.host)
        return this.exposeBridge()
      }
      this.isDeconz = true
      this.manufacturer = 'dresden elektronik'
      this.type = 'gateway'
      this.version = this.bridge.swversion
      this.config.nativeHomeKitLights = false
      this.config.nativeHomeKitSensors = false
      this.config.effects = this.platform.config.effects
      this.idString = util.format(
        '%s: %s %s %s v%s, api v%s', this.name, this.manufacturer,
        this.model, this.type, this.bridge.swversion, this.bridge.apiversion
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
        this.bridge.swversion, this.bridge.apiversion
      )
      this.log.info(this.idString)
      this.version = this.bridge.apiversion
      this.config.nativeHomeKitLights = false
      this.config.nativeHomeKitSensors = false
      break
    case 'Tasmota':
      this.manufacturer = 'Sonoff'
      this.idString = util.format(
        '%s: %s %s v%s, api v%s', this.name, this.manufacturer,
        this.model, this.bridge.swversion, this.bridge.apiversion
      )
      this.version = this.bridge.apiversion
      this.config.nativeHomeKitLights = false
      this.config.nativeHomeKitSensors = false
      this.username = 'homebridgehue'
      break
    default:
      this.log.warn(
        '%s: warning: ignoring unknown bridge/gateway %j',
        this.name, this.bridge
      )
      throw new Error('unknown bridge')
  }
  this.config.linkButton = this.platform.config.linkButton == null
    ? this.config.link
    : this.platform.config.linkButton

  const options = {
    config: this.bridge,
    forceHttp: this.platform.config.forceHttp,
    host: this.host,
    keepAlive: true,
    maxSockets: this.platform.config.parallelRequests || this.config.parallelRequests,
    timeout: this.platform.config.timeout,
    waitTimePut: this.platform.config.waitTimePut,
    waitTimePutGroup: this.platform.config.waitTimePutGroup,
    waitTimeResend: this.platform.config.waitTimeResend
  }
  if (this.username !== '') {
    options.username = this.username
  }
  this.hueClient = new HueClient(options)
  this.hueClient
    .on('error', (error) => {
      if (error.request.id !== this.requestId) {
        if (error.request.body == null) {
          this.log(
            '%s: request %d: %s %s', this.name, error.request.id,
            error.request.method, error.request.resource
          )
        } else {
          this.log(
            '%s: request %d: %s %s %s', this.name, error.request.id,
            error.request.method, error.request.resource, error.request.body
          )
        }
        this.requestId = error.request.id
      }
      this.log.warn(
        '%s: request %d: %s', this.name, error.request.id, formatError(error)
      )
    })
    .on('request', (request) => {
      if (request.body == null) {
        this.log.debug(
          '%s: request %d: %s %s', this.name, request.id,
          request.method, request.resource
        )
      } else {
        this.log.debug(
          '%s: request %d: %s %s %s', this.name, request.id,
          request.method, request.resource, request.body
        )
      }
    })
    .on('response', (response) => {
      this.log.debug(
        '%s: request %d: %d %s', this.name, response.request.id,
        response.statusCode, response.statusMessage
      )
    })

  this.infoService = new Service.AccessoryInformation()
  this.serviceList.push(this.infoService)
  this.infoService
    .updateCharacteristic(Characteristic.Manufacturer, this.manufacturer)
    .updateCharacteristic(Characteristic.Model, this.model)
    .updateCharacteristic(Characteristic.SerialNumber, this.serialNumber)
    .updateCharacteristic(Characteristic.FirmwareRevision, this.version)

  this.service = new my.Services.HueBridge(this.name)
  this.serviceList.push(this.service)
  this.service.getCharacteristic(my.Characteristics.Heartrate)
    .updateValue(this.state.heartrate)
    .on('set', this.setHeartrate.bind(this))
  this.service.getCharacteristic(my.Characteristics.LastUpdated)
    .updateValue(String(new Date()).slice(0, 24))
  this.service.getCharacteristic(my.Characteristics.TransitionTime)
    .updateValue(this.state.transitiontime)
    .on('set', this.setTransitionTime.bind(this))
  this.service.addOptionalCharacteristic(Characteristic.Brightness)
  if (this.isHue || this.isDeconz) {
    this.service.getCharacteristic(my.Characteristics.Restart)
      .updateValue(false)
      .on('set', this.setRestart.bind(this))
  }
  if (this.config.linkButton) {
    this.switchService = new Service.StatelessProgrammableSwitch(this.name)
    this.serviceList.push(this.switchService)
    this.switchService
      .getCharacteristic(Characteristic.ProgrammableSwitchEvent)
      .setProps({
        minValue: Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS,
        maxValue: Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS
      })
    if (this.config.link) {
      this.state.linkbutton = false
      this.state.hkLink = false
      this.service.getCharacteristic(my.Characteristics.Link)
        .updateValue(this.state.hkLink)
        .on('set', this.setLink.bind(this))
    }
  }
  this.accessoryList.push(this)
}

HueBridge.prototype.createUser = async function () {
  if (this.username) {
    return
  }
  try {
    this.username = await this.hueClient.createuser('homebridge-hue')
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
    return
  } catch (error) {
    if (error.request != null) {
      if (error.type === 101) {
        const s = this.isDeconz
          ? 'unlock gateway'
          : 'press link button on the bridge'
        this.log.info('%s: %s to create a user - retrying in 15s', this.name, s)
      }
    } else {
      this.log.error('%s: %s', this.name, formatError(error))
    }
    await homebridgeLib.timeout(15000)
    return this.createUser()
  }
}

HueBridge.prototype.getFullState = async function () {
  const state = await this.get('/')
  if (state == null || state.groups == null) {
    throw new Error('cannot get full state')
  }
  try {
    const group0 = await this.get('/groups/0')
    state.groups[0] = group0
  } catch (error) {
    this.log.warn('%s: warning: /groups/0 blacklisted', this.name)
    this.blacklist.groups[0] = true
  }
  if (state.resourcelinks == null) {
    const resourcelinks = await this.get('/resourcelinks')
    state.resourcelinks = resourcelinks
  }
  this.fullState = state
  return state
}

HueBridge.prototype.exposeResources = async function (obj) {
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
        case 'switch':
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
        if (!this.whitelist[type]) {
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
          try {
            const state = await this.getFullState()
            return this.exposeResources(state)
          } catch (error) {
            return this.exposeResources(obj)
          }
        }
        if (list === 'multiclip') {
          if (
            type !== 'sensors' || (
              obj[type][id].type.slice(0, 4) !== 'CLIP' &&
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
        } else if (list === 'switch') {
          if (type !== 'groups' && type !== 'lights') {
            this.log.warn(
              '%s: /resourcelinks/%d: %s: ignoring unsupported switch resource',
              this.name, key, resource
            )
            continue
          }
          this.switch[type][id] = true
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
          this.whitelist[type][id] = true
        }
      }
    }
  }
  this.log.debug(
    '%s: %s: %s %s %s "%s"', this.name, this.serialNumber,
    this.manufacturer, this.model, this.type, this.name
  )
  if (this.isHue) {
    for (const id in obj.groups) {
      obj.groups[id].scenes = []
    }
    for (const key in obj.scenes) {
      if (this.platform.config.scenes && this.blacklist.scenes[key]) {
        this.log.debug('%s: /scenes/%s: blacklisted', this.name, key)
      } else if (this.platform.config.scenes || this.whitelist.scenes[key]) {
        const scene = obj.scenes[key]
        const id = scene.group == null ? 0 : scene.group
        this.log.debug('%s: /scenes/%s: group: %d', this.name, key, id)
        obj.groups[id].scenes.push({ id: key, name: scene.name })
      }
    }
  }
  this.exposeGroups(obj.groups)
  this.exposeLights(obj.lights)
  this.exposeSensors(obj.sensors)
  this.exposeSchedules(obj.schedules)
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
  for (const id in sensors) {
    const sensor = sensors[id]
    if (this.whitelist.sensors[id]) {
      this.exposeSensor(id, sensor)
    } else if (this.platform.config.sensors) {
      if (this.blacklist.sensors[id]) {
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
          sensor.type.slice(0, 4) === 'CLIP' &&
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
      } else if (
        obj.manufacturername === 'Samjin' && obj.modelid === 'button'
      ) {
        // Re-expose button tile in Home on iOS 14.
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
    this.log.warn(
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
  for (const id in lights) {
    const light = lights[id]
    if (this.whitelist.lights[id]) {
      this.exposeLight(id, light)
    } else if (this.platform.config.lights) {
      if (this.blacklist.lights[id]) {
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
  for (const id in groups) {
    const group = groups[id]
    if (this.whitelist.groups[id]) {
      this.exposeGroup(id, group)
    } else if (this.platform.config.groups) {
      if (this.blacklist.groups[id]) {
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
  for (const id in schedules) {
    if (this.whitelist.schedules[id]) {
      this.exposeSchedule(id, schedules[id])
    } else if (this.platform.config.schedules) {
      if (this.blacklist.schedules[id]) {
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
  for (const id in rules) {
    if (this.whitelist.rules[id]) {
      this.log.debug('%s: /rules/%d: whitelisted', this.name, id)
    } else if (this.platform.config.rules) {
      if (this.blacklist.rules[id]) {
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
  const host = this.hostname + ':' + this.obj.websocketport
  const ws = new WsMonitor({ host: host, retryTime: 15 })
  ws
    .on('error', (error) => {
      this.log.warn(
        '%s: websocket communication error: %s', this.name, formatError(error)
      )
    })
    .on('listening', (url) => {
      this.log.debug('%s: websocket connected to %s', this.name, url)
    })
    .on('changed', (resource, obj) => {
      try {
        const r = resource.split('/')
        const a = this[r[1]][r[2]]
        if (a) {
          if (r.length === 3) {
            this.log.debug('%s: attr changed event: %j', a.name, obj)
            a.checkAttr(obj, true)
          } else if (r[3] === 'state') {
            this.log.debug('%s: state changed event: %j', a.name, obj)
            a.checkState(obj, true)
          } else if (r[3] === 'config') {
            this.log.debug('%s: config changed event: %j', a.name, obj)
            a.checkConfig(obj, true)
          }
        }
      } catch (error) {
        this.log.warn('%s: websocket error: %s', this.name, formatError(error))
      }
    })
    .on('closed', (url) => {
      this.log.warn(
        '%s: websocket connection to %s closed - retrying in 15s', this.name,
        url
      )
    })
    .listen()
}

// ===== Heartbeat =============================================================

HueBridge.prototype.heartbeat = async function (beat) {
  if (beat % this.state.heartrate === 0) {
    this.service.getCharacteristic(my.Characteristics.LastUpdated)
      .updateValue(String(new Date()).slice(0, 24))
    try {
      await this.heartbeatConfig(beat)
      await this.heartbeatSensors(beat)
      await this.heartbeatLights(beat)
      await this.heartbeatGroup0(beat)
      await this.heartbeatGroups(beat)
      await this.heartbeatSchedules(beat)
      await this.heartbeatRules(beat)
    } catch (error) {
      if (error.request == null) {
        this.log.warn('%s: heartbeat error: %s', this.name, formatError(error))
      }
    }
  }
  if (beat % 600 === 0) {
    try {
      for (const id in this.sensors) {
        this.sensors[id].addEntry()
      }
    } catch (error) {
      this.log.warn('%s: heartbeat error: %s', this.name, formatError(error))
    }
  }
}

HueBridge.prototype.heartbeatSensors = async function (beat) {
  if (this.state.sensors === 0) {
    return
  }
  const sensors = await this.get('/sensors')
  for (const id in sensors) {
    const a = this.sensors[id]
    if (a) {
      a.heartbeat(beat, sensors[id])
    }
  }
}

HueBridge.prototype.heartbeatConfig = async function (beat) {
  if (!this.config.link) {
    return
  }
  const config = await this.get('/config')
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
      await this.put('/config', { linkbutton: false })
      this.state.linkbutton = false
    } else {
      const hkLink = false
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
  const lights = await this.get('/lights')
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
  const groups = await this.get('/groups')
  for (const id in groups) {
    if (id === '0') {
      // Workaround for deCONZ bug
      continue
    }
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
  const group0 = await this.get('/groups/0')
  const a = this.groups[0]
  if (a) {
    a.heartbeat(beat, group0)
  }
}

HueBridge.prototype.heartbeatSchedules = async function (beat) {
  if (this.state.schedules === 0) {
    return
  }
  const schedules = await this.get('/schedules')
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
  const rules = await this.get('/rules')
  for (const id in rules) {
    const a = this.rules[id]
    if (a) {
      a.heartbeat(beat, rules[id])
    }
  }
}

// ===== Homekit Events ========================================================

HueBridge.prototype.setHeartrate = function (rate, callback) {
  rate = Math.round(rate)
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
  if (link === this.state.hkLink) {
    return callback()
  }
  this.log.info(
    '%s: homekit link changed from %s to %s', this.name,
    this.state.hkLink, link
  )
  this.state.hkLink = link
  const newValue = link
  this.put('/config', { linkbutton: newValue }).then(() => {
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
  this.hueClient.restart().then((obj) => {
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

HueBridge.prototype.get = async function (resource) {
  try {
    return this.hueClient.get(resource)
  } catch (error) {
    if (error.request == null) {
      this.log.error('%s: %s', this.name, formatError(error))
    }
    throw error
  }
}

HueBridge.prototype.put = async function (resource, body) {
  try {
    return this.hueClient.put(resource, body)
  } catch (error) {
    if (error.request == null) {
      this.log.error('%s: %s', this.name, formatError(error))
    }
    throw error
  }
}
