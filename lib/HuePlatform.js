// homebridge-hue/lib/HuePlatform.js
// (C) 2016-2017, Erik Baauw
//
// Homebridge plugin for Philips Hue.
//
// HuePlatform provides the platform for support Philips Hue bridges and
// connected devices.  The platform provides discovery of bridges and setting
// up a heartbeat to poll the bridges.
//
// Todo:
// - Bridge discovery using local UPnP.
// - Dynamic homebridge accessories.
// - Store user (bridge password) in context of homebridge accessory for bridge.

'use strict';

const request = require('request');
const util = require('util');

const HueBridgeModule = require('./HueBridge');
const HueBridge = HueBridgeModule.HueBridge;
const packageConfig = require('../package.json');

module.exports = {
  HuePlatform: HuePlatform,
  setHomebridge: setHomebridge
};

function toIntBetween(value, minValue, maxValue, defaultValue) {
  const n = Number(value);
  if (isNaN(n) || n !== Math.floor(n) || n < minValue || n > maxValue) {
    return defaultValue;
  }
  return n;
}

// ===== Homebridge ============================================================

let Accessory;
let Service;
let Characteristic;
let homebridgeVersion;

function setHomebridge(homebridge) {
  Accessory = homebridge.platformAccessory;
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
  homebridgeVersion = homebridge.version;

  Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS = 0;
  Characteristic.ProgrammableSwitchEvent.DOUBLE_PRESS = 1;
  Characteristic.ProgrammableSwitchEvent.LONG_PRESS = 2;

  Characteristic.Resource = function() {
    Characteristic.call(this, 'Resource', Characteristic.Resource.UUID);
    this.setProps({
      format: Characteristic.Formats.STRING,
      perms: [Characteristic.Perms.READ]
    });
    this.value = this.getDefaultValue();
  };
  util.inherits(Characteristic.Resource, Characteristic);
  Characteristic.Resource.UUID = '00000021-0000-1000-8000-656261617577';

  Characteristic.Enabled = function() {
    Characteristic.call(this, 'Enabled', Characteristic.Enabled.UUID);
    this.setProps({
      format: Characteristic.Formats.BOOL,
      perms: [Characteristic.Perms.READ, Characteristic.Perms.NOTIFY,
      	      Characteristic.Perms.WRITE]
    });
    this.value = this.getDefaultValue();
  };
  util.inherits(Characteristic.Enabled, Characteristic);
  Characteristic.Enabled.UUID = '00000022-0000-1000-8000-656261617577';

  Characteristic.LastUpdated = function() {
    Characteristic.call(this, 'Last Updated', Characteristic.LastUpdated.UUID);
    this.setProps({
      format: Characteristic.Formats.STRING,
      perms: [Characteristic.Perms.READ, Characteristic.Perms.NOTIFY]
    });
    this.value = this.getDefaultValue();
  };
  util.inherits(Characteristic.LastUpdated, Characteristic);
  Characteristic.LastUpdated.UUID = '00000023-0000-1000-8000-656261617577';

  Characteristic.Heartrate = function() {
    Characteristic.call(this, 'Heartrate', Characteristic.Heartrate.UUID);
    this.setProps({
      format: Characteristic.Formats.INT,
      unit: Characteristic.Units.SECONDS,
      minValue: 1,
      maxValue: 30,
      stepValue: 1,
      perms: [Characteristic.Perms.READ, Characteristic.Perms.NOTIFY,
              Characteristic.Perms.WRITE]
    });
    this.value = this.getDefaultValue();
  };
  util.inherits(Characteristic.Heartrate, Characteristic);
  Characteristic.Heartrate.UUID = '00000024-0000-1000-8000-656261617577';

  Characteristic.Dark = function() {
    Characteristic.call(this, 'Dark', Characteristic.Dark.UUID);
    this.setProps({
      format: Characteristic.Formats.BOOL,
      perms: [Characteristic.Perms.READ, Characteristic.Perms.NOTIFY]
    });
    this.value = this.getDefaultValue();
  };
  util.inherits(Characteristic.Dark, Characteristic);
  Characteristic.Dark.UUID = '00000025-0000-1000-8000-656261617577';

  Characteristic.Daylight = function() {
    Characteristic.call(this, 'Daylight', Characteristic.Daylight.UUID);
    this.setProps({
      format: Characteristic.Formats.BOOL,
      perms: [Characteristic.Perms.READ, Characteristic.Perms.NOTIFY]
    });
    this.value = this.getDefaultValue();
  };
  util.inherits(Characteristic.Daylight, Characteristic);
  Characteristic.Daylight.UUID = '00000026-0000-1000-8000-656261617577';

  Characteristic.Status = function() {
    Characteristic.call(this, 'Status', Characteristic.Status.UUID);
    this.setProps({
      minValue: 0,
      maxValue: 255,
      minStep: 1,
      format: Characteristic.Formats.INT,
      perms: [Characteristic.Perms.READ, Characteristic.Perms.NOTIFY,
              Characteristic.Perms.WRITE]
    });
    this.value = this.getDefaultValue();
  };
  util.inherits(Characteristic.Status, Characteristic);
  Characteristic.Status.UUID = '00000027-0000-1000-8000-656261617577';

  Characteristic.AnyOn = function() {
    Characteristic.call(this, 'Any On', Characteristic.AnyOn.UUID);
    this.setProps({
      format: Characteristic.Formats.BOOL,
      perms: [Characteristic.Perms.READ, Characteristic.Perms.NOTIFY,
              Characteristic.Perms.WRITE]
    });
    this.value = this.getDefaultValue();
  };
  util.inherits(Characteristic.AnyOn, Characteristic);
  Characteristic.AnyOn.UUID = '00000028-0000-1000-8000-656261617577';

  Characteristic.LastTriggered = function() {
    Characteristic.call(
      this, 'Last Triggered', Characteristic.LastTriggered.UUID
    );
    this.setProps({
      format: Characteristic.Formats.INT,
      perms: [Characteristic.Perms.READ, Characteristic.Perms.NOTIFY]
    });
    this.value = this.getDefaultValue();
  };
  util.inherits(Characteristic.LastTriggered, Characteristic);
  Characteristic.LastTriggered.UUID = '00000029-0000-1000-8000-656261617577';

  Characteristic.TimesTriggered = function() {
    Characteristic.call(
      this, 'Times Triggered', Characteristic.TimesTriggered.UUID
    );
    this.setProps({
      format: Characteristic.Formats.INT,
      perms: [Characteristic.Perms.READ, Characteristic.Perms.NOTIFY]
    });
    this.value = this.getDefaultValue();
  };
  util.inherits(Characteristic.TimesTriggered, Characteristic);
  Characteristic.TimesTriggered.UUID = '0000002A-0000-1000-8000-656261617577';

  // Custome HomeKit service for Hue bridge resource.
  Service.Resource = function(displayName, subtype) {
    Service.call(this, displayName, Service.Resource.UUID, subtype);
    this.addCharacteristic(Characteristic.Enabled);
    this.addOptionalCharacteristic(Characteristic.Resource);
    this.addOptionalCharacteristic(Characteristic.LastTriggered);
    this.addOptionalCharacteristic(Characteristic.TimesTriggered);
  };
  util.inherits(Service.Resource, Service);
  Service.Resource.UUID = '00000011-0000-1000-8000-656261617577';

  // Custome HomeKit service for heartbeat.
  Service.Heartbeat = function(displayName, subtype) {
    Service.call(this, displayName, Service.Heartbeat.UUID, subtype);
    this.addCharacteristic(Characteristic.Heartrate);
    this.addCharacteristic(Characteristic.LastUpdated);
  };
  util.inherits(Service.Heartbeat, Service);
  Service.Heartbeat.UUID = '00000012-0000-1000-8000-656261617577';

  // Custom HomeKit service for a CLIPGenericStatus sensor.
  Service.Status = function(displayName, subtype) {
    Service.call(this, displayName, Service.Status.UUID, subtype);
    this.addCharacteristic(Characteristic.Status);
  };
  util.inherits(Service.Status, Service);
  Service.Status.UUID = '00000013-0000-1000-8000-656261617577';

  // Custom homekit characteristic for Colour Temperature in Kelvin.
  // Source: as exposed by Nanoleaf and recognised by Elgato's Eve.
  Characteristic.ColorTemperature = function() {
    Characteristic.call(
      this, 'Color Temperature', 'A18E5901-CFA1-4D37-A10F-0071CEEEEEBD'
    );
    this.setProps({
      format: Characteristic.Formats.INT,
      // unit: 'kelvin',
      minValue: 2000,
      maxValue: 6536,
      stepValue: 1,
      perms: [Characteristic.Perms.READ, Characteristic.Perms.NOTIFY,
      	      Characteristic.Perms.WRITE]
    });
    this.value = this.getDefaultValue();
  };
  util.inherits(Characteristic.ColorTemperature, Characteristic);

  // Custom homekit characteristic for Color Temperature in Mired.
  // Source: as exposed by the Philips Hue bridge v2.
  Characteristic.CT = function() {
    Characteristic.call(
      this, 'Color Temperature', 'E887EF67-509A-552D-A138-3DA215050F46'
    );
    this.setProps({
      format: Characteristic.Formats.INT,
      // unit: 'mired',
      minValue: 153,
      maxValue: 500,
      stepValue: 1,
      perms: [Characteristic.Perms.READ, Characteristic.Perms.NOTIFY,
      	      Characteristic.Perms.WRITE]
    });
    this.value = this.getDefaultValue();
  };
  util.inherits(Characteristic.CT, Characteristic);

  // Custom HomeKit characteristic for Unique ID.
  // Source: as exposed by the Philips Hue bridge.  This characteristic is used
  // by the Hue app to select the accessories when syncing Hue bridge Room
  // groups to HomeKit rooms.
  Characteristic.UniqueID = function() {
    Characteristic.call(
      this, 'Unique ID', 'D8B76298-42E7-5FFD-B1D6-1782D9A1F936'
    );
    this.setProps({
      format: Characteristic.Formats.STRING,
      perms: [Characteristic.Perms.READ]
    });
    this.value = this.getDefaultValue();
  };
  util.inherits(Characteristic.UniqueID, Characteristic);

  HueBridgeModule.setHomebridge(homebridge);
}

