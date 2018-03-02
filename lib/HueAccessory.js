// homebridge-hue/lib/HueAccessory.js
// Copyright © 2016-2018 Erik Baauw. All rights reserved.
//
// Homebridge plugin for Philips Hue and/or deCONZ.
//
// HueAccessory provides support for ZigBee devices.

'use strict'

const fakegatoHistory = require('fakegato-history')

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

// ===== Homebridge ============================================================

// Link this module to homebridge.
let Service
let Characteristic
// let my
// let eve
let HistoryService

function setHomebridge (homebridge, _my, _eve) {
  Service = homebridge.hap.Service
  Characteristic = homebridge.hap.Characteristic
  // my = _my
  // eve = _eve
  HistoryService = fakegatoHistory(homebridge)
  HueLightModule.setHomebridge(homebridge, _my, _eve)
  HueSensorModule.setHomebridge(homebridge, _my, _eve)
}

// ===== HueAccessory ==========================================================

function HueAccessory (bridge, serialNumber) {
  this.log = bridge.log
  this.bridge = bridge
  this.serialNumber = serialNumber
  // jshint -W106
  this.uuid_base = this.serialNumber
  // jshint +W106
  this.resources = {
    sensors: {other: []},
    lights: {other: []}
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
    this.resources.group = {id: id, obj: obj}
  }
}

HueAccessory.prototype.addLightResource = function (id, obj) {
  switch (obj.type) {
    case 'Extended color light':
    case 'Color light':
      if (this.resources.lights.main == null) {
        this.resources.lights.main = {id: id, obj: obj}
        return
      }
      // falls through
    default:
      this.resources.lights.other.push({id: id, obj: obj})
      break
  }
}

HueAccessory.prototype.addSensorResource = function (id, obj) {
  const type = obj.type.substring(obj.type[0] === 'Z' ? 3 : 4)
  switch (type) {
    case 'OpenClose':
    case 'Presence':
    case 'LightLevel':
    case 'Temperature':
    case 'Humidity':
    case 'Pressure':
    case 'Consumption':
    case 'Power':
      if (this.resources.sensors[type] == null) {
        this.resources.sensors[type] = {id: id, obj: obj}
        return
      }
      // falls through
    default:
      this.resources.sensors.other.push({id: id, obj: obj})
      break
  }
}

HueAccessory.prototype.expose = function () {
  this.exposeGroups()
  this.exposeLights()
  this.exposeSensors()
  return [this]
}

HueAccessory.prototype.exposeGroups = function () {
  if (this.resources.group != null) {
    const id = this.resources.group.id
    const obj = this.resources.group.obj
    this.log.debug(
      '%s: %s: %s group "%s"', this.bridge.name, this.serialNumber,
      obj.type, obj.name
    )
    this.exposeGroup(id, obj)
  }
}

HueAccessory.prototype.exposeGroup = function (id, obj) {
  this.log.debug(
    '%s: /groups/%d: %s "%s"', this.bridge.name, id, obj.type, obj.name
  )
  try {
    const group = new HueLight(this, id, obj, 'group')
    this.bridge.groups[id] = group
    this.groups[id] = group
    this.serviceList.push(group.service)
    this.service = this.service || group.service
  } catch (e) {
    this.log.error('%s: error: /groups/%d: %j\n', this.bridge.name, id, obj, e)
  }
}

HueAccessory.prototype.exposeLights = function () {
  if (this.resources.lights.main != null) {
    this.resources.lights.other.unshift(this.resources.lights.main)
  }
  if (this.resources.lights.other.length > 0) {
    const resource = this.resources.lights.other.shift()
    const id = resource.id
    const obj = resource.obj
    if (this.service == null) {
      this.log.debug(
        '%s: %s: %s %s light "%s"', this.bridge.name, this.serialNumber,
        obj.manufacturername, obj.modelid, obj.name
      )
    }
    this.exposeLight(id, obj)
    for (const resource of this.resources.lights.other) {
      this.exposeLight(resource.id, resource.obj)
    }
  }
}

HueAccessory.prototype.exposeLight = function (id, obj) {
  this.log.debug(
    '%s:   /lights/%d: %s %s (%s) "%s"', this.bridge.name, id,
    obj.manufacturername, obj.modelid, obj.type, obj.name
  )
  try {
    const light = new HueLight(this, id, obj)
    this.bridge.lights[id] = light
    this.lights[id] = light
    this.serviceList.push(light.service)
    this.service = this.service || light.service
    this.lightService = this.lightService || light.service
  } catch (e) {
    this.log.error('%s: error: /lights/%d: %j\n', this.bridge.name, id, obj, e)
  }
}

HueAccessory.prototype.exposeSensors = function () {
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
    const resource = this.resources.sensors.other.shift()
    const id = resource.id
    const obj = resource.obj
    if (this.service == null) {
      this.log.debug(
        '%s: %s: %s %s sensor "%s"', this.bridge.name, this.serialNumber,
        obj.manufacturername, obj.modelid, obj.name
      )
    }
    this.exposeSensor(id, obj)
    for (const resource of this.resources.sensors.other) {
      const id = resource.id
      const obj = resource.obj
      this.exposeSensor(id, obj)
    }
  }
}

HueAccessory.prototype.exposeSensor = function (id, obj) {
  if (obj.type[0] === 'Z') {
    this.log.debug(
      '%s:   /sensors/%d: %s %s (%s) "%s"', this.bridge.name, id,
      obj.manufacturername, obj.modelid, obj.type, obj.name
    )
  } else {
    this.log.debug(
      '%s:   /sensors/%d: %s "%s"', this.bridge.name, id, obj.type, obj.name
    )
  }
  try {
    const sensor = new HueSensor(this, id, obj)
    if (sensor.service) {
      this.bridge.sensors[id] = sensor
      this.service = this.service || sensor.service
      this.sensorService = this.sensorService || sensor.service
      this.sensors[id] = sensor
      for (const service of sensor.serviceList) {
        this.serviceList.push(service)
      }
    }
  } catch (e) {
    this.log.error('%s: error: /sensors/%d: %j\n', this.bridge.name, id, obj, e)
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
    this.name = obj.name
    this.displayName = this.name
    this.infoService = new Service.AccessoryInformation()
    this.manufacturer = obj.manufacturer
    this.model = obj.model
    this.version = obj.version
    this.infoService
      .updateCharacteristic(Characteristic.Manufacturer, this.manufacturer)
      .updateCharacteristic(Characteristic.Model, this.model)
      .updateCharacteristic(Characteristic.SerialNumber, this.serialNumber)
      .updateCharacteristic(Characteristic.FirmwareRevision, this.version)
    // jshint -W106
    this.uuid_base = this.serialNumber
    // jshint +W106
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

HueAccessory.prototype.getLabelService = function (labelNamespace) {
  if (this.labelService == null) {
    this.labelService = new Service.ServiceLabel(this.name)
    this.serviceList.push(this.service)
    this.service.getCharacteristic(Characteristic.ServiceLabelNamespace)
      .updateValue(labelNamespace)
  }
  return this.labelService
}

HueAccessory.prototype.getHistoryService = function (type, key) {
  if (this.historyService == null) {
    this.displayName = this.name
    this.historyService = new HistoryService(type, this, {
      disableTimer: true,
      storage: 'fs',
      path: this.bridge.platform.api.user.storagePath() + '/accessories',
      filename: 'history_' + this.serialNumber + '.json'
    })
    this.history = {entry: {}, type: type, key: key}
  }
  return this.historyService
}
