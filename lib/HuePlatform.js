// homebridge-hue/lib/HuePlatform.js
// Copyright © 2016-2018 Erik Baauw. All rights reserved.
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
const fs = require('fs');
const request = require('request');
const semver = require('semver');
const util = require('util');
const zlib = require('zlib');

const HueBridgeModule = require('./HueBridge');
const HueBridge = HueBridgeModule.HueBridge;
const packageJson = require('../package.json');

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
    for (const line of lines) {
      const fields = line.split(': ');
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

function minVersion(range) {
  let s = range.split(' ')[0];
  while (s) {
    if (semver.valid(s)) {
      break;
    }
    s = s.substring(1);
  }
  return s ? s : undefined;
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
  homebridgeVersion = homebridge.serverVersion;

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
      format: Characteristic.Formats.UINT8,
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
      format: Characteristic.Formats.INT,
      minValue: -127,
      maxValue: 127,
      // Workaround for Eve bug.
      // stepValue: 1,
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

  Characteristic.Sensitivity = function() {
    Characteristic.call(
      this, 'Sensitivity', Characteristic.Sensitivity.UUID
    );
    this.setProps({
      format: Characteristic.Formats.UINT8,
      minValue: 0,
      maxValue: 127,
      stepValue: 1,
      perms: [Characteristic.Perms.READ, Characteristic.Perms.NOTIFY,
      	      Characteristic.Perms.WRITE]
    });
    this.value = this.getDefaultValue();
  };
  util.inherits(Characteristic.Sensitivity, Characteristic);
  Characteristic.Sensitivity.UUID = '0000002B-0000-1000-8000-656261617577';

  Characteristic.Duration = function() {
    Characteristic.call(
      this, 'Duration', Characteristic.Duration.UUID
    );
    this.setProps({
      format: Characteristic.Formats.UINT16,
      unit: Characteristic.Units.SECONDS,
      minValue: 0,
      maxValue: 7200,
      stepValue: 1,
      perms: [Characteristic.Perms.READ, Characteristic.Perms.NOTIFY,
      	      Characteristic.Perms.WRITE]
    });
    this.value = this.getDefaultValue();
  };
  util.inherits(Characteristic.Duration, Characteristic);
  Characteristic.Duration.UUID = '0000002C-0000-1000-8000-656261617577';

  Characteristic.Link = function() {
    Characteristic.call(
      this, 'Link', Characteristic.Link.UUID
    );
    this.setProps({
      format: Characteristic.Formats.BOOL,
      perms: [Characteristic.Perms.READ, Characteristic.Perms.NOTIFY,
              Characteristic.Perms.WRITE]
    });
    this.value = this.getDefaultValue();
  };
  util.inherits(Characteristic.Link, Characteristic);
  Characteristic.Link.UUID = '0000002D-0000-1000-8000-656261617577';

  Characteristic.Touchlink = function() {
    Characteristic.call(
      this, 'Touchlink', Characteristic.Touchlink.UUID
    );
    this.setProps({
      format: Characteristic.Formats.BOOL,
      perms: [Characteristic.Perms.READ, Characteristic.Perms.NOTIFY,
              Characteristic.Perms.WRITE]
    });
    this.value = this.getDefaultValue();
  };
  util.inherits(Characteristic.Touchlink, Characteristic);
  Characteristic.Touchlink.UUID = '0000002E-0000-1000-8000-656261617577';

  Characteristic.TransitionTime = function() {
    Characteristic.call(
      this, 'Transition Time', Characteristic.TransitionTime.UUID
    );
    this.setProps({
      format: Characteristic.Formats.FLOAT,
      unit: Characteristic.Units.SECONDS,
      minValue: 0,
      maxValue: 3600,
      stepValue: 0.1,
      perms: [Characteristic.Perms.READ, Characteristic.Perms.NOTIFY,
              Characteristic.Perms.WRITE]
    });
    this.value = this.getDefaultValue();
  };
  util.inherits(Characteristic.TransitionTime, Characteristic);
  Characteristic.TransitionTime.UUID = '0000002F-0000-1000-8000-656261617577';

  // Custom HomeKit service for Hue bridge resource.
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

  // Custom HomeKit service for a Hue bridge.
  Service.HueBridge = function(displayName, subtype) {
    Service.call(this, displayName, Service.HueBridge.UUID, subtype);
    this.addCharacteristic(Characteristic.Heartrate);
    this.addCharacteristic(Characteristic.LastUpdated);
    this.addCharacteristic(Characteristic.TransitionTime);
    this.addOptionalCharacteristic(Characteristic.Link);
    this.addOptionalCharacteristic(Characteristic.Touchlink);
  };
  util.inherits(Service.HueBridge, Service);
  Service.HueBridge.UUID = '00000012-0000-1000-8000-656261617577';

  // Custom HomeKit service for a CLIPGenericStatus sensor.
  Service.Status = function(displayName, subtype) {
    Service.call(this, displayName, Service.Status.UUID, subtype);
    this.addCharacteristic(Characteristic.Status);
  };
  util.inherits(Service.Status, Service);
  Service.Status.UUID = '00000013-0000-1000-8000-656261617577';

  // Custom HomeKit service for an AirPressure sensor.
  Service.AirPressureSensor = function(displayName, subtype) {
    Service.call(this, displayName, Service.AirPressureSensor.UUID, subtype);
    this.addCharacteristic(Characteristic.AirPressure);
  };
  util.inherits(Service.AirPressureSensor, Service);
  Service.AirPressureSensor.UUID = '00000014-0000-1000-8000-656261617577';

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

  // Custom HomeKit characteristic for Air Pressure.
  // Source: as exposed by Eve Weather.
  Characteristic.AirPressure = function () {
    Characteristic.call(
      this, 'Eve AirPressure', Characteristic.AirPressure.UUID
    );
    this.setProps({
      format: Characteristic.Formats.UINT16,
      unit: "hPa",
      maxValue: 1200,
      minValue: 800,
      stepValue: 1,
      perms: [Characteristic.Perms.READ, Characteristic.Perms.NOTIFY]
    });
    this.value = this.getDefaultValue();
  };
  util.inherits(Characteristic.AirPressure, Characteristic);
  Characteristic.AirPressure.UUID = 'E863F10F-079E-48FF-8F27-9C2605A29F52';

  HueBridgeModule.setHomebridge(homebridge);
}

// ===== HuePlatform ===========================================================

function HuePlatform(log, configJson, api) {
  this.log = log;
  this.api = api;
  this.packageJson = packageJson;
  this.configJson = configJson;
  this.config = {
    ct: false,
    excludeSensorTypes: {},
    groups: false,
    group0: false,
    heartrate: 5,
    hosts: [],
    lights: false,
    linkbutton: true,
    lowBattery: 25,
    resource: true,
    rooms: false,
    rules: false,
    schedules: false,
    sensors: false,
    timeout: 5,
    nativeHomeKit: true,
    users: {},
    waitTimeResend: 300,
    waitTimeUpdate: 20,
    wallSwitch: false
  };
  for (const key in configJson) {
    const value = configJson[key];
    switch (key.toLowerCase()) {
      case 'excludesensortypes':
        if (Array.isArray(value)) {
          for (const type of value) {
            this.config.excludeSensorTypes[type] = true;
            switch (type) {
              case 'ZLLPresence':
                this.config.excludeSensorTypes.ZHAPresence = true;
                break;
              case 'ZLLLightLevel':
                this.config.excludeSensorTypes.ZHALightLevel = true;
                this.config.excludeSensorTypes.ZHALight = true;
                break;
              case 'ZLLTemperature':
                this.config.excludeSensorTypes.ZHATemperature = true;
                break;
              case 'ZLLSwitch':
                this.config.excludeSensorTypes.ZHASwitch = true;
                break;
              default:
                break;
            }
          }
        } else {
          this.log.warn(
            'config.json: %s: warning: ignoring non-array value', key
          );
        }
        break;
      case 'groups':
        this.config.groups = value ? true : false;
        break;
      case 'group0':
        this.config.group0 = value ? true : false;
        break;
      case 'heartrate':
        this.config.heartrate = toIntBetween(
          value, 1, 30, this.config.heartrate
        );
        break;
      case 'host':
      case 'hosts':
        if (typeof value === 'string') {
          if (value !== '') {
            this.config.hosts.push(value);
          }
        } else if (Array.isArray(value)) {
          for (const host of value) {
            if (typeof host === 'string' && host !== '') {
              this.config.hosts.push(host);
            }
          }
        } else {
          this.log.warn(
            'config.json: warning: %s: ignoring non-array, non-string value %j',
            key, value
          );
        }
        break;
      case 'lights':
        this.config.lights = value ? true : false;
        break;
      case 'linkbutton':
        this.config.linkbutton = value ? true : false;
        break;
      case 'lowbattery':
        this.config.lowBattery = toIntBetween(
          value, 0, 100, this.config.lowBattery
        );
        break;
      case 'name':
        this.name = value;
        break;
      case 'parallelrequests':
        this.config.parallelRequests = toIntBetween(
          value, 1, 30, this.config.parallelRequests
        );
        break;
      case 'philipslights':
        this.log.warn('config.json: warning: %s: deprecated', key);
        this.config.nativeHomeKit = value ? false : true;
        break;
      case 'platform':
        break;
      case 'resource':
        this.config.resource = value ? true: false;
        break;
      case 'rooms':
        this.config.rooms = value ? true : false;
        break;
      case 'rules':
        this.config.rules = value ? true : false;
        break;
      case 'schedules':
        this.config.schedules = value ? true : false;
        break;
      case 'sensors':
        this.config.sensors = value ? true : false;
        break;
      case 'timeout':
        this.config.timeout = toIntBetween(
          value, 5, 30, this.config.timeout
        );
        break;
      case 'nativehomekit':
        this.config.nativeHomeKit = value ? true : false;
        break;
      case 'users':
        this.config.users = value;
        break;
      case 'waittimeresend':
        this.config.waitTimeResend = toIntBetween(
          value, 100, 1000, this.config.waitTimeResend
        );
        break;
      case 'waittimeupdate':
        this.config.waitTimeUpdate = toIntBetween(
          value, 0, 500, this.config.waitTimeUpdate
        );
        break;
      case 'wallswitch':
        this.config.wallSwitch = value ? true : false;
        break;
      default:
        this.log.warn('config.json: warning: %s: ignoring unknown key', key);
        break;
    }
  }
  this.bridgeMap = {};
  this.bridges = [];
  this.identify();
  const usernames = [];
  for (const bridgeId in this.configJson.users) {
    usernames.push(this.configJson.users[bridgeId]);
  }
  this.log.debug(
    'config.json: %s',
    this.maskUsernames(usernames, this.maskConfigJson(this.configJson))
  );
}

HuePlatform.prototype.accessories = function(callback) {
  let accessoryList = [];
  this.findBridges().map((host) => {
    const bridge = new HueBridge(this, host);
    this.bridges.push(bridge);
    return bridge.accessories();
  }).map((list) => {
    for (const a of list) {
      accessoryList.push(a);
    }
  }).then(() => {
    if (accessoryList.length > 0) {
      // Setup heartbeat.
      let beat = -1;
      setInterval(() => {
        beat += 1;
        beat %= 7 * 24 * 3600;
        for (const bridge of this.bridges) {
          bridge.heartbeat(beat);
        }
      }, 1000);
    }
    while (accessoryList.length > 99) {
      const a = accessoryList.pop();
      this.log.error('too many accessories, ignoring %s', a.name);
    }
    callback(accessoryList);
    this.dump();
  }).catch((err) => {
    this.log.error(err);
    callback(null);
  });
};

// ===== Troubleshooting =======================================================

HuePlatform.prototype.identify = function() {
  this.log.info(
    '%s v%s, node %s, homebridge v%s', packageJson.name,
    packageJson.version, process.version, homebridgeVersion
  );
  if (semver.clean(process.version) !== minVersion(packageJson.engines.node)) {
    this.log.warn(
      'warning: not using recommended node version v%s LTS',
      minVersion(packageJson.engines.node)
    );
  }
  if (homebridgeVersion !== minVersion(packageJson.engines.homebridge)) {
    this.log.warn(
      'warning: not using recommended homebridge version v%s',
      minVersion(packageJson.engines.homebridge)
    );
  }
};

HuePlatform.prototype.dump = function() {
  let usernames = [];
  let obj = {
    versions: {
      node: process.version,
      homebridge: 'v' + homebridgeVersion
    },
    config: this.maskConfigJson(this.configJson),
    bridges: []
  };
  for (const bridgeId in this.configJson.users) {
    usernames.push(this.configJson.users[bridgeId]);
  }
  obj.versions[packageJson.name] = 'v' + packageJson.version;
  for (const bridge of this.bridges) {
    const state = bridge.fullState;
    state.config.ipaddress = this.maskHost(state.config.ipaddress);
    state.config.gateway = this.maskHost(state.config.gateway);
    if (state.config.proxyaddress !== 'none') {
      state.config.proxyaddress = this.maskHost(state.config.proxyaddress);
    }
    obj.bridges.push(state);
    for (const username in state.config.whitelist) {
      usernames.push(username);
    }
  }
  const filename = this.api.user.storagePath() + "/" +
                   packageJson.name + '.json.gz';
  try {
    zlib.gzip(this.maskUsernames(usernames, obj), (err, data) => {
      if (err) {
        this.log.error('cannot create %s: error %s', filename, err.code);
        return;
      }
      fs.writeFile(filename, data, (err) => {
        if (err) {
          this.log.error('cannot create %s: error %s', filename, err.code);
          return;
        }
        this.log.info('masked debug info dumped to %s', filename);
      });
    });
  } catch(err) {
    this.log.error(err);
  }
};

HuePlatform.prototype.maskHost = function(host) {
  const elt = host.split('.');
  return elt.length === 4 && host !== '127.0.0.1' ?
    [elt[0], '***', '***', elt[3]].join('.') : host;
};


HuePlatform.prototype.maskConfigJson = function(configJson) {
  let json = {};
  Object.assign(json, configJson);
  if (typeof configJson.host === 'string') {
    json.host = this.maskHost(configJson.host);
  } else if (Array.isArray(configJson.host)) {
    for (const id in configJson.host) {
      json.host[id] = this.maskHost(configJson.host[id]);
    }
  }
  if (typeof configJson.hosts === 'string') {
    json.hosts = this.maskHost(configJson.hosts);
  } else if (Array.isArray(configJson.hosts)) {
    for (const id in configJson.hosts) {
      json.hosts[id] = this.maskHost(configJson.hosts[id]);
    }
  }
  return json;
};

HuePlatform.prototype.maskUsernames = function(usernames, json) {
  let s = JSON.stringify(json);
  let i = 0;
  for (const username of usernames) {
    i += 1;
    const regexp = RegExp(username, 'g');
    let mask = username.replace(/./g, '*');
    mask = (mask + i).slice(-username.length);
    s = s.replace(regexp, mask);
  }
  return s;
};

// ===== Bridge Discovery ======================================================

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
  deferred(this.nupnpSearch(), this.upnpSearch()).then((lists) => {
    const map = {};
    for (const list of lists) {
      for (const ip of list) {
        map[ip] = true;
      }
    }
    const bridges = Object.keys(map);
    if (bridges.length > 0) {
      d.resolve(bridges);
    } else {
      this.log.info('no bridges found - retrying in 30 seconds');
      setTimeout(() => {
        this.log.info('searching bridges');
        d.resolve(this.findBridges());
      }, 30000);
    }
  }).catch((err) => {
    this.log.error(err);
  });
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
  request(requestObj, (err, response, responseBody) => {
    if (err) {
      this.log.error(
        'meethue portal: communication error %s on %s', err.code,
        requestObj.url.split('api/')[0]
      );
      return d.resolve(list);
    }
    if (response.statusCode != 200) {
      this.log.error('meethue portal: status %s', response.statusCode);
      return d.resolve(list);
    }
    if (responseBody.length === 0) {
      this.log.info('meethue portal: no bridges registered');
    } else {
      for (const bridge of responseBody) {
        this.log.debug(
          'meethue portal: found bridge %s at %s',
          bridge.id.toUpperCase(), this.maskHost(bridge.internalipaddress)
        );
        list.push(bridge.internalipaddress);
      }
    }
    return d.resolve(list);
  });
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
    'MX: ' + this.config.timeout,
    'ST: upnp:rootdevice',
    ''
  ].join('\r\n'));
  socket.on('message', (message, rinfo) => {
    const response = upnpParseMessage(message);
    if (
      response.status === 'HTTP/1.1 200 OK' &&
      response.st && response.st === 'upnp:rootdevice' &&
      (response['hue-bridgeid'] || response['gwid.phoscon.de'])
    ) {
      const ipaddress = rinfo.address;
      const bridgeid = response['hue-bridgeid'] || response['gwid.phoscon.de'];
      if (!map[ipaddress]) {
        this.log.debug(
          'upnp search: found bridge %s at %s', bridgeid,
          this.maskHost(ipaddress)
        );
        map[ipaddress] = bridgeid;
        list.push(ipaddress);
      }
    }
  });
  socket.on('error', (err) => {
    this.log.error('upnp search: error %s', err.code);
    socket.close();
    d.resolve(list);
  });
  socket.on('listening', () => {
    this.log.debug(
      'upnp search: searching at %s:%d for %d seconds',
      upnp.ipaddress, upnp.port, this.config.timeout
    );
    setTimeout(() => {
      socket.close();
      this.log.debug('upnp search: done');
      d.resolve(list);
    }, 1000 * this.config.timeout);
  });
  socket.send(
    request, 0, request.length, upnp.port, upnp.ipaddress
  );
  return d.promise;
};