// ===== HuePlatform ===========================================================

function HuePlatform(log, config, api) {
  this.log = log;
  this.api = api;
  this.config = {
    hosts: [],
    users: {},
    sensors: false,
    excludeSensorTypes: {},
    lowBattery: 25,
    lights: false,
    philipsLights: false,
    ct: false,
    groups: false,
    group0: false,
    rooms: false,
    schedules: false,
    rules: false,
    heartrate: 5,
    waitTimeUpdate: 50,
    timeout: 5000,
    waitTimeResend: 20,
  };
  for (const key in config) {
    const value = config[key];
    switch (key.toLowerCase()) {
      case 'platform':
        break;
      case 'name':
        this.name = value;
        break;
      case 'host':
      case 'hosts':
        if (Array.isArray(value)) {
          for (const host of value) {
            if (host !== "") {
              this.config.hosts.push(host);
            }
          }
        } else if (value !== "") {
          this.config.hosts.push(value);
        }
        break;
      case 'users':
        this.config.users = value;
        break;
      case 'sensors':
        this.config.sensors = value ? true : false;
        break;
      case 'clipsensors':
        this.log.error(
          'config.json: %s: warning: key has been deprecated', key
        );
        this.config.excludeSensorTypes.CLIP = true;
        this.config.excludeSensorTypes.Geofence = true;
        break;
      case 'excludesensortypes':
        if (Array.isArray(value)) {
          for (const type of value) {
            this.config.excludeSensorTypes[type] = true;
          }
        } else {
          this.log.error(
            'config.json: %s: warning: ignoring non-array value', key
          );
        }
        break;
      case 'lowbattery':
        this.config.lowBattery = this.toIntBetween(
          value, 0, 100, this.config.waittime
        );
        break;
      case 'lights':
        this.config.lights = value ? true : false;
        break;
      case 'alllights':
        this.log.error(
          'config.json: %s: warning: key has been deprecated', key
        );
        /* falls through */
      case 'philipslights':
        this.config.philipsLights = value ? true : false;
        break;
      case 'ct':
        this.config.ct = value ? true : false;
        break;
      case 'groups':
        this.config.groups = value ? true : false;
        break;
      case 'group0':
        this.config.group0 = value ? true : false;
        break;
      case 'rooms':
        this.config.rooms = value ? true : false;
        break;
      case 'schedules':
        this.config.schedules = value ? true : false;
        break;
      case 'rules':
        this.config.rules = value ? true : false;
        break;
      case 'heartrate':
        this.config.heartrate = this.toIntBetween(
          value, 1, 30, this.config.heartrate
        );
        break;
      case 'waittimeupdate':
        this.config.waitTimeUpdate = this.toIntBetween(
          value, 20, 500, this.config.waittime
        );
        break;
      case 'timeout':
        this.config.timeout = 1000 * this.toIntBetween(
          value, 5, 30, this.config.timeout
        );
        break;
      case 'parallelrequests':
        this.config.parallelRequests = this.toIntBetween(
          value, 1, 30, this.config.timeout
        );
        break;
      case 'waittimeresend':
        this.config.waitTimeResend = this.toIntBetween(
          value, 100, 1000, this.config.waittime
        );
        break;
      default:
        this.log.error('config.json: warning: %s: ignoring unknown key', key);
    }
  }
  this.bridges = [];
  this.log.info(
    '%s v%s, node %s, homebridge v%s', packageConfig.name,
    packageConfig.version, process.version, homebridgeVersion
  );
}

