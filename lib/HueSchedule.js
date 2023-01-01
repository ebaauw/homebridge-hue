// homebridge-hue/lib/HueSchedule.js
// Copyright © 2016-2023 Erik Baauw. All rights reserved.
//
// Homebridge plugin for Philips Hue and/or deCONZ.

'use strict'

module.exports = { setHomebridge, HueSchedule }

function dateToString (date, utc = true) {
  if (date == null || date === 'none') {
    return 'n/a'
  }
  if (utc && !date.endsWith('Z')) {
    date += 'Z'
  }
  return String(new Date(date)).slice(0, 24)
}

// ===== Homebridge ============================================================

let Service
let Characteristic
let my

function setHomebridge (homebridge, _my) {
  Service = homebridge.hap.Service
  Characteristic = homebridge.hap.Characteristic
  my = _my
}

// ===== HueSchedule ===========================================================

function HueSchedule (bridge, id, obj, type) {
  this.log = bridge.log
  this.bridge = bridge
  this.name = obj.name
  this.type = type || 'schedule'
  this.resource = '/' + this.type + 's/' + id
  this.serialNumber = bridge.serialNumber + '/' + this.resource
  // jshint -W106
  this.uuid_base = this.serialNumber
  // jshint +W106
  this.obj = obj
  this.refresh()

  this.infoService = new Service.AccessoryInformation()
  this.infoService
    .updateCharacteristic(Characteristic.Manufacturer, this.bridge.philips)
    .updateCharacteristic(
      Characteristic.Model, type === 'schedule' ? 'Schedule' : 'Rule'
    )
    .updateCharacteristic(Characteristic.SerialNumber, this.serialNumber)
    .updateCharacteristic(
      Characteristic.FirmwareRevision, this.bridge.version
    )
  this.service = new my.Services.Resource(this.name, this.resource)
  this.service.getCharacteristic(my.Characteristics.Enabled)
    .updateValue(this.hk.enabled)
    .on('set', this.setEnabled.bind(this))
  if (this.type === 'rule') {
    this.service
      .updateCharacteristic(my.Characteristics.LastTriggered, this.hk.lasttriggered)
      .updateCharacteristic(
        my.Characteristics.TimesTriggered, this.hk.timestriggered
      )
  }
  this.service
    .updateCharacteristic(Characteristic.StatusActive, this.hk.enabled)
  if (this.bridge.platform.config.resource) {
    this.service
      .updateCharacteristic(my.Characteristics.Resource, this.resource)
    this.service.getCharacteristic(my.Characteristics.Resource)
      .updateValue(this.resource)
  }
}

HueSchedule.prototype.getServices = function () {
  return [this.service, this.infoService]
}

HueSchedule.prototype.refresh = function () {
  this.hk = {}
  this.hk.enabled = this.obj.status === 'enabled' ? 1 : 0
  if (this.type === 'rule') {
    this.hk.lasttriggered = dateToString(this.obj.lasttriggered)
    this.hk.timestriggered = this.obj.timestriggered
  }
}

// ===== Bridge Events =========================================================

HueSchedule.prototype.heartbeat = function (beat, obj) {
  const old = {
    obj: this.obj,
    hk: this.hk
  }
  this.obj = obj
  this.refresh()
  if (this.obj.status !== old.obj.status) {
    this.log.info(
      '%s: change homekit enabled from %s to %s', this.name,
      old.hk.enabled, this.hk.enabled
    )
    this.service
      .updateCharacteristic(my.Characteristics.Enabled, this.hk.enabled)
      .updateCharacteristic(Characteristic.StatusActive, this.hk.enabled)
  }
  if (this.obj.lasttriggered !== old.obj.lasttriggered) {
    this.log.debug(
      '%s: rule triggered on %s', this.name, this.hk.lasttriggered
    )
    this.service
      .updateCharacteristic(
        my.Characteristics.LastTriggered, this.hk.lasttriggered
      )
      .updateCharacteristic(
        my.Characteristics.TimesTriggered, this.hk.timestriggered
      )
  }
}

// ===== Homekit Events ========================================================

HueSchedule.prototype.identify = function (callback) {
  this.log.info('%s: identify', this.name)
  return callback()
}

HueSchedule.prototype.setEnabled = function (enabled, callback) {
  enabled = enabled ? 1 : 0
  if (enabled === this.hk.enabled) {
    return callback()
  }
  this.log.info(
    '%s: homekit enabled changed from %s to %s', this.name,
    this.hk.enabled, enabled
  )
  const status = enabled ? 'enabled' : 'disabled'
  this.bridge.put(this.resource, { status }).then((obj) => {
    this.obj.status = status
    this.refresh()
    this.service
      .updateCharacteristic(Characteristic.StatusActive, this.hk.enabled)
    return callback()
  }).catch((error) => {
    return callback(error)
  })
}
