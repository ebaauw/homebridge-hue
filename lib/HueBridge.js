// homebridge-hue/lib/HueBridge.js
// Copyright © 2016, 2017 Erik Baauw. All rights reserved.
//
// Homebridge plugin for Philips Hue.
//
// HueBridge provides support for Philips Hue bridges and dresden elektronik
// deCONZ gateways.
//
// Todo:
// - Support rules in separate accessories.

'use strict';

const deferred = require('deferred');
const fs = require('fs');
const os = require('os');
const request = require('request');
const semver = require('semver');
const util = require('util');
const WebSocket = require('ws');

const HueLightModule = require('./HueLight');
const HueSensorModule = require('./HueSensor');
const HueScheduleModule = require('./HueSchedule');
const HueLight = HueLightModule.HueLight;
const HueSensor = HueSensorModule.HueSensor;
const HueSchedule = HueScheduleModule.HueSchedule;

module.exports = {
  setHomebridge: setHomebridge,
  HueBridge: HueBridge
};

// ===== Homebridge ============================================================

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

// ===== HueBridge =============================================================

function HueBridge(platform, host) {
  this.log = platform.log;
  this.platform = platform;
  this.name = host;
  this.ipaddress = host.split(':')[0];
  this.url = 'http://' + host + '/api';
  this.type = 'bridge';
  this.defaultTransitiontime = 0.4;
  this.state = {
    heartrate: this.platform.config.heartrate,
    transitiontime: this.defaultTransitiontime,
    request: 0,
    touchlink: false,
    lights: 0,
    groups: 0,
    group0: 0,
    sensors: 0,
    schedules: 0,
    rules: 0
  };
  this.serviceList = [];
  this.lights = {};
  this.groups = {};
  this.sensors = {};
  this.schedules = {};
  this.rules = {};
}

HueBridge.prototype.getServices = function() {
  this.log.info('%s: %d services', this.name, this.serviceList.length);
  return this.serviceList;
};

HueBridge.prototype.accessories = function() {
  this.accessoryMap = {};
  this.accessoryList = [];
  return this.getConfig()
  .then((obj) => {
    return this.exposeBridge(obj);
  }).then(() => {
    return this.createUser();
  }).then(() => {
    return this.getFullState();
  }).then((state) => {
    return this.exposeResources(state);
  }).catch((err) => {
    if (err.message !== 'unknown bridge') {
      this.log.error(err);
    }
  }).then(() => {
    this.log.info('%s: %d accessories', this.name, this.accessoryList.length);
    return this.accessoryList;
  });
};

HueBridge.prototype.getConfig = function() {
  const d = deferred();

  this._request('get', '/config').then((obj) => {
    d.resolve(obj);
  }).catch((err) => {
    setTimeout(() => {
      d.resolve(this.getConfig());
    }, 15000);
  });
  return d.promise;
};

