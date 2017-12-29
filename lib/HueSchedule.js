// homebridge-hue/lib/HueSchedule.js
// Copyright © 2016, 2017 Erik Baauw. All rights reserved.
//
// Homebridge plugin for Philips Hue.
//
// HueSchedule provides support for Philips Hue schedules and rules.

'use strict';

module.exports = {
  setHomebridge: setHomebridge,
  HueSchedule: HueSchedule
};

// ===== Homebridge ============================================================

let Accessory;
let Service;
let Characteristic;

function setHomebridge(homebridge) {
  Accessory = homebridge.platformAccessory;
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
}

// ===== HueSchedule ===========================================================

function HueSchedule(bridge, id, obj, type) {
  // jshint -W106
  this.log = bridge.log;
  this.bridge = bridge;
  this.name = obj.name;
  this.type = type ? type : 'schedule';
  this.resource = '/' + this.type + 's/' + id;
  this.uuid_base = bridge.uuid_base + '/' + this.resource;
  this.obj = obj;
  this.refresh();

  this.infoService = new Service.AccessoryInformation();
  this.infoService
    .updateCharacteristic(Characteristic.Manufacturer, 'Philips')
    .updateCharacteristic(
      Characteristic.Model, type === 'schedule' ? 'Schedule' : 'Rule'
    )
    .updateCharacteristic(Characteristic.SerialNumber, this.uuid_base)
    .updateCharacteristic(
      Characteristic.FirmwareRevision, this.bridge.version
    );
  this.service = new Service.Resource(this.name, this.resource);
  this.service.getCharacteristic(Characteristic.Enabled)
    .updateValue(this.hk.enabled)
    .on('set', this.setEnabled.bind(this));
  if (this.type === 'rule') {
    this.service
      .updateCharacteristic(Characteristic.LastTriggered, this.hk.lasttriggered)
      .updateCharacteristic(
        Characteristic.TimesTriggered, this.hk.timestriggered
      );
  }
  this.service
    .updateCharacteristic(Characteristic.StatusActive, this.hk.enabled);
  if (this.bridge.platform.config.resource) {
    this.service
      .updateCharacteristic(Characteristic.Resource, this.resource);
      this.service.getCharacteristic(Characteristic.Resource)
        .updateValue(this.resource);
  }
}

HueSchedule.prototype.getServices = function() {
  return [this.service, this.infoService];
};

HueSchedule.prototype.refresh = function() {
  this.hk = {};
  this.hk.enabled = this.obj.status === 'enabled' ? 1 : 0;
  if (this.type === 'rule') {
    this.hk.lasttriggered =
      (this.obj.lasttriggered && this.obj.lasttriggered !== 'none') ?
      String(new Date(this.obj.lasttriggered + 'Z')).substring(0, 24) : 'n/a';
    this.hk.timestriggered = this.obj.timestriggered;
  }
};

// ===== Bridge Events =========================================================

HueSchedule.prototype.heartbeat = function(obj) {
  const old = {
    obj: this.obj,
    hk: this.hk
  };
  this.obj = obj;
  this.refresh();
  if (this.obj.status !== old.obj.status) {
    this.log.info(
      '%s: change homekit enabled from %s to %s', this.name,
      old.hk.enabled, this.hk.enabled
    );
    this.service
      .updateCharacteristic(Characteristic.Enabled, this.hk.enabled)
      .updateCharacteristic(Characteristic.StatusActive, this.hk.enabled);
  }
  if (this.obj.lasttriggered !== old.obj.lasttriggered) {
    this.log.debug(
      '%s: rule triggered on %s', this.name, this.hk.lasttriggered
    );
    this.service
      .updateCharacteristic(Characteristic.LastTriggered, this.hk.lasttriggered)
      .updateCharacteristic(
        Characteristic.TimesTriggered, this.hk.timestriggered
      );
  }
};

// ===== Homekit Events ========================================================

HueSchedule.prototype.identify = function(callback) {
  this.log.info('%s: identify', this.name);
  return callback();
};

HueSchedule.prototype.setEnabled = function(enabled, callback) {
  enabled = enabled ? 1 : 0;
  if (enabled === this.hk.enabled) {
    return callback();
  }
  this.log.info(
    '%s: homekit enabled changed from %s to %s', this.name,
    this.hk.enabled, enabled
  );
  const status = enabled ? 'enabled' : 'disabled';
  this.bridge.request('put', this.resource, {status: status})
  .then((obj) => {
    this.obj.status = status;
    this.refresh();
    this.service
      .updateCharacteristic(Characteristic.StatusActive, this.hk.enabled);
    return callback();
  }).catch((err) => {
    return callback(new Error(err));
  });
};
