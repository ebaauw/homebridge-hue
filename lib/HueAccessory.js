// homebridge-hue/lib/HueAccessory.js
// Copyright © 2016-2022 Erik Baauw. All rights reserved.
//
// Homebridge plugin for Philips Hue and/or deCONZ.

'use strict'

const fakegatoHistory = require('fakegato-history')
const homebridgeLib = require('homebridge-lib')

const HueLightModule = require('./HueLight')
const HueSensorModule = require('./HueSensor')
const HueLight = HueLightModule.HueLight
const HueSensor = HueSensorModule.HueSensor

// Link this module to HuePlatform.
module.exports = {
  setHomebridge: setHomebridge,
  HueAccessory: HueAccessory
}

function toInt (value, minValue, maxValue) {
  const n = parseInt(value)
  if (isNaN(n) || n < minValue) {
    return minValue
  }
  if (n > maxValue) {
    return maxValue
  }
  return n
}

const formatError = homebridgeLib.formatError

// ===== Homebridge ============================================================

// Link this module to homebridge.
let Service
let Characteristic
let my
let eve
let HistoryService

function setHomebridge (homebridge, _my, _eve) {
  Service = homebridge.hap.Service
  Characteristic = homebridge.hap.Characteristic
  my = _my
  eve = _eve
  HistoryService = fakegatoHistory(homebridge)
  HueLightModule.setHomebridge(homebridge, _my, _eve)
  HueSensorModule.setHomebridge(homebridge, _my, _eve)
}

// ===== HueAccessory ==========================================================

function HueAccessory (bridge, serialNumber, isMulti = false) {
  this.log = bridge.log
  this.bridge = bridge
  this.serialNumber = serialNumber
  // jshint -W106
  this.uuid_base = this.serialNumber
  // jshint +W106
  this.isMulti = isMulti
  this.resources = {
    sensors: { other: [] },
    lights: { other: [] }
  }
  this.sensors = {}
  this.lights = {}
  this.groups = {}
  this.serviceList = []
  this.state = {}
  this.hk = {}
}

// ===== Resources =============================================================

HueAccessory.prototype.addGroupResource = function (id, obj) {
  if (this.resources.group == null) {
    this.resources.group = { id: id, obj: obj }
  }
}

HueAccessory.prototype.addLightResource = function (id, obj) {
  switch (obj.type) {
    case 'Extended color light':
    case 'Color light':
      if (!this.isMulti && this.resources.lights.main == null) {
        this.resources.lights.main = { id: id, obj: obj }
        return
      }
      // falls through
    default:
      this.resources.lights.other.push({ id: id, obj: obj })
      break
  }
}

HueAccessory.prototype.addSensorResource = function (id, obj) {
  const type = obj.type.slice(obj.type[0] === 'Z' ? 3 : 4)
  switch (type) {
    case 'OpenClose':
    case 'Presence':
    case 'LightLevel':
    case 'Temperature':
    case 'Humidity':
    case 'Pressure':
    case 'Consumption':
    case 'Power':
      if (!this.isMulti && this.resources.sensors[type] == null) {
        this.resources.sensors[type] = { id: id, obj: obj }
        return
      }
      // falls through
    default:
      this.resources.sensors.other.push({ id: id, obj: obj })
      break
  }
}

HueAccessory.prototype.expose = function () {
  this.exposeGroupResources()
  this.exposeLightResources()
  this.exposeSensorResources()
  return [this]
}

HueAccessory.prototype.exposeGroupResources = function () {
  if (this.resources.group != null) {
    const id = this.resources.group.id
    const obj = this.resources.group.obj
    this.name = obj.name
    this.manufacturer = this.bridge.manufacturer
    this.model = obj.type
    this.version = this.bridge.version
    this.log.debug(
      '%s: %s: %s "%s"', this.bridge.name,
      this.serialNumber, this.model, this.name
    )
    this.exposeGroupResource(id, obj)
  }
}

