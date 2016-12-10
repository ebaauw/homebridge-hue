// homebridge-hue/lib/HuePlatform.js
// (C) 2016, Erik Baauw
//
// Homebridge plugin for Philips Hue.
//
// HuePlatform provides the platform for support Philips Hue bridges and connected
// accessories.  The platform provides discovery of bridges and setting up a heartbeat
// to poll the bridges.
//
// Todo:
// - Bridge discovery using local UPnP.
// - Dynamic homebridge accessories.
// - Store user (bridge password) in context of homebridge accessory for bridge.

"use strict";

const request = require("request");
const util = require("util");

const HueBridgeModule = require("./HueBridge");
const HueBridge = HueBridgeModule.HueBridge;
const packageConfig = require("../package.json");

module.exports = {
  HuePlatform: HuePlatform,
  setHomebridge: setHomebridge
};

// ===== Homebridge ======================================================================

let Accessory;
let Service;
let Characteristic;
let homebridgeVersion;

function setHomebridge(homebridge) {
  HueBridgeModule.setHomebridge(homebridge);
  Accessory = homebridge.platformAccessory;
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
  homebridgeVersion = homebridge.version;

  // Custom homekit characteristic for colour temperature in Kelvin.
  Characteristic.ColorTemperature = function() {
    Characteristic.call(this, 'Color Temperature', '04200041-0000-1000-8000-0026BB765291');
    this.setProps({
      format: Characteristic.Formats.INT,
      minValue: 2000,
      maxValue: 6540,
      stepValue: 20,
      perms: [Characteristic.Perms.READ, Characteristic.Perms.NOTIFY,
      	      Characteristic.Perms.WRITE]
    });
    this.value = this.getDefaultValue();
  };
  util.inherits(Characteristic.ColorTemperature, Characteristic);

  // Custom homekit characteristic for lastupdated.
  Characteristic.HueSensorLastUpdated = function() {
    Characteristic.call(this, 'Last Updated', '04200021-0000-1000-8000-0026BB765291');
    this.setProps({
      format: Characteristic.Formats.STRING,
      perms: [Characteristic.Perms.READ, Characteristic.Perms.NOTIFY]
    });
    this.value = this.getDefaultValue();
  };
  util.inherits(Characteristic.HueSensorLastUpdated, Characteristic);
}

// ===== HuePlatform =====================================================================

function HuePlatform(log, config, api) {
  this.log = log;
  this.api = api;

  this.name = config.name;
  this.host = config.host;
  this.config = {
    heartrate: 1000 * (config.heartrate || 5),
    timeout: 1000 * (config.timeout || 5),
    users: config.users || {},
    lights: config.lights || false,
    alllights: config.alllights || false,
    groups: config.groups || false,
    group0: config.group0 === undefined ? true : config.groups0,
    sensors: config.sensors || false,
    schedules: config.schedules || false,
    rules: config.rules || false
  };
  this.bridges = [];
  this.log.info("%s v%s, node %s, homebridge v%s", packageConfig.name,
                packageConfig.version, process.version, homebridgeVersion);
}

HuePlatform.prototype.findBridges = function(callback) {
  if (this.host) {
    return callback([{internalipaddress: this.host}]);
  }
  this.log.debug("contacting meethue portal");
  const requestObj = {
    method: "GET",
    url: "https://www.meethue.com/api/nupnp",
    timeout: this.config.timeout,
    json: true
  };
  request(requestObj, function(err, response, responseBody) {
    if (err) {
      this.log.error("meethue portal communication error %s", err);
      return callback(null);
    }
    if (response.statusCode != 200) {
      this.log.error("meethue portal status %s", response.statusCode);
      return callback(null);
    }
    return callback(responseBody);
  }.bind(this));
};

HuePlatform.prototype.accessories = function(callback) {
  let accessoryList = [];
  let promises = [];
  this.findBridges(function(json) {
    if (json) {
      for (const obj of json) {
        this.log.debug("probing bridge at %s", obj.internalipaddress);
        const bridge = new HueBridge(this, obj.internalipaddress);
        this.bridges.push(bridge);
        promises.push(bridge.accessories());
      }
      Promise.all(promises)
      .then(function (lists) {
        for (const list of lists) {
          for (const a of list) {
            accessoryList.push(a);
          }
        }
        if (accessoryList.length > 0) {
          // Setup heartbeat.
          setInterval(function() {
            for (const bridge of this.bridges) {
              bridge.heartbeat();
            }
          }.bind(this), this.config.heartrate);
        }
        while (accessoryList.length > 99) {
          const a = accessoryList.pop();
          this.log.error("too many accessories, ignoring %s %s", a.type, a.name);
        }
        return callback(accessoryList);
      }.bind(this))
      .catch(function(err) {
        this.log.error(err.message);
      }.bind(this));
    }
  }.bind(this));
};