HueBridge.prototype.exposeBridge = function(obj) {
  this.name = obj.name;
  this.serialNumber = obj.bridgeid;
  // jshint -W106
  this.uuid_base = this.serialNumber;
  // jshint +W106
  this.username = this.platform.config.users[this.serialNumber] || '';
  this.config = {
    parallelRequests: 10,
    linkbutton: this.platform.config.linkbutton,
    nativeHomeKit: this.platform.config.nativeHomeKit,
    touchlinkCmd: 'put',
    touchlinkURI: '/config',
    touchlinkBody: {'touchlink': true}
  };
  const recommendedVersion =
    this.platform.packageJson.engines[obj.modelid];
  switch (obj.modelid) {
    case 'BSB001':                // Philips Hue v1 (round) bridge;
      this.config.parallelRequests = 3;
      this.config.nativeHomeKit = false;
      /* falls through */
    case 'BSB002':                // Philips Hue v2 (square) bridge;
      this.manufacturername = 'Philips';
      this.log.info(
        '%s: %s %s v%s, api v%s', this.name, obj.modelid, this.type,
        obj.swversion, obj.apiversion
      );
      this.version = obj.apiversion;
      if (!semver.satisfies(this.version, recommendedVersion)) {
        this.log.warn(
          '%s: warning: not using recommeneded Hue bridge api version %s',
          this.name, recommendedVersion
        );
      }
      break;
    case 'deCONZ':                // deCONZ rest api
      if (obj.bridgeid === '0000000000000000') {
        this.log.error(
          '%s: gateway not yet initialised - please restart homebridge',
          obj.name
        );
        process.exit(1);
      }
      this.manufacturername = 'dresden elektronik';
      this.type = 'gateway';
      this.config.linkbutton = false;
      this.version = obj.swversion;
      this.config.nativeHomeKit = false;
      this.config.touchlinkCmd = 'post';
      this.config.touchlinkURI = '/touchlink/scan';
      this.config.touchlinkBody = undefined;
      this.log.info(
        '%s: %s %s v%s, api v%s', this.name, obj.modelid, this.type,
        obj.swversion, obj.apiversion
      );
      if (!semver.satisfies(this.version, recommendedVersion)) {
        this.log.warn(
          '%s: warning: not using recommended deCONZ gateway version %s',
          this.name, recommendedVersion
        );
      }
      break;
    default:
      this.log.warn(
        '%s: warning: ignoring unknown bridge/gateway %j',
        this.name, obj
      );
      throw new Error('unknown bridge');
  }
  this.request = deferred.gate(
    this._request,
    this.platform.config.parallelRequests || this.config.parallelRequests
  );
  this.infoService = new Service.AccessoryInformation();
  this.serviceList.push(this.infoService);
  this.infoService
    .updateCharacteristic(Characteristic.Manufacturer, this.manufacturername)
    .updateCharacteristic(Characteristic.Model, obj.modelid)
    .updateCharacteristic(Characteristic.SerialNumber, this.serialNumber)
    .updateCharacteristic(Characteristic.FirmwareRevision, this.version);
  this.obj = obj;
  this.obj.linkbutton = false;
  this.refresh();
  this.service = new Service.HueBridge(this.name);
  this.serviceList.push(this.service);
  this.service.getCharacteristic(Characteristic.Heartrate)
    .updateValue(this.state.heartrate)
    .on('set', this.setHeartrate.bind(this));
  this.service.getCharacteristic(Characteristic.LastUpdated)
    .updateValue(this.hk.lastupdated);
  this.service.getCharacteristic(Characteristic.TransitionTime)
    .updateValue(this.state.transitiontime)
    .on('set', this.setTransitionTime.bind(this));
  this.service.getCharacteristic(Characteristic.Link)
    .updateValue(this.hk.link)
    .on('set', this.setLink.bind(this));
  this.service.getCharacteristic(Characteristic.Touchlink)
    .updateValue(this.hk.touchlink)
    .on('set', this.setTouchlink.bind(this));
  if (this.config.linkbutton) {
    this.switchService = new Service.StatelessProgrammableSwitch(this.name);
    this.serviceList.push(this.switchService);
    this.switchService
      .getCharacteristic(Characteristic.ProgrammableSwitchEvent)
        .setProps({
          validValues: [Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS]
        });
  }
  this.accessoryList.push(this);
};

HueBridge.prototype.createUser = function() {
  if (this.username) {
    this.url += '/' + this.username;
    return deferred(true);
  }
  const d = deferred();
  const devicetype = ('homebridge-hue#' + os.hostname().split('.')[0])
    .substr(0, 40);
  this.request('post', '/', {devicetype: devicetype})
  .then((obj) => {
    this.username = obj[0].success.username;
    this.url += '/' + this.username;
    let s = '\n';
    s += '  "platforms": [\n';
    s += '    {\n';
    s += '      "platform": "Hue",\n';
    s += '      "users": {\n';
    s += '        "' + this.serialNumber + '": "' + this.username + '"\n';
    s += '      }\n';
    s += '    }\n';
    s += '  ]';
    this.log.info(
      '%s: created user - please edit config.json and restart homebridge%s',
    	this.name, s
    );
    d.resolve();
  })
  .catch((err) => {
    this.log.info(
      '%s: press link button on the bridge to create a user', this.name
    );
    setTimeout(() => {
      d.resolve(this.createUser());
    }, 15000);
  });
  return d.promise;
};

HueBridge.prototype.getFullState = function() {
  const d = deferred();

  this.request('get', '/').then((obj) => {
    this.request('get', '/groups/0').then((group0) => {
      obj.groups[0] = group0;
      if (obj.resourcelinks !== undefined) {
        d.resolve(obj);
      } else {
        this.request('get', '/resourcelinks').then((resourcelinks) => {
          obj.resourcelinks = resourcelinks;
          d.resolve(obj);
        });
      }
    });
  });
  return d.promise;
};

