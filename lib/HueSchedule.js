// homebridge-hue/lib/HueSchedule.js
// (C) 2016, Erik Baauw
//
// Homebridge plugin for Philips Hue.
//
// HueSchedule provides support for Philips Hue schedules.

"use strict";

module.exports = {
  setHomebridge: setHomebridge,
  HueSchedule: HueSchedule
};

// ===== Homebridge ======================================================================

var Accessory;
var Service;
var Characteristic;

function setHomebridge(homebridge) {
  Accessory = homebridge.platformAccessory;
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
}

// ===== HueSchedule =====================================================================

function HueSchedule(bridge, id, obj, type) {
  this.log = bridge.log;
  this.bridge = bridge;
  this.name = obj.name;
  this.uuid_base = bridge.uuid_base + "/schedules/" + id;
  this.url = "/schedules/" + id;
  this.obj = obj;
  this.refresh();

  this.infoService = new Service.AccessoryInformation();
  this.infoService
    .setCharacteristic(Characteristic.Manufacturer, "homebridge-hue")
    .setCharacteristic(Characteristic.Model, "Schedule")
    .setCharacteristic(Characteristic.SerialNumber, this.uuid_base);
  this.service = new Service.Switch;
  this.service.setCharacteristic(Characteristic.On, this.hk.on);
  this.service.getCharacteristic(Characteristic.On)
    .on("get", function(callback) {callback(null, this.hk.on);}.bind(this))
    .on("set", this.setOn.bind(this));
  if (this.obj.starttime !== undefined) {
    this.service.addOptionalCharacteristic(Characteristic.HueSensorLastUpdated);
    this.service.setCharacteristic(Characteristic.HueSensorLastUpdated, this.hk.time);
    this.service.getCharacteristic(Characteristic.HueSensorLastUpdated)
      .on("get", function(callback) {callback(null, this.hk.time);}.bind(this));
  }
}

HueSchedule.prototype.getServices = function() {
  return [this.service, this.infoService];
}

HueSchedule.prototype.refresh = function() {
  this.hk = {};
  this.hk.on = this.obj.status === "enabled" ? 1 : 0;
  if (this.obj.starttime !== undefined) {
    this.hk.time = this.obj.starttime === "none" ? "n/a" :
    		   String(new Date(this.obj.starttime)).substring(0, 25);
  }
}

// ===== Bridge Events ===================================================================

HueSchedule.prototype.heartbeat = function(obj) {
  let old = {
    obj: this.obj,
    hk: this.hk
  };
  this.obj = obj;
  this.refresh();
  if (this.obj.status !== old.obj.status) {
    this.log.debug("%s: schedule %s", this.name, this.obj.status);
    this.log.info("%s: change homekit power from %s to %s",
    		  this.name, old.hk.on, this.hk.on);
    this.service.setCharacteristic(Characteristic.On, this.hk.on);
  }
  if (this.obj.starttime !== old.obj.starttime) {
    this.log.info("%s: schedule started on %s", this.name, this.hk.time);
    this.service.setCharacteristic(Characteristic.HueSensorLastUpdated, this.hk.time);
  }
}

// ===== Homekit Events ==================================================================

HueSchedule.prototype.identify = function(callback) {
  this.log.info("%s: identify", this.name);
  return callback();
}

HueSchedule.prototype.setOn = function(on, callback) {
  if (on === this.hk.on) {
    // schedule updated from hue bridge - we're good
    return callback();
  }
  this.log.info("%s: homekit power changed from %s to %s", this.name, this.hk.on, on);
  let status = on ? "enabled" : "disabled";
  this.bridge.request("put", this.url, "{\"status\":\"" + status + "\"}", function(obj) {
    if (!obj) {
      return callback(new Error());
    }
    this.obj.status = status;
    this.refresh();
    return callback();
  }.bind(this));
}