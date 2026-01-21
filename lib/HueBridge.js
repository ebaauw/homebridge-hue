// homebridge-hue/lib/HueBridge.js
// Copyright © 2016-2026 Erik Baauw. All rights reserved.
//
// Homebridge plugin for Philips Hue.

import { format } from 'node:util'

import { formatError, timeout } from 'homebridge-lib'
import { semver } from 'homebridge-lib/semver'

import { EventStreamClient } from 'hb-hue-tools/EventStreamClient'
import { HueClient } from 'hb-hue-tools/HueClient'

import { HueAccessory } from './HueAccessory.js'
import { HueSchedule } from './HueSchedule.js'

let Service
let Characteristic
let my

class HueBridge {
  static setHomebridge (homebridge, _my, _eve) {
    HueAccessory.setHomebridge(homebridge, _my, _eve)
    HueSchedule.setHomebridge(homebridge, _my)
    Service = homebridge.hap.Service
    Characteristic = homebridge.hap.Characteristic
    my = _my
  }

  constructor (platform, host, bridge) {
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

  getServices () {
    this.log.info('%s: %d services', this.name, this.serviceList.length)
    return this.serviceList
  }

  async accessories () {
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
        await timeout(15000)
        return this.accessories()
      }
    }
    this.log.info('%s: %d accessories', this.name, this.accessoryList.length)
    return this.accessoryList
  }

  getInfoService () {
    return this.infoService
  }

  async exposeBridge () {
    this.name = this.bridge.name
    this.serialNumber = this.bridge.bridgeid
    this.uuid_base = this.serialNumber
    this.apiKey = this.platform.config.users[this.serialNumber] || ''
    this.config = {
      parallelRequests: 10,
      nativeHomeKitLights: this.platform.config.nativeHomeKitLights,
      nativeHomeKitSensors: this.platform.config.nativeHomeKitSensors
    }
    this.model = this.bridge.modelid
    if (
      this.model === 'BSB002' && !HueClient.isHueBridge(this.bridge)
    ) {
      this.model = 'HA-Bridge'
    }
    if (this.model == null) {
      this.model = 'Tasmota'
    }
    this.philips = 'Philips'
    const recommendedVersion = this.platform.packageJson.engines[this.model]
    switch (this.model) {
      case 'BSB001': // Philips Hue v1 (round) bridge
        this.config.parallelRequests = 3
        this.config.nativeHomeKitLights = false
        this.config.nativeHomeKitSensors = false
        /* falls through */
      case 'BSB002': // Philips Hue v2 (square) bridge
      case 'BSB003': // Philips Hue bridge pro
        this.isHue = true
        this.version = this.bridge.apiversion
        if (semver.gte(this.version, '1.36.0')) {
          this.philips = 'Signify Netherlands B.V.'
        }
        this.manufacturer = this.philips
        this.idString = format(
          '%s: %s %s %s v%s, api v%s', this.name, this.manufacturer,
          this.model, this.type, this.bridge.swversion, this.bridge.apiversion
        )
        this.log.info(this.idString)
        // if (this.model === 'BSB002' && this.platform.config.homebridgeHue2 === '') {
        //   this.log.warn(
        //     '%s: warning: support for the gen-2 Hue bridge will be deprecated in favour of Homebridge Hue2',
        //     this.name
        //   )
        // }
        if (!semver.satisfies(this.version, recommendedVersion)) {
          this.log.warn(
            '%s: warning: not using recommended Hue bridge api version %s',
            this.name, recommendedVersion
          )
        }
        this.config.link = semver.lt(this.version, '1.31.0')
        break
      case 'HA-Bridge':
        this.manufacturer = 'HA-Bridge'
        this.idString = format(
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
        this.idString = format(
          '%s: %s %s v%s, api v%s', this.name, this.manufacturer,
          this.model, this.bridge.swversion, this.bridge.apiversion
        )
        this.version = this.bridge.apiversion
        this.config.nativeHomeKitLights = false
        this.config.nativeHomeKitSensors = false
        this.apiKey = 'homebridgehue'
        break
      default:
        this.log.warn(
          '%s: warning: ignoring unknown bridge %j',
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
    if (this.apiKey !== '') {
      options.apiKey = this.apiKey
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
    this.service.setPrimaryService()
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
    if (this.isHue) {
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
    if (this.isHue) {
      this.state.hkSearch = false
      this.service.getCharacteristic(my.Characteristics.Search)
        .updateValue(false)
        .on('set', this.setSearch.bind(this))
    }
    this.accessoryList.push(this)
  }

  async createUser () {
    if (this.apiKey) {
      return
    }
    try {
      this.apiKey = await this.hueClient.getApiKey('homebridge-hue')
      let s = '\n'
      s += '  "platforms": [\n'
      s += '    {\n'
      s += '      "platform": "Hue",\n'
      s += '      "users": {\n'
      s += '        "' + this.serialNumber + '": "' + this.apiKey + '"\n'
      s += '      }\n'
      s += '    }\n'
      s += '  ]'
      this.log.info(
        '%s: created user - please edit config.json and restart homebridge%s',
        this.name, s
      )
    } catch (error) {
      if (error.request != null) {
        if (error.type === 101) {
          this.log.info(
            '%s: press link button on the bridge to create a user - retrying in 15s',
            this.name
          )
        }
      } else {
        this.log.error('%s: %s', this.name, formatError(error))
      }
      await timeout(15000)
      return this.createUser()
    }
  }

  async getFullState () {
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

  async exposeResources (obj) {
    this.obj = obj.config
    for (const key in obj.resourcelinks) {
      const link = obj.resourcelinks[key]
      if (
        link.name === 'homebridge-hue' && link.links && link.description && (
          !this.platform.config.ownResourcelinks ||
          link.owner === this.hueClient.apiKey
        )
      ) {
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
            continue
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
      } else if (
        key === this.platform.config.homebridgeHue2 &&
        link.name === 'homebridge-hue2' &&
        link.links && link.description === 'migration'
      ) {
        this.log.debug(
          '%s: /resourcelinks/%d: %d entries exposed by Homebridge Hue2',
          this.name, key, link.links.length
        )
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
          this.blacklist[type][id] = true
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
    if (this.hueClient.isHue2 && !this.platform.config.forceHttp) {
      await this.listen()
    }
  }

  sensorSerialNumber (id, obj) {
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
            ['Philips', 'Signify Netherlands B.V.'].includes(obj.manufacturername) &&
            ['SML001', 'SML002', 'SML003', 'SML004'].includes(obj.modelid)
          ) {
            // Hue motion sensor.
            if (obj.type === 'ZLLTemperature') {
              serialNumber += '-T'
            }
          }
        }
      }
    }
    return serialNumber
  }

  isLightSensor (id, obj) {
    const serialNumber = this.sensorSerialNumber(id, obj)
    // FIXME: accessory null when lights aren't exposed.
    const accessory = this.accessoryMap[serialNumber]
    return accessory != null && accessory.resources.lights.other.length > 0
  }

  exposeSensors (sensors) {
    for (const id in sensors) {
      const sensor = sensors[id]
      if (this.whitelist.sensors[id]) {
        this.exposeSensor(id, sensor)
      } else if (
        this.platform.config.sensors || (
          this.platform.config.lightSensors && this.isLightSensor(id, sensor)
        )
      ) {
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
          this.platform.config.excludeLightSensors && this.isLightSensor(id, sensor)
        ) {
          this.log.debug(
            '%s: /sensors/%d: light sensors excluded', this.name, id
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

  exposeSensor (id, obj) {
    const serialNumber = this.sensorSerialNumber(id, obj)
    obj.manufacturername = obj.manufacturername.replace(/\//g, '')
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

  exposeLights (lights) {
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
        } else {
          this.exposeLight(id, light)
        }
      }
    }
  }

  exposeLight (id, obj) {
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

  exposeGroups (groups) {
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

  exposeGroup (id, obj) {
    const serialNumber = this.serialNumber + '-G' + id
    let accessory = this.accessoryMap[serialNumber]
    if (accessory == null) {
      accessory = new HueAccessory(this, serialNumber)
      this.accessoryMap[serialNumber] = accessory
    }
    accessory.addGroupResource(id, obj)
  }

  exposeSchedules (schedules) {
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

  exposeSchedule (id, obj) {
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

  exposeRules (rules) {
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

  exposeRule (id, obj) {
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

  resetTransitionTime () {
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

  // ===== Event Stream ==========================================================

  async listen () {
    this.eventStream = new EventStreamClient(this.hueClient, { retryTime: 15 })
    this.eventStream
      .on('error', (error) => {
        if (error.request == null) {
          this.log.warn('%s: event stream error: %s', this.name, formatError(error))
          return
        }
        this.log(
          '%s: event stream request %d: %s %s', this.name, error.request.id,
          error.request.method, error.request.resource
        )
        this.log.warn(
          '%s: event stream request %d: %s', this.name, error.request.id,
          formatError(error)
        )
      })
      .on('request', (request) => {
        if (request.body == null) {
          this.log.debug(
            '%s: event stream request %d: %s %s', this.name, request.id,
            request.method, request.resource
          )
        } else {
          this.log.debug(
            '%s: event stream request %d: %s %s %s', this.name, request.id,
            request.method, request.resource, request.body
          )
        }
      })
      .on('response', (response) => {
        this.log.debug(
          '%s: event stream request %d: %d %s', this.name, response.request.id,
          response.statusCode, response.statusMessage
        )
      })
      .on('listening', (url) => {
        this.log('%s: event stream connected to %s', this.name, url)
      })
      .on('closed', (url) => {
        this.log.warn(
          '%s: event stream connection to %s closed - retrying in 15s', this.name,
          url
        )
      })
      .on('notification', (body) => {
        this.log.debug('%s: event: %j', this.name, body)
      })
      .on('changed', (resource, body) => {
        try {
          const r = resource.split('/')
          if (r[1] === 'scenes') {
            this.log.debug('%s: changed event: %j', resource, body)
            return
          }
          const a = this[r[1]][r[2]]
          if (a) {
            if (r[3] === 'state') {
              this.log.debug('%s: state changed event: %j', a.name, body)
              a.checkState(body, true)
            } else if (r[3] === 'config') {
              this.log.debug('%s: config changed event: %j', a.name, body)
              a.checkConfig(body, true)
            }
          }
        } catch (error) {
          this.log.warn('%s: event stream error: %s', this.name, formatError(error))
        }
      })
    await this.eventStream.init()
    this.eventStream.listen()
  }

  // ===== Heartbeat =============================================================

  async heartbeat (beat) {
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

  async heartbeatSensors (beat) {
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

  async heartbeatConfig (beat) {
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

  async heartbeatLights (beat) {
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

  async heartbeatGroups (beat) {
    if (this.state.groups - this.state.group0 === 0) {
      return
    }
    const groups = await this.get('/groups')
    for (const id in groups) {
      const a = this.groups[id]
      if (a) {
        a.heartbeat(beat, groups[id])
      }
    }
  }

  async heartbeatGroup0 (beat) {
    if (this.state.group0 === 0) {
      return
    }
    const group0 = await this.get('/groups/0')
    const a = this.groups[0]
    if (a) {
      a.heartbeat(beat, group0)
    }
  }

  async heartbeatSchedules (beat) {
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

  async heartbeatRules (beat) {
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

  setHeartrate (rate, callback) {
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

  setLink (link, callback) {
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

  setSearch (search, callback) {
    if (search === this.state.hkSearch) {
      return callback()
    }
    if (this.searchTimer != null) {
      clearTimeout(this.searchTimer)
    }
    this.log.info(
      '%s: homekit search changed from %s to %s', this.name,
      this.state.hkSearch, search
    )
    if (search) {
      this.post('/lights').then(() => {
        this.searchTimer = setTimeout(() => {
          delete this.searchTimer
          this.log(
            '%s: set homekit search from %s to false', this.name,
            this.state.hkSearch
          )
          this.state.hkSearch = false
          this.service
            .updateCharacteristic(my.Characteristics.Search, this.state.hkSearch)
        }, 60 * 1000)
        return callback()
      }).catch((error) => {
        return callback(error)
      })
    }
  }

  setTransitionTime (transitiontime, callback) {
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

  setRestart (restart, callback) {
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

  identify (callback) {
    this.log.info('%s: identify', this.name)
    this.platform.identify()
    this.log.info(this.idString)
    callback()
  }

  async get (resource) {
    try {
      return this.hueClient.get(resource)
    } catch (error) {
      if (error.request == null) {
        this.log.error('%s: %s', this.name, formatError(error))
      }
      throw error
    }
  }

  async post (resource, body) {
    try {
      return this.hueClient.post(resource, body)
    } catch (error) {
      if (error.request == null) {
        this.log.error('%s: %s', this.name, formatError(error))
      }
      throw error
    }
  }

  async put (resource, body) {
    try {
      return this.hueClient.put(resource, body)
    } catch (error) {
      if (error.request == null) {
        this.log.error('%s: %s', this.name, formatError(error))
      }
      throw error
    }
  }
}

export { HueBridge }