HueBridge.prototype.exposeResources = function(obj) {
  this.blacklist = {
    sensors: [],
    lights: [],
    groups: [],
    schedules: [],
    rules: []
  };
  this.whitelist = {
    lights: this.exposeLight,
    groups: this.exposeGroup,
    sensors: this.exposeSensor,
    schedules: this.exposeSchedule,
    rules: this.exposeRule
  };
  this.obj = obj.config;
  if (this.obj.websocketport) {
    this.listen();
  }
  for (const key in obj.resourcelinks) {
    const link = obj.resourcelinks[key];
    if (link.name === 'homebridge-hue' && link.links) {
      const list = link.description === 'whitelist' ?
        'whitelist' : 'blacklist';
      this.log.debug(
        '%s: /resourcelinks/%d: %d %s entries', this.name,
        key, link.links.length, list
      );
      for (const resource of link.links) {
        const type = resource.split('/')[1];
        const id = resource.split('/')[2];
        if (list === 'whitelist') {
          if (typeof this.whitelist[type] === 'function') {
            if (obj[type][id] === undefined) {
              this.log.warn(
                '%s: /resourcelinks/%d: %s: no such resource', this.name,
                key, resource
              );
            } else if (!this[type][id]) {
              this.whitelist[type].call(this, id, obj[type][id]);
            }
          }
        } else {
          if (this.blacklist[type]) {
            this.blacklist[type][id] = true;
          }
        }
      }
    }
  }
  if (this.platform.config.sensors) {
    for (const id in obj.sensors) {
      const sensor = obj.sensors[id];
      if (this.sensors[id]) {
        this.log.debug('%s: /sensors/%d: whitelisted', this.name, id);
      } else if (this.blacklist.sensors[id]) {
        this.log.debug('%s: /sensors/%d: blacklisted', this.name, id);
      } else if (
        this.config.nativeHomeKit &&
        sensor.type[0] === 'Z' && sensor.manufacturername === 'Philips'
      ) {
        this.log.debug('%s: /sensors/%d: exposed by bridge', this.name, id);
      } else if (
        this.platform.config.excludeSensorTypes[sensor.type] || (
          sensor.type.substring(0, 4) === 'CLIP'  &&
          this.platform.config.excludeSensorTypes.CLIP
        )
      ) {
        this.log.debug(
          '%s: /sensors/%d: %s excluded', this.name, id, sensor.type
        );
      } else if (
        sensor.name === '_dummy' || sensor.uniqueid === '_dummy'
      ) {
        this.log.debug(
          '%s: /sensors/%d: ignoring dummy sensor', this.name, id
        );
      } else {
        this.exposeSensor(id, sensor);
      }
    }
  }
  this.state.sensors = Object.keys(this.sensors).length;
  this.log.debug('%s: %d sensors', this.name, this.state.sensors);
  if (this.platform.config.lights) {
    for (const id in obj.lights) {
      const light = obj.lights[id];
      if (light.manufacturer) {
        light.manufacturername = light.manufacturer;
      }
      if (this.lights[id]) {
        this.log.debug('%s: /lights/%d: whitelisted', this.name, id);
      } else if (this.blacklist.lights[id]) {
        this.log.debug('%s: /lights/%d: blacklisted', this.name, id);
      } else if (
        this.config.nativeHomeKit &&
        light.manufacturername === 'Philips'
      ) {
        this.log.debug('%s: /lights/%d: exposed by bridge', this.name, id);
      } else {
        this.exposeLight(id, light);
      }
    }
  }
  this.state.lights = Object.keys(this.lights).length;
  this.log.debug('%s: %d lights', this.name, this.state.lights);
  if (this.platform.config.groups) {
    for (const id in obj.groups) {
      const group = obj.groups[id];
      if (this.groups[id]) {
        this.log.debug('%s: /groups/%d: whitelisted', this.name, id);
      } else if (this.blacklist.groups[id]) {
        this.log.debug('%s: /groups/%d: blacklisted', this.name, id);
      } else if (group.type === 'Room' && !this.platform.config.rooms) {
        this.log.debug(
          '%s: /groups/%d: %s excluded', this.name, id,  group.type
        );
      } else if (id === 0 && !this.platform.config.group0) {
      } else {
        this.exposeGroup(id, group);
      }
    }
  }
  this.state.groups = Object.keys(this.groups).length;
  this.state.group0 = this.groups[0] !== undefined ? 1 : 0;
  this.log.debug(
    '%s: %d groups', this.name, this.state.groups
  );
  if (this.platform.config.schedules) {
    for (const id in obj.schedules) {
      if (this.schedules[id]) {
        this.log.debug('%s: /schedules/%d: whitelisted', this.name, id);
      } else if (this.blacklist.schedules[id]) {
        this.log.debug('%s: /schedules/%d: blacklisted', this.name, id);
      } else {
        this.exposeSchedule(id, obj.schedules[id]);
      }
    }
  }
  this.state.schedules = Object.keys(this.schedules).length;
  this.log.debug('%s: %d schedules', this.name, this.state.schedules);
  if (this.platform.config.rules) {
    for (const id in obj.rules) {
      if (this.rules[id]) {
        this.log.debug('%s: /rules/%d: whitelisted', this.name, id);
      } else if (this.blacklist.rules[id]) {
        this.log.debug('%s: /rules/%d: blacklisted', this.name, id);
      } else {
        this.exposeRule(id, obj.rules[id]);
      }
    }
  }
  this.state.rules = Object.keys(this.rules).length;
  this.log.debug('%s: %d rules', this.name, this.state.rules);
};

