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
// - Dynamic homebridge accessories.
// - Store user (bridge password) in context of homebridge accessory for bridge.

'use strict';

const deferred = require('deferred');
const dgram = require('dgram');
const request = require('request');
const util = require('util');

const HueBridgeModule = require('./HueBridge');
const HueBridge = HueBridgeModule.HueBridge;
const packageConfig = require('../package.json');

module.exports = {
  HuePlatform: HuePlatform,
  setHomebridge: setHomebridge
};

// Parse a UPnP message into an object
function upnpParseMessage(message) {
  const obj = {};
  const lines = message.toString().split('\r\n');
  if (lines && lines[0]) {
    obj.status = lines[0];
    for (const line in lines) {
      const fields = lines[line].split(': ');
      if (fields.length === 2) {
        obj[fields[0].toLowerCase()] = fields[1];
      }
    }
  }
  return obj;
}

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
      format: Characteristic.Formats.STRING,
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
    this.addOptionalCharacteristic(Characteristic.LastTriggered);
    this.addOptionalCharacteristic(Characteristic.TimesTriggered);
    this.addOptionalCharacteristic(Characteristic.StatusActive);
    this.addOptionalCharacteristic(Characteristic.Resource);
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

  // Custom HomeKit service for a ZGPSwitch or ZLLSwitch sensor.
  Service.HueSwitch = function(displayName, subtype) {
    Service.call(this, displayName, Service.HueSwitch.UUID, subtype);
    this.addCharacteristic(Characteristic.ProgrammableSwitchOutputState);
  };
  util.inherits(Service.HueSwitch, Service);
  Service.HueSwitch.UUID = '00000014-0000-1000-8000-656261617577';

  // Custom homekit characteristic for Colour Temperature in Kelvin.
  // Source: as exposed by Nanoleaf and recognised by Elgato's Eve.
  Characteristic.ColorTemperature = function() {
    Characteristic.call(
      this, 'Color Temperature', Characteristic.ColorTemperature.UUID
    );
    this.setProps({
      format: Characteristic.Formats.INT,
      unit: 'K',
      minValue: 2000,
      maxValue: 6536,
      stepValue: 1,
      perms: [Characteristic.Perms.READ, Characteristic.Perms.NOTIFY,
      	      Characteristic.Perms.WRITE]
    });
    this.value = this.getDefaultValue();
  };
  util.inherits(Characteristic.ColorTemperature, Characteristic);
  Characteristic.ColorTemperature.UUID = 'A18E5901-CFA1-4D37-A10F-0071CEEEEEBD';

  // Custom homekit characteristic for Sensitivity.
  // Source: Elgato's Eve Motion Sensor.
  Characteristic.Sensitivity = function() {
    Characteristic.call(
      this, 'Sensitivity', Characteristic.Sensitivity.UUID
    );
    this.setProps({
      format: Characteristic.Formats.UINT8,
      minValue: 0,
      maxValue: 2,
      stepValue: 1,
      perms: [Characteristic.Perms.READ, Characteristic.Perms.NOTIFY,
      	      Characteristic.Perms.WRITE]
    });
    this.value = this.getDefaultValue();
  };
  util.inherits(Characteristic.Sensitivity, Characteristic);
  // Characteristic.Sensitivity.UUID = 'E863F120-079E-48FF-8F27-9C2605A29F52';
  Characteristic.Sensitivity.UUID = '0000002B-0000-1000-8000-656261617577';


  // Custom homekit characteristic for Duration in seconds.
  // Source: Elgato's Eve Motion Sensor.
  Characteristic.Duration = function() {
    Characteristic.call(
      this, 'Duration', Characteristic.Duration.UUID
    );
    this.setProps({
      format: Characteristic.Formats.UINT16,
      // unit: Characteristic.Units.SECONDS,
      unit: 'm',
      minValue: 0,
      maxValue: 120,
      stepValue: 1,
      perms: [Characteristic.Perms.READ, Characteristic.Perms.NOTIFY,
      	      Characteristic.Perms.WRITE]
    });
    this.value = this.getDefaultValue();
  };
  util.inherits(Characteristic.Duration, Characteristic);
  // Characteristic.Duration.UUID = 'E863F12D-079E-48FF-8F27-9C2605A29F52';
  Characteristic.Duration.UUID = '0000002C-0000-1000-8000-656261617577';

  // Custom homekit characteristic for Color Temperature in Mired.
  // Source: as exposed by the Philips Hue bridge v2.
  Characteristic.CT = function() {
    Characteristic.call(
      this, 'Color Temperature', Characteristic.CT.UUID
    );
    this.setProps({
      format: Characteristic.Formats.INT,
      unit: 'mired',
      minValue: 153,
      maxValue: 500,
      stepValue: 1,
      perms: [Characteristic.Perms.READ, Characteristic.Perms.NOTIFY,
      	      Characteristic.Perms.WRITE]
    });
    this.value = this.getDefaultValue();
  };
  util.inherits(Characteristic.CT, Characteristic);
  Characteristic.CT.UUID = 'E887EF67-509A-552D-A138-3DA215050F46';

  // Custom HomeKit characteristic for Unique ID.
  // Source: as exposed by the Philips Hue bridge.  This characteristic is used
  // by the Hue app to select the accessories when syncing Hue bridge Room
  // groups to HomeKit rooms.
  Characteristic.UniqueID = function() {
    Characteristic.call(
      this, 'Unique ID', Characteristic.UniqueID.UUID
    );
    this.setProps({
      format: Characteristic.Formats.STRING,
      perms: [Characteristic.Perms.READ]
    });
    this.value = this.getDefaultValue();
  };
  util.inherits(Characteristic.UniqueID, Characteristic);
  Characteristic.UniqueID.UUID = 'D8B76298-42E7-5FFD-B1D6-1782D9A1F936';

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
    waitTimeUpdate: 20,
    timeout: 5,
    waitTimeResend: 300,
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
            if (host !== '') {
              this.config.hosts.push(host);
            }
          }
        } else if (value !== '') {
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
        this.config.lowBattery = toIntBetween(
          value, 0, 100, this.config.lowBattery
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
        this.config.heartrate = toIntBetween(
          value, 1, 30, this.config.heartrate
        );
        break;
      case 'waittimeupdate':
        this.config.waitTimeUpdate = toIntBetween(
          value, 0, 500, this.config.waitTimeUpdate
        );
        break;
      case 'timeout':
        this.config.timeout = toIntBetween(
          value, 5, 30, this.config.timeout
        );
        break;
      case 'parallelrequests':
        this.config.parallelRequests = toIntBetween(
          value, 1, 30, this.config.parallelRequests
        );
        break;
      case 'waittimeresend':
        this.config.waitTimeResend = toIntBetween(
          value, 100, 1000, this.config.waitTimeResend
        );
        break;
        case 'waittimeswitch':
          this.config.waitTimeSwitch = toIntBetween(
            value, 20, 1000, this.config.waitTimeSwitch
          );
          break;
      default:
        this.log.error('config.json: warning: %s: ignoring unknown key', key);
    }
  }
  this.bridgeMap = {};
  this.bridges = [];
  this.log.info(
    '%s v%s, node %s, homebridge api v%s', packageConfig.name,
    packageConfig.version, process.version, homebridgeVersion
  );
}

