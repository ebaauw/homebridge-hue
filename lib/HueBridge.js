// homebridge-hue/lib/HueBridge.js
// (C) 2016, Erik Baauw
//
// Homebridge plugin for Philips Hue.
//
// HueBridge provides support for Philips Hue bridges.

"use strict";

let util = require("util");
let request = require("request");

let HueLightModule = require("./HueLight");
let HueSensorModule = require("./HueSensor");
let HueScheduleModule = require("./HueSchedule");
let HueLight = HueLightModule.HueLight;
let HueSensor = HueSensorModule.HueSensor;
let HueSchedule = HueScheduleModule.HueSchedule;

module.exports = {
  setHomebridge: setHomebridge,
  HueBridge: HueBridge
};

// ===== Homebridge ======================================================================

let Accessory;
let Service;
let Characteristic;

function setHomebridge(homebridge) {
  HueLightModule.setHomebridge(homebridge);
  HueSensorModule.setHomebridge(homebridge);
  HueScheduleModule.setHomebridge(homebridge);
  Accessory = homebridge.platformAccessory;
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
}

// ===== HueBridge =======================================================================

function HueBridge(platform, host) {
  this.log = platform.log;
  this.platform = platform;
  this.name = host;
  this.url = "http://"+ host + "/api";
  this.lights = {};
  this.groups = {};
  this.sensors = {};
  this.schedules = {};
}

HueBridge.prototype.getServices = function() {
  return [this.infoService];
}

HueBridge.prototype.accessories = function(callback) {
  var accessoryList = [];
  this.request("get", "/config", null, function(obj) {
    if (!obj) {
      return callback(accessoryList);
    } 
    this.name = obj.name;
    this.uuid_base = obj.bridgeid;
    this.url += "/" + this.platform.user;
    this.infoService = new Service.AccessoryInformation();
    this.infoService
      .setCharacteristic(Characteristic.Manufacturer, "homebridge-hue")
      .setCharacteristic(Characteristic.Model, obj.modelid)
      .setCharacteristic(Characteristic.SerialNumber, this.uuid_base);
    accessoryList.push(this);
    this.request("get", "", null, function(obj) {
      if (!obj) {
        return callback(accessoryList);
      }
      for (let id in obj.lights) {
        if (this.platform.config.lights || obj.lights[id].manufacturername !== "Philips") {
	  this.lights[id] = new HueLight(this, id, obj.lights[id]);
          accessoryList.push(this.lights[id]);
        }
      }
      for (let id in obj.groups) {
        if (this.platform.config.groups && obj.groups[id].type !== "Room") {
          this.groups[id] = new HueLight(this, id, obj.groups[id], "group");
          accessoryList.push(this.groups[id]);
        }
      }
      if (this.platform.config.sensors) {
        for (let id in obj.sensors) {
          this.sensors[id] = new HueSensor(this, id, obj.sensors[id]);
          accessoryList.push(this.sensors[id]);
        }
      }
      if (this.platform.config.schedules) {
        for (let id in obj.schedules) {
          this.schedules[id] = new HueSchedule(this, id, obj.schedules[id]);
          accessoryList.push(this.schedules[id]);
        }
      }
      this.log.debug("%s: found %d accessories", this.name, accessoryList.length);
      return callback(accessoryList);
    }.bind(this));
  }.bind(this));
}

// ===== Heartbeat =======================================================================

HueBridge.prototype.heartbeat = function() {
  this.request("get", "", null, function(obj) {
    if (obj) {
      for (let id in this.sensors) {
        let a = this.sensors[id];
        let o = obj.sensors[id];
        if (o) {
	  a.heartbeat(o);
        }
      }
      for (let id in this.groups) {
        let a = this.groups[id];
        let o = obj.groups[id];
        if (o) {
	  a.heartbeat(o);
        }
      }
      for (let id in this.lights) {
        let a = this.lights[id];
        let o = obj.lights[id];
        if (o) {
	  a.heartbeat(o);
        }
      }
      for (let id in this.schedules) {
        let a = this.schedules[id];
        let o = obj.schedules[id];
        if (o) {
          a.heartbeat(o);
        }
      }
    }
  }.bind(this));
}

// ===== Homekit Events ==================================================================

HueBridge.prototype.identify = function(callback) {
  this.log.info("%s: identify", this.name);
  return callback();
}

// ===== Bridge Communication ============================================================

// Send request to Philips Hue bridge.
HueBridge.prototype.request = function(method, resource, body, callback) {
  var requestObj = {
    method: method,
    url: this.url + resource,
    timeout: this.platform.config.timeout
  };
  var requestString = method + " " + resource;
  if (body) {
    requestObj.body = body;
    requestString += " '" + body + "'";
  }
  this.log.debug("%s: hue bridge request: %s", this.name, requestString);
  request(requestObj, function(err, response, responseBody) {
    if (err) {
      this.log.error("%s: hue bridge communication error %s", this.name, err);
      return callback(null);
    }
    if (response.statusCode != 200) {
      this.log.error("%s: hue bridge status %s", this.name, response.statusCode);
      return callback(null);
    }
    // this.log.debug("hue bridge response: '%s'", responseBody);
    var obj;
    try {
      obj = JSON.parse(responseBody);
    } catch(e) {
      this.log.error("%s: hue bridge returned invalid json (%s)", this.name, e);
      return callback(null);
    }
    if (util.isArray(obj)) {
      var errors = false;
      for (let id in obj) { 
	let e = obj[id].error;
	if (e) {
	  errors = true;
	  this.log.error("%s: hue bridge error %d: %s", this.name, e.type, e.description);
	}
	if (errors) {
	  return callback(null);
	}
      }
    }
    return callback(obj);
  }.bind(this));
}