HueBridge.prototype.exposeSensor = function(id, obj) {
  if (obj.type[0] === 'Z') {
    this.log.debug(
      '%s: /sensors/%d: %s %s (%s) "%s"', this.name, id,
      obj.manufacturername, obj.modelid, obj.type, obj.name
    );
  } else {
    this.log.debug(
      '%s: /sensors/%d: %s "%s"', this.name, id, obj.type, obj.name
    );
  }
  try {
    const sensor = new HueSensor(this, id, obj);
    if (sensor.service) {
      this.sensors[id] = sensor;
      const serialNumber = sensor.serialNumber;
      const accessory = this.accessoryMap[serialNumber];
      if (accessory) {
        for (let service of sensor.serviceList) {
          if (service.UUID !== Service.AccessoryInformation.UUID) {
            accessory.serviceList.push(service);
          }
        }
      } else {
        this.accessoryMap[serialNumber] = sensor;
        this.accessoryList.push(sensor);
      }
    }
  } catch(e) {
    this.log.error('%s: error: /sensors/%d: %j\n', this.name, id, obj, e);
  }
};

HueBridge.prototype.exposeLight = function(id, obj) {
  this.log.debug(
    '%s: /lights/%d: %s %s (%s) "%s"', this.name, id,
    obj.manufacturername, obj.modelid, obj.type, obj.name
  );
  try {
    const light = new HueLight(this, id, obj);
    this.lights[id] = light;
    const serialNumber = light.serialNumber;
    const accessory = this.accessoryMap[serialNumber];
    if (accessory) {
      accessory.serviceList.push(light.service);
    } else {
      this.accessoryMap[serialNumber] = light;
      this.accessoryList.push(light);
    }
  } catch(e) {
    this.log.error('%s: error: /lights/%d: %j\n', this.name, id, obj, e);
  }
};

HueBridge.prototype.exposeGroup = function(id, obj) {
  this.log.debug(
    '%s: /groups/%d: %s "%s"', this.name, id, obj.type, obj.name
  );
  try {
    this.groups[id] = new HueLight(this, id, obj, 'group');
    this.accessoryList.push(this.groups[id]);
  } catch(e) {
    this.log.error('%s: error: /groups/%d: %j\n', this.name, id, obj, e);
  }
};

HueBridge.prototype.exposeSchedule = function(id, obj) {
  this.log.debug(
    '%s: /schedules/%d: "%s"', this.name, id, obj.name
  );
  try {
    this.schedules[id] = new HueSchedule(this, id, obj);
    // this.accessoryList.push(this.schedules[id]);
    if (this.serviceList.length < 99) {
      this.serviceList.push(this.schedules[id].service);
    }
  } catch(e) {
    this.log.error(
      '%s: error: /schedules/%d: %j\n', this.name, id, obj, e
    );
  }
};