HueAccessory.prototype.exposeGroupResource = function (id, obj) {
  this.log.debug(
    '%s: /groups/%d: %s "%s"', this.bridge.name, id, obj.type, obj.name
  )
  try {
    const group = new HueLight(this, id, obj, 'group')
    this.bridge.groups[id] = group
    this.groups[id] = group
    this.serviceList.push(group.service)
    this.resource = this.resource || group
    if (this.service == null) {
      this.service = group.service
      this.service.setPrimaryService()
    }
    if (this.bridge.platform.config.scenes) {
      const SceneService = this.bridge.platform.config.scenesAsSwitch
        ? Service.Switch
        : my.Services.Resource
      const SceneCharacteristic = this.bridge.platform.config.scenesAsSwitch
        ? Characteristic.On
        : my.Characteristics.Recall
      if (obj.scenes != null) {
        for (const scene of obj.scenes) {
          const resource = this.bridge.isHue
            ? '/scenes/' + scene.id
            : '/groups/' + id + '/scenes/' + scene.id
          const sceneName = obj.name + ' ' + scene.name
          const path = this.bridge.isHue
            ? '/groups/' + id + '/action'
            : resource + '/recall'
          const body = this.bridge.isHue
            ? { scene: scene.id }
            : undefined
          this.log.debug('%s: %s: "%s"', this.bridge.name, resource, sceneName)
          const service = new SceneService(sceneName, 'scene' + scene.id)
          service.getCharacteristic(SceneCharacteristic)
            .setValue(0)
            .on('set', (value, callback) => {
              if (!value) {
                return callback()
              }
              group.disableAdaptiveLighting()
              this.log('%s: recall scene %j', this.bridge.name, sceneName)
              this.bridge.put(path, body).then((obj) => {
                setTimeout(() => {
                  service.updateCharacteristic(SceneCharacteristic, 0)
                }, this.bridge.platform.config.resetTimeout)
                callback()
              })
            })
          if (this.bridge.platform.config.resource) {
            service.addOptionalCharacteristic(my.Characteristics.Resource)
            service.getCharacteristic(my.Characteristics.Resource)
              .updateValue(resource)
          }
          this.serviceList.push(service)
        }
      }
    }
  } catch (e) {
    this.log.error(
      '%s: error: /groups/%d: %j\n%s', this.bridge.name, id, obj, formatError(e)
    )
  }
}

HueAccessory.prototype.exposeLightResources = function () {
  if (this.resources.lights.main != null) {
    this.resources.lights.other.unshift(this.resources.lights.main)
  }
  if (this.resources.lights.other.length > 0) {
    const obj = this.resources.lights.other[0].obj
    if (this.service == null) {
      this.name = obj.name
      this.manufacturer = this.isMulti
        ? this.bridge.manufacturer
        : obj.manufacturername
      this.model = this.isMulti ? 'MultiLight' : obj.modelid
      this.version = this.isMulti ? this.bridge.version : obj.swversion
      this.log.debug(
        '%s: %s: %s %s "%s"', this.bridge.name, this.serialNumber,
        this.manufacturer, this.model, this.name
      )
    }
    for (const resource of this.resources.lights.other) {
      this.exposeLightResource(resource.id, resource.obj)
    }
  }
}

HueAccessory.prototype.exposeLightResource = function (id, obj) {
  this.log.debug(
    '%s: /lights/%d: %s "%s"', this.bridge.name, id, obj.type, obj.name
  )
  try {
    const light = new HueLight(this, id, obj)
    this.bridge.lights[id] = light
    this.lights[id] = light
    this.serviceList.push(light.service)
    for (const service of light.effectServices) {
      this.serviceList.push(service)
    }
    this.resource = this.resource || light
    if (this.service == null) {
      this.service = light.service
      this.service.setPrimaryService()
    }
    this.lightService = this.lightService || light.service
  } catch (e) {
    this.log.error(
      '%s: error: /lights/%d: %j\n%s', this.bridge.name, id, obj, formatError(e)
    )
  }
}