HuePlatform.prototype.accessories = function(callback) {
  let accessoryList = [];
  this.findBridges().map(function(ipaddress) {
    const bridge = new HueBridge(this, ipaddress);
    this.bridges.push(bridge);
    return bridge.accessories();
  }.bind(this)).map(function(list) {
    for (const a of list) {
      accessoryList.push(a);
    }
  }.bind(this)).then(function () {
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
      this.log.error('too many accessories, ignoring %s', a.name);
    }
    callback(accessoryList);
  }.bind(this))
  .catch(function(err) {
    if (err.message) {
      this.log.error(err.message);
    }
    callback(null);
  }.bind(this));
};

// Return promise to list of ipaddresses of found Hue bridges.
HuePlatform.prototype.findBridges = function() {
  if (this.config.hosts.length > 0) {
    const list = [];
    for (const host of this.config.hosts) {
      list.push(host);
    }
    return deferred(list);
  }
  const d = deferred();
  deferred(this.nupnpSearch(), this.upnpSearch()).then(function(lists) {
    const map = {};
    for (const list of lists) {
      for (const ip of list) {
        map[ip] = true;
      }
    }
    d.resolve(Object.keys(map));
  }.bind(this));
  return d.promise;
};

// Get Hue bridges from meethue portal.
HuePlatform.prototype.nupnpSearch = function() {
  const d = deferred();
  const list = [];
  const requestObj = {
    method: 'GET',
    url: 'https://www.meethue.com/api/nupnp',
    timeout: 1000 * this.config.timeout,
    json: true
  };
  this.log.debug('meethue portal: get /api/nupnp');
  request(requestObj, function(err, response, responseBody) {
    if (err) {
      this.log.error('meethue portal: communication error %s', err.code);
      return d.reject(err.code);
    }
    if (response.statusCode != 200) {
      this.log.error('meethue portal: status %s', response.statusCode);
      return d.reject(response.statusCode);
    }
    if (responseBody.length === 0) {
      this.log.info('meethue portal: no bridges registered');
    } else {
      for (const bridge of responseBody) {
        this.log.debug(
          'meethue portal: found bridge %s at %s',
          bridge.id.toUpperCase(), bridge.internalipaddress
        );
        list.push(bridge.internalipaddress);
      }
    }
    return d.resolve(list);
  }.bind(this));
  return d.promise;
};

// Do a UPnP search for Hue bridges.
HuePlatform.prototype.upnpSearch = function() {
  const d = deferred();
  const list = [];
  const map = {};
  const upnp = {
    ipaddress: '239.255.255.250',
    port: 1900
  };
  const socket = dgram.createSocket('udp4');
  const request = new Buffer([
    'M-SEARCH * HTTP/1.1',
    'HOST: ' + upnp.ipaddress + ':' + upnp.port,
    'MAN: "ssdp:discover"',
    'MX: 5',
    'ST: upnp:rootdevice',
    ''
  ].join('\r\n'));
  socket.on('message', function(message, rinfo) {
    const response = upnpParseMessage(message);
    if (
      response.status === 'HTTP/1.1 200 OK' &&
      response.st && response.st === 'upnp:rootdevice' &&
      response['hue-bridgeid']
    ) {
      const ipaddress = rinfo.address;
      const bridgeid = response['hue-bridgeid'];
      if (!map[ipaddress]) {
        this.log.debug(
          'upnp search: found bridge %s at %s', bridgeid, ipaddress
        );
        map[ipaddress] = bridgeid;
        list.push(ipaddress);
      }
    }
  }.bind(this));
  socket.on('error', function(err) {
    this.log.error('upnp search: error %s', err.code);
    socket.close();
    d.resolve(list);
  }.bind(this));
  socket.on('listening', function() {
    this.log.debug(
      'upnp search: searching at %s:%d for %d seconds',
      upnp.ipaddress, upnp.port, this.config.timeout
    );
    setTimeout(function () {
      socket.close();
      this.log.debug('upnp search: done');
      d.resolve(list);
    }.bind(this), 1000 * this.config.timeout);
  }.bind(this));
  socket.send(
    request, 0, request.length, upnp.port, upnp.ipaddress
  );
  return d.promise;
};