HueBridge.prototype.exposeRule = function(id, obj) {
  this.log.debug('%s: /rules/%d: "%s"', this.name, id, obj.name);
  try {
    this.rules[id] = new HueSchedule(this, id, obj, 'rule');
    // this.accessoryList.push(this.rules[id]);
    if (this.serviceList.length < 99) {
      this.serviceList.push(this.rules[id].service);
    }
  } catch(e) {
    this.log.error(
      '%s: error: /rules/%d: %j\n', this.name, id, obj, e
    );
  }
};

HueBridge.prototype.refresh = function() {
  this.hk = {};
  this.hk.lastupdated = this.obj.UTC ?
    String(new Date(this.obj.UTC + 'Z')).substring(0, 24) : 'n/a';
  this.hk.link = this.obj.linkbutton ? 1 : 0;
  this.hk.touchlink = this.state.touchlink ? 1 : 0;
};

HueBridge.prototype.resetTransitionTime = function() {
  if (this.state.resetTimer) {
    return;
  }
  this.state.resetTimer = setTimeout(() => {
    this.log.info(
      '%s: reset homekit transition time from %ss to %ss', this.name,
      this.state.transitiontime, this.defaultTransitiontime
    );
    this.state.transitiontime = this.defaultTransitiontime;
    this.service.getCharacteristic(Characteristic.TransitionTime)
      .updateValue(this.state.transitiontime);
    delete this.state.resetTimer;
  }, this.platform.config.waitTimeUpdate);
};

// ===== WebSocket =============================================================

HueBridge.prototype.listen = function() {
  const wsURL = 'ws://' + this.ipaddress + ':' + this.obj.websocketport + '/';
  this.ws = new WebSocket(wsURL);

  this.ws.on('open', () => {
    this.log.debug('%s: listening on websocket %s', this.name, wsURL);
  });

  this.ws.on('message', (data, flags) => {
    try {
      const obj = JSON.parse(data);
      if (obj.e === 'changed' && obj.t === 'event') {
        let a;
        switch (obj.r) {
          case 'lights':
            a = this.lights[obj.id];
            break;
          case 'groups':
            a = this.groups[obj.id];
            break;
          case 'sensors':
            a = this.sensors[obj.id];
            break;
          default:
            break;
        }
        if (a) {
          if (obj.state !== undefined) {
            this.log.debug('%s: state changed event', a.name);
            a.checkState(obj.state, true);
          }
          if (obj.config !== undefined) {
            this.log.debug('%s: config changed event', a.name);
            a.checkConfig(obj.config, true);
          }
        }
      }
    } catch(e) {
      this.log.error('%s: websocket error %s', this.name, e);
    }
  });

  this.ws.on('error', (error) => {
    this.log.error(
      '%s: websocket communication error %s on %s', this.name,
      error.code, wsURL
    );
  });

  this.ws.on('close', () => {
    this.log.debug(
      '%s: websocket connection closed - retrying in 30 seconds', this.name
    );
    setTimeout(this.listen.bind(this), 30000);
  });
};

// ===== Heartbeat =============================================================

HueBridge.prototype.heartbeat = function(beat) {
  if (beat % this.state.heartrate === 0 && this.request) {
    this.heartbeatConfig()
    .then(() => {
      return this.heartbeatSensors();
    }).then(() => {
      return this.heartbeatLights();
    }).then(() => {
      return this.heartbeatGroup0();
    }).then(() => {
      return this.heartbeatGroups();
    }).then(() => {
      return this.heartbeatSchedules();
    }).then(() => {
      return this.heartbeatRules();
    }).catch((err) => {
      if (err instanceof Error) {
        this.log.error('%s: heartbeat error:', this.name, err);
      }
    });
  }
};