HuePlatform.prototype.toIntBetween = function(
  value, minValue, maxValue, defaultValue
) {
  const n = Number(value);
  if (isNaN(n) || n !== Math.floor(n) || n < minValue || n > maxValue) {
    return defaultValue;
  }
  return n;
};

HuePlatform.prototype.findBridges = function(callback) {
  if (this.config.hosts.length > 0) {
    const response = [];
    for (const host of this.config.hosts) {
      response.push({internalipaddress: host});
    }
    return callback(response);
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
      this.log.error("meethue portal: communication error %s", err);
      return callback(null);
    }
    if (response.statusCode != 200) {
      this.log.error("meethue portal: status %s", response.statusCode);
      return callback(null);
    }
    if (responseBody.length === 0) {
      this.log.error("meethue portal: no bridges registered");
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
          let beat = -1;
          setInterval(function() {
            beat += 1;
            beat %= 7 * 24 * 3600;
            for (const bridge of this.bridges) {
              bridge.heartbeat(beat);
            }
          }.bind(this), 1000);
        }
        while (accessoryList.length > 99) {
          const a = accessoryList.pop();
          this.log.error("too many accessories, ignoring %s", a.name);
        }
        return callback(accessoryList);
      }.bind(this))
      .catch(function(err) {
        if (err.message) {
          this.log.error(err.message);
        }
      }.bind(this));
    }
  }.bind(this));
};