HueAccessory.prototype.exposeSensorResources = function () {
  // Force the order of processing the sensor resources.
  if (this.resources.sensors.Power != null) {
    this.resources.sensors.other.unshift(this.resources.sensors.Power)
  }
  if (this.resources.sensors.Consumption != null) {
    this.resources.sensors.other.unshift(this.resources.sensors.Consumption)
  }
  if (this.resources.sensors.Pressure != null) {
    this.resources.sensors.other.unshift(this.resources.sensors.Pressure)
  }
  if (this.resources.sensors.Humidity != null) {
    this.resources.sensors.other.unshift(this.resources.sensors.Humidity)
  }
  if (this.resources.sensors.Temperature != null) {
    this.resources.sensors.other.unshift(this.resources.sensors.Temperature)
  }
  if (this.resources.sensors.LightLevel != null) {
    this.resources.sensors.other.unshift(this.resources.sensors.LightLevel)
  }
  if (this.resources.sensors.Presence != null) {
    this.resources.sensors.other.unshift(this.resources.sensors.Presence)
  }
  if (this.resources.sensors.OpenClose != null) {
    this.resources.sensors.other.unshift(this.resources.sensors.OpenClose)
  }
  if (this.resources.sensors.other.length > 0) {
    const obj = this.resources.sensors.other[0].obj
    if (this.service == null) {
      this.name = obj.name
      this.manufacturer = this.isMulti
        ? this.bridge.manufacturer
        : obj.manufacturername
      this.model = this.isMulti ? 'MultiCLIP' : obj.modelid
      this.version = this.isMulti ? this.bridge.version : obj.swversion
      this.log.debug(
        '%s: %s: %s %s "%s"', this.bridge.name, this.serialNumber,
        this.manufacturer, this.model, this.name
      )
    }
    if (
      this.bridge.platform.config.forceEveWeather &&
      this.resources.sensors.other.length === 2 &&
      this.resources.sensors.other[0].obj.type.slice(-11) === 'Temperature' &&
      this.resources.sensors.other[1].obj.type.slice(-8) === 'Humidity'
    ) {
      this.log.debug(
        '%s: /sensors/0: CLIPPressure "Dummy Pressure"', this.bridge.name
      )
      const service = new eve.Services.AirPressureSensor('Dummy Pressure')
      const perms = [Characteristic.Perms.READ, Characteristic.Perms.HIDDEN]
      service.getCharacteristic(eve.Characteristics.AirPressure)
        .setProps({ perms: perms })
        .updateValue(1000)
      service.getCharacteristic(eve.Characteristics.Elevation)
        .setProps({ perms: perms })
        .updateValue(0)
      this.serviceList.push(service)
    }
    for (const resource of this.resources.sensors.other) {
      this.exposeSensorResource(resource.id, resource.obj)
    }
  }
}

HueAccessory.prototype.exposeSensorResource = function (id, obj) {
  this.log.debug(
    '%s: /sensors/%d: %s "%s"', this.bridge.name, id, obj.type, obj.name
  )
  try {
    const sensor = new HueSensor(this, id, obj)
    if (sensor.service) {
      this.bridge.sensors[id] = sensor
      this.sensors[id] = sensor
      for (const service of sensor.serviceList) {
        if (service !== this.lightService) {
          this.serviceList.push(service)
        }
      }
      this.resource = this.resource || sensor
      if (this.service == null) {
        this.service = sensor.service
        this.service.setPrimaryService()
      }
      this.sensorService = this.sensorService || sensor.service
    }
  } catch (e) {
    this.log.error(
      '%s: error: /sensors/%d: %j\n%s', this.bridge.name, id, obj, formatError(e)
    )
  }
}

// ===== Services ==============================================================