HueBridge.prototype.heartbeatConfig = function() {
  return this.request('get', '/config').then((obj) => {
    const old = {
      obj: this.obj,
      hk: this.hk
    };
    this.obj = obj;
    this.refresh();
    this.service
      .updateCharacteristic(Characteristic.LastUpdated, this.hk.lastupdated);
    if (this.obj.linkbutton !== old.obj.linkbutton) {
      if (this.config.linkbutton) {
        this.log.debug(
          '%s: bridge linkbutton on %s', this.name, this.obj.UTC
        );
        this.log(
          '%s: homekit linkbutton single press', this.switchService.displayName
        );
        this.hk.link = 0;
        this.switchService
          .updateCharacteristic(Characteristic.ProgrammableSwitchEvent, 0);
        this.request('put', '/config', {linkbutton: false}).then(() => {
          this.obj.linkbutton = false;
        });
      } else {
        this.log.debug(
          '%s: bridge linkbutton changed from %s to %s', this.name,
          old.obj.linkbutton, this.obj.linkbutton
        );
      }
    }
    if (this.hk.link !== old.hk.link) {
      this.log(
        '%s: set homekit link from %s to %s', this.name,
        old.hk.link, this.hk.link
      );
      this.service.updateCharacteristic(Characteristic.Link, this.hk.link);
    }
    if (this.hk.touchlink !== old.hk.touchlink) {
      this.log(
        '%s: set homekit touchlink from %s to %s', this.name,
        old.hk.touchlink, this.hk.touchlink
      );
      this.service
        .updateCharacteristic(Characteristic.Touchlink, this.hk.touchlink);
    }
  });
};

HueBridge.prototype.heartbeatSensors = function() {
  if (this.state.sensors === 0) {
    return deferred(true);
  }
  return this.request('get', '/sensors').then((sensors) => {
    for (const id in sensors) {
      const a = this.sensors[id];
      if (a) {
        a.heartbeat(sensors[id]);
      }
    }
  });
};

HueBridge.prototype.heartbeatLights = function() {
  if (this.state.lights === 0) {
    return deferred(true);
  }
  return this.request('get', '/lights').then((lights) => {
    for (const id in lights) {
      const a = this.lights[id];
      if (a) {
        a.heartbeat(lights[id]);
      }
    }
  });
};

HueBridge.prototype.heartbeatGroups = function() {
  if (this.state.groups - this.state.group0 === 0) {
    return deferred(true);
  }
  return this.request('get', '/groups').then((groups) => {
    for (const id in groups) {
      const a = this.groups[id];
      if (a) {
        a.heartbeat(groups[id]);
      }
    }
  });
};

HueBridge.prototype.heartbeatGroup0 = function() {
  if (this.state.group0 === 0) {
    return deferred(true);
  }
  return this.request('get', '/groups/0').then((group0) => {
    const a = this.groups[0];
    if (a) {
      a.heartbeat(group0);
    }
  });
};

HueBridge.prototype.heartbeatSchedules = function() {
  if (this.state.schedules === 0) {
    return deferred(true);
  }
  return this.request('get', '/schedules').then((schedules) => {
    for (const id in schedules) {
      const a = this.schedules[id];
      if (a) {
        a.heartbeat(schedules[id]);
      }
    }
  });
};

HueBridge.prototype.heartbeatRules = function() {
  if (this.state.rules === 0) {
    return deferred(true);
  }
  return this.request('get', '/rules').then((rules) => {
    for (const id in rules) {
      const a = this.rules[id];
      if (a) {
        a.heartbeat(rules[id]);
      }
    }
  });
};

// ===== Homekit Events ========================================================

HueBridge.prototype.setHeartrate = function(rate, callback) {
  if (rate === this.state.heartrate) {
    return callback();
  }
  this.log.info(
    '%s: homekit heartrate changed from %ss to %ss', this.name,
    this.state.heartrate, rate
  );
  this.state.heartrate = rate;
  return callback();
};

HueBridge.prototype.setTransitionTime = function(transitiontime, callback) {
  transitiontime = Math.round(transitiontime * 10) / 10;
  if (transitiontime === this.state.transitiontime) {
    return callback();
  }
  this.log.info(
    '%s: homekit transition time changed from %ss to %ss', this.name,
    this.state.transitiontime, transitiontime
  );
  this.state.transitiontime = transitiontime;
  return callback();
};

HueBridge.prototype.setLink = function(link, callback) {
  link = link ? 1 : 0;
  if (link === this.hk.link) {
    return callback();
  }
  this.log.info(
    '%s: homekit link changed from %s to %s', this.name,
    this.hk.link, link
  );
  this.hk.link = link;
  const newValue = link ? true : false;
  this.request('put', '/config', {linkbutton: newValue})
  .then(() => {
    this.obj.linkbutton = newValue;
    return callback();
  }).catch((err) => {
    return callback(new Error(err));
  });
};