HueAccessory.prototype.getServices = function () {
  const serviceList = [this.infoService]
  this.labelService && serviceList.push(this.labelService)
  for (const service of this.serviceList) {
    serviceList.push(service)
  }
  this.batteryService && serviceList.push(this.batteryService)
  this.historyService && serviceList.push(this.historyService)
  return serviceList
}

HueAccessory.prototype.getInfoService = function (obj) {
  if (!this.infoService) {
    if (obj.manufacturer === 'Philips') {
      obj.manufacturer = 'Signify Netherlands B.V.'
    }
    this.infoService = new Service.AccessoryInformation()
    this.infoService
      .updateCharacteristic(Characteristic.Manufacturer, obj.manufacturer)
      .updateCharacteristic(Characteristic.Model, obj.model)
      .updateCharacteristic(Characteristic.SerialNumber, obj.serialNumber)
      .updateCharacteristic(Characteristic.FirmwareRevision, obj.version)
  }
  return this.infoService
}

HueAccessory.prototype.getBatteryService = function (battery) {
  if (this.batteryService == null) {
    this.batteryService = new Service.BatteryService(this.name)
    this.batteryService.getCharacteristic(Characteristic.ChargingState)
      .setValue(Characteristic.ChargingState.NOT_CHARGEABLE)
    this.state.battery = battery
    this.checkBattery(battery)
  }
  return this.batteryService
}

HueAccessory.prototype.checkBattery = function (battery) {
  if (this.state.battery !== battery) {
    this.log.debug(
      '%s: sensor battery changed from %j to %j', this.name,
      this.state.battery, battery
    )
    this.state.battery = battery
  }
  const hkBattery = toInt(this.state.battery, 0, 100)
  if (this.hk.battery !== hkBattery) {
    if (this.hk.battery !== undefined) {
      this.log.info(
        '%s: set homekit battery level from %s%% to %s%%', this.name,
        this.hk.battery, hkBattery
      )
    }
    this.hk.battery = hkBattery
    this.hk.lowBattery =
      this.hk.battery <= this.bridge.platform.config.lowBattery
        ? Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW
        : Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL
    this.batteryService
      .updateCharacteristic(Characteristic.BatteryLevel, this.hk.battery)
      .updateCharacteristic(
        Characteristic.StatusLowBattery, this.hk.lowBattery
      )
  }
}

HueAccessory.prototype.getHistoryService = function (type, resource) {
  if (this.historyService == null) {
    this.historyService = new HistoryService(type, { displayName: this.name }, {
      disableTimer: true,
      storage: 'fs',
      path: this.bridge.platform.api.user.storagePath() + '/accessories',
      filename: 'history_' + this.serialNumber + '.json'
    })
    this.history = { entry: {}, type: type, resource: resource }
  }
  return this.historyService
}

// ===== Services ==============================================================

HueAccessory.prototype.identify = function (callback) {
  if (this.resource.type === 'group') {
    this.log.info(
      '%s: %s: %s "%s"', this.bridge.name, this.serialNumber,
      this.model, this.name
    )
    this.log.info(
      '%s: /groups/%d: %s "%s"', this.bridge.name, this.resource.id,
      this.resource.obj.type, this.resource.name
    )
  } else {
    this.log.info(
      '%s: %s: %s %s "%s"', this.bridge.name, this.serialNumber,
      this.manufacturer, this.model, this.name
    )
  }
  for (const resource of this.resources.lights.other) {
    const light = this.lights[resource.id]
    if (light == null) {
      continue
    }
    this.log.info(
      '%s: /lights/%d: %s "%s"', this.bridge.name, resource.id,
      light.obj.type, light.name
    )
  }
  for (const resource of this.resources.sensors.other) {
    const sensor = this.sensors[resource.id]
    if (sensor == null) {
      continue
    }
    this.log.info(
      '%s: /sensors/%d: %s "%s"', this.bridge.name, resource.id,
      sensor.obj.type, sensor.name
    )
  }
  // TODO loop over all resources
  this.resource.identify(callback)
}