HueBridge.prototype.setTouchlink = function(touchlink, callback) {
  touchlink = touchlink ? 1 : 0;
  if (touchlink === this.hk.touchlink) {
    return callback();
  }
  this.log.info(
    '%s: homekit touchlink changed from %s to %s', this.name,
    this.hk.touchlink, touchlink
  );
  this.hk.touchlink = touchlink;
  if (!this.hk.touchlink) {
    return callback();
  }
  this.request(
    this.config.touchlinkCmd, this.config.touchlinkURI,
    this.config.touchlinkBody
  )
  .then(() => {
    this.state.touchlink = true;
    setTimeout(() => {
      this.log.info(
        '%s: set homekit touchlink from %s to %s', this.name,
        this.hk.touchlink, 0
      );
      this.state.touchlink = false;
      this.hk.touchlink = 0;
      this.service.getCharacteristic(Characteristic.Touchlink)
        .setValue(this.hk.touchlink);
    }, 15000);
    return callback();
  }).catch((err) => {
    return callback(new Error(err));
  });
};

HueBridge.prototype.identify = function(callback) {
  this.log.info('%s: identify', this.name);
  callback();
  this.request('get', '/')
  .then((body) => {
    const filename = this.platform.api.user.storagePath() + "/" +
                     this.name + '.json';
    this.log.info('%s: dumping masked state to %s', this.name, filename);
    body.config.bridgeid = 'xxxxxxFFFExxxxxx';
    body.config.mac = 'xx:xx:xx:xx:xx:xx';
    body.config.ipaddress = 'xxx.xxx.xxx.xxx';
    body.config.gateway = 'xxx.xxx.xxx.xxx';
    if (body.config.proxyaddress !== 'none') {
      body.config.proxyaddress = 'xxx.xxx.xxx.xxx';
    }
    let json = JSON.stringify(body);
    let i = 0;
    for (const username in body.config.whitelist) {
      i += 1;
      const regexp = RegExp(username, 'g');
      let mask = username.replace(/./g, 'x');
      mask = (mask + i).slice(-username.length);
      json = json.replace(regexp, mask);
    }
    fs.writeFile(filename, json, (err) => {
      if (err) {
        this.log.error('cannot create %s: error %s', filename, err.code);
        return;
      }
    });
  }).catch((err) => {
    this.log.error(err);
  });
};

// ===== Bridge Communication ==================================================

// Send request to bridge / gateway.
HueBridge.prototype._request = function(method, resource, body) {
  const d = deferred();
  const requestObj = {
    method: method,
    url: this.url + (resource === '/' ? '' : resource),
    headers: {'Connection': 'keep-alive'},
    timeout: 1000 * this.platform.config.timeout,
    json: true
  };
  const requestNumber = ++this.state.request;
  let requestMsg;
  requestMsg = util.format.apply(requestMsg, [
    '%s: %s request %d: %s %s', this.name, this.type,
    this.state.request, method, resource
  ]);
  if (body) {
    requestObj.body = body;
    requestMsg = util.format.apply(requestMsg, ['%s %j', requestMsg, body]);
  }
  this.log.debug(requestMsg);
  request(requestObj, (err, response, responseBody) => {
    if (err) {
      if (err.code === 'ECONNRESET') {
        this.log.debug(requestMsg);
        this.log.debug(
          '%s: %s communication error %s - retrying in 300ms',
          this.name, this.type, err.code
        );
        setTimeout(() => {
          d.resolve(this._request(method, resource, body));
        }, this.platform.config.waitTimeResend);
        return;
      }
      this.log.error(requestMsg);
      this.log.error(
        '%s: %s communication error %s on', this.name, this.type,
        err.code, requestObj.url.split('api/')[0]
      );
      return d.reject(err.code);
    }
    if (response.statusCode != 200) {
      this.log.error(requestMsg);
      this.log.error(
        '%s: %s http status %s %s', this.name, this.type,
        response.statusCode, response.statusMessage
      );
      return d.reject(response.statusCode);
    }
    if (util.isArray(responseBody)) {
      for (const id in responseBody) {
        const e = responseBody[id].error;
        if (e) {
          this.log.error(requestMsg);
          this.log.error(
            '%s: %s error %d: %s', this.name, this.type, e.type, e.description
          );
          return d.reject(e.type);
        }
      }
    }
    this.log.debug(
      '%s: %s request %d: ok', this.name, this.type, requestNumber
    );
    return d.resolve(responseBody);
  });
  return d.promise;
};